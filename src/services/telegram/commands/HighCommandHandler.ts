import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';
import { HistoricalHighService, RankingRow } from '../../historicalHighService';
import { HighTimeframe, ALL_TIMEFRAMES, HistoricalHighRecord } from '../../../models/historicalHighModel';
import { binanceClient } from '../../binance';

const TIMEFRAME_DISPLAY: Record<HighTimeframe, string> = {
  '7d': '7 天',
  '30d': '30 天',
  '180d': '180 天',
  '52w': '52 周',
  'ATH': '历史',
};

/**
 * /high 命令
 *   /high <symbol>                — 返回 5 档（7d/30d/180d/52w/ATH）高点总览
 *   /high <symbol> <timeframe>    — 指定档位细节
 *   /high <timeframe> all         — 按距高点接近度排名（TOP 20）
 *   /high near <timeframe>        — 同上（兼容旧交互入口）
 */
export class HighCommandHandler extends BaseCommandHandler {
  readonly command = 'high';
  readonly description = 'Get historical high information for cryptocurrencies';
  readonly requiresAuth = false;

  constructor(
    formatter: any,
    logger: any,
    private readonly highService: HistoricalHighService,
  ) {
    super(formatter, logger);
  }

  async handle(ctx: BotContext, args: string[]): Promise<CommandResult> {
    return this.safeExecute(ctx, async () => {
      if (!this.validateArgs(args, 1, 2)) {
        return {
          success: false,
          message: this.formatUsageMessage(),
          shouldReply: true,
        };
      }

      const arg1 = args[0];
      const arg2 = args[1]?.toLowerCase();

      // /high <tf> all  或  /high near <tf>
      if (arg2 === 'all' && this.isTimeframe(arg1)) {
        return this.handleRankingCommand(arg1.toUpperCase() === 'ATH' ? 'ATH' : (arg1.toLowerCase() as HighTimeframe));
      }
      if (arg1.toLowerCase() === 'near' && arg2 && this.isTimeframe(arg2)) {
        return this.handleRankingCommand(arg2.toUpperCase() === 'ATH' ? 'ATH' : (arg2.toLowerCase() as HighTimeframe));
      }

      // /high <symbol>  或  /high <symbol> <timeframe>
      const symbol = this.normalizeSymbol(arg1);
      if (arg2) {
        if (!this.isTimeframe(arg2)) {
          return {
            success: false,
            message: `❌ 无效的时间框架: ${arg2}\n有效选项: ${ALL_TIMEFRAMES.join(', ')}`,
            shouldReply: true,
          };
        }
        const tf = arg2.toUpperCase() === 'ATH' ? 'ATH' : (arg2.toLowerCase() as HighTimeframe);
        return this.handleSingleTimeframe(symbol, tf);
      }
      return this.handleOverview(symbol);
    });
  }

  private isTimeframe(s: string): boolean {
    const u = s.toUpperCase();
    if (u === 'ATH') return true;
    return ALL_TIMEFRAMES.includes(s.toLowerCase() as HighTimeframe);
  }

  /** /high <symbol> — 一条消息展示 5 档概览 */
  private async handleOverview(symbol: string): Promise<CommandResult> {
    const all = this.highService.queryAllHighs(symbol);
    const anyCached = ALL_TIMEFRAMES.some(tf => all[tf] !== null);
    if (!anyCached) {
      return {
        success: false,
        message: `❌ 未找到 ${symbol} 的历史高点缓存（可能尚未冷刷新到）`,
        shouldReply: true,
      };
    }

    let currentPrice: number;
    try {
      currentPrice = await binanceClient.getFuturesPrice(symbol);
    } catch (err) {
      return {
        success: false,
        message: `❌ 无法获取 ${symbol} 的实时价格: ${err instanceof Error ? err.message : String(err)}`,
        shouldReply: true,
      };
    }

    let message = `📊 **${symbol} 历史高点**\n\n`;
    message += `💰 当前价: \`${formatPrice(currentPrice)}\`\n\n`;

    for (const tf of ALL_TIMEFRAMES) {
      const rec = all[tf];
      if (!rec) {
        message += `• ${TIMEFRAME_DISPLAY[tf].padEnd(5)} — 无数据\n`;
        continue;
      }
      const { distancePercent, neededGainPercent } = calcDistance(currentPrice, rec.highPrice);
      const highDate = new Date(rec.highAt).toISOString().slice(0, 10);
      const tag =
        distancePercent < 0
          ? `🚀 已破 +${Math.abs(distancePercent).toFixed(2)}%`
          : `距 -${distancePercent.toFixed(2)}% · 需涨 ${neededGainPercent.toFixed(2)}%`;
      message += `• **${TIMEFRAME_DISPLAY[tf]}** 高点 \`${formatPrice(rec.highPrice)}\` (${highDate}) — ${tag}\n`;
    }

    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    message += `\n⏰ ${now}`;
    return { success: true, message, shouldReply: true };
  }

  /** /high <symbol> <timeframe> — 单档详情 */
  private async handleSingleTimeframe(symbol: string, tf: HighTimeframe): Promise<CommandResult> {
    const rec = this.highService.queryHigh(symbol, tf);
    if (!rec) {
      return {
        success: false,
        message: `❌ 未找到 ${symbol} 的 ${TIMEFRAME_DISPLAY[tf]} 高点`,
        shouldReply: true,
      };
    }
    let currentPrice: number;
    try {
      currentPrice = await binanceClient.getFuturesPrice(symbol);
    } catch (err) {
      return {
        success: false,
        message: `❌ 无法获取 ${symbol} 的实时价格: ${err instanceof Error ? err.message : String(err)}`,
        shouldReply: true,
      };
    }
    return { success: true, message: this.formatSingle(rec, currentPrice), shouldReply: true };
  }

  /** /high <timeframe> all — 接近高点排名 */
  private async handleRankingCommand(tf: HighTimeframe): Promise<CommandResult> {
    try {
      const rows = await this.highService.getRankingByProximityToHigh(tf, 20);
      if (rows.length === 0) {
        return {
          success: false,
          message: `❌ ${TIMEFRAME_DISPLAY[tf]} 暂无排名数据（冷刷新可能未完成）`,
          shouldReply: true,
        };
      }
      return { success: true, message: this.formatRanking(rows, tf), shouldReply: true };
    } catch (err) {
      return {
        success: false,
        message: `❌ 查询排名失败: ${err instanceof Error ? err.message : String(err)}`,
        shouldReply: true,
      };
    }
  }

  // ─────────── 格式化 ───────────

  private formatSingle(rec: HistoricalHighRecord, currentPrice: number): string {
    const { distancePercent, neededGainPercent } = calcDistance(currentPrice, rec.highPrice);
    const highDate = new Date(rec.highAt).toISOString().slice(0, 10);
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const icon = distancePercent < 0 ? '🚀' : '📊';

    let msg = `${icon} **${rec.symbol} - ${TIMEFRAME_DISPLAY[rec.timeframe]}高点**\n\n`;
    msg += `💰 当前: \`${formatPrice(currentPrice)}\`\n`;
    msg += `🎯 高点: \`${formatPrice(rec.highPrice)}\` (${highDate})\n`;
    if (distancePercent < 0) {
      msg += `🎉 已破新高 +${Math.abs(distancePercent).toFixed(2)}%\n`;
    } else {
      msg += `📏 距高点: -${distancePercent.toFixed(2)}%\n`;
      msg += `📈 需涨幅: ${neededGainPercent.toFixed(2)}%\n`;
    }
    msg += `\n⏰ ${now}`;
    return msg;
  }

  private formatRanking(rows: RankingRow[], tf: HighTimeframe): string {
    const shown = rows.slice(0, 15);
    let msg = `📊 **${TIMEFRAME_DISPLAY[tf]}高点 — 接近度 TOP${shown.length}**\n`;
    msg += `_按需涨幅由近到远_\n\n`;

    shown.forEach((r, i) => {
      const display = r.symbol.replace(/USDT$/, '');
      const emoji = r.distancePercent < 0 ? '🚀' : r.neededGainPercent <= 5 ? '🔥' : r.neededGainPercent <= 10 ? '⚡' : '📈';
      const tag =
        r.distancePercent < 0
          ? `新高 +${Math.abs(r.distancePercent).toFixed(1)}%`
          : `需 ${r.neededGainPercent.toFixed(1)}%`;
      msg += `${emoji} **${i + 1}. ${display}** ${tag}\n`;
      msg += `   \`${formatPrice(r.currentPrice)}\` / 高点 \`${formatPrice(r.highPrice)}\`\n`;
    });

    if (rows.length > shown.length) {
      msg += `\n_... 还有 ${rows.length - shown.length} 个_`;
    }
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    msg += `\n\n⏰ ${now}`;
    return msg;
  }

  private formatUsageMessage(): string {
    return `**📊 /high 历史高点查询**

**用法:**
• \`/high <symbol>\` — 5 档概览
• \`/high <symbol> <tf>\` — 单档详情
• \`/high <tf> all\` — 接近高点 TOP 20
• \`/high near <tf>\` — 同上（兼容旧入口）

**时间框架:** \`7d\` \`30d\` \`180d\` \`52w\` \`ATH\`

**示例:**
• \`/high btc\`
• \`/high sol 30d\`
• \`/high 52w all\`
`;
  }
}

// ─────────── 辅助 ───────────

function calcDistance(currentPrice: number, highPrice: number): {
  distancePercent: number;
  neededGainPercent: number;
} {
  if (currentPrice >= highPrice) {
    return {
      distancePercent: -((currentPrice - highPrice) / highPrice) * 100,
      neededGainPercent: 0,
    };
  }
  return {
    distancePercent: ((highPrice - currentPrice) / currentPrice) * 100,
    neededGainPercent: ((highPrice - currentPrice) / currentPrice) * 100,
  };
}

function formatPrice(p: number): string {
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}
