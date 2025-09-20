import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';
import { HistoricalHighCacheV2 } from '../../historicalHighCacheV2';
import { binanceClient } from '../../binance';

export class HighCommandHandler extends BaseCommandHandler {
  readonly command = 'high';
  readonly description = 'Get historical high information for cryptocurrencies';
  readonly requiresAuth = false;

  constructor(
    formatter: any,
    logger: any,
    private historicalHighCache: HistoricalHighCacheV2
  ) {
    super(formatter, logger);
  }

  async handle(ctx: BotContext, args: string[]): Promise<CommandResult> {
    return this.safeExecute(ctx, async () => {
      if (!this.validateArgs(args, 1, 2)) {
        return {
          success: false,
          message: this.formatUsageMessage(),
          shouldReply: true
        };
      }

      const symbol = args[0].toLowerCase();
      const param = args[1]?.toLowerCase();

      // 特殊处理 "all" 命令：/high sol all
      if (param === 'all') {
        return this.handleRankingCommand(symbol);
      }

      // 处理单个代币查询：/high sol 或 /high sol all
      const timeframe = param || 'all'; // 默认历史全部
      return this.handleSingleTokenCommand(symbol, timeframe);
    });
  }

  private async handleSingleTokenCommand(symbol: string, timeframe: string): Promise<CommandResult> {
    // 验证时间框架
    const validTimeframes = ['1w', '1m', '6m', '1y', 'all'];
    if (!validTimeframes.includes(timeframe)) {
      return {
        success: false,
        message: `❌ 无效的时间框架: ${timeframe}\n有效选项: ${validTimeframes.join(', ')}`,
        shouldReply: true
      };
    }

    // 标准化代币符号
    const normalizedSymbol = this.normalizeSymbol(symbol);

    // 查询历史高价数据（仅用于获取历史高点，不使用缓存的当前价格）
    const cachedData = this.historicalHighCache.queryHistoricalHigh(normalizedSymbol, timeframe);

    if (!cachedData) {
      return {
        success: false,
        message: `❌ 未找到 ${normalizedSymbol} 的历史高价数据 (${timeframe})`,
        shouldReply: true
      };
    }

    try {
      // 获取实时当前价格
      const realTimePrice = await binanceClient.getFuturesPrice(normalizedSymbol);

      // 基于实时价格重新计算距离和涨幅
      const highPrice = cachedData.highPrice;
      const highTimestamp = cachedData.highTimestamp;

      // 重新计算距离百分比和需要涨幅
      const neededGainPercent = realTimePrice >= highPrice ? 0 : ((highPrice - realTimePrice) / realTimePrice) * 100;
      const distancePercent = realTimePrice >= highPrice ? -((realTimePrice - highPrice) / highPrice) * 100 : neededGainPercent;

      // 构建实时数据对象
      const realTimeData = {
        symbol: cachedData.symbol,
        timeframe: cachedData.timeframe,
        currentPrice: realTimePrice, // 使用实时价格
        highPrice: highPrice,        // 使用缓存的历史高价
        highTimestamp: highTimestamp, // 使用缓存的时间戳
        distancePercent: distancePercent,
        neededGainPercent: neededGainPercent
      };

      // 格式化响应消息
      const message = this.formatHistoricalHighMessage(realTimeData);

      return {
        success: true,
        message,
        shouldReply: true
      };

    } catch (error) {
      // 如果获取实时价格失败，回退到缓存数据并记录警告
      console.warn(`Failed to get real-time price for ${normalizedSymbol}, using cached data:`, error);

      const message = this.formatHistoricalHighMessage(cachedData);
      return {
        success: true,
        message: message + '\n\n⚠️ *注意: 使用缓存价格数据*',
        shouldReply: true
      };
    }
  }

  private async handleRankingCommand(symbol: string): Promise<CommandResult> {
    // 对于 "all" 命令，symbol 实际上是时间框架
    const timeframe = symbol || '1w';
    const validTimeframes = ['1w', '1m', '6m', '1y', 'all'];

    if (!validTimeframes.includes(timeframe)) {
      return {
        success: false,
        message: `❌ 排名查询的时间框架无效: ${timeframe}\n有效选项: ${validTimeframes.join(', ')}`,
        shouldReply: true
      };
    }

    try {
      // 先获取初始排名数据
      const initialRankings = this.historicalHighCache.getRankingByProximityToHigh(timeframe, 20);

      if (initialRankings.length === 0) {
        return {
          success: false,
          message: `❌ 时间框架 ${timeframe} 暂无排名数据`,
          shouldReply: true
        };
      }

      // 批量更新前20个币种的实时价格
      const symbolsToUpdate = initialRankings.slice(0, 20).map(r => r.symbol);

      try {
        console.log(`🔄 Updating real-time prices for ${symbolsToUpdate.length} top symbols...`);

        const updateResult = await this.historicalHighCache.batchIncrementalUpdate(symbolsToUpdate, 1);

        console.log(`✅ Updated ${updateResult.success.length} symbols, failed ${updateResult.failed.length}`);

        // 重新获取更新后的排名数据
        const updatedRankings = this.historicalHighCache.getRankingByProximityToHigh(timeframe, 20);

        const message = this.formatRankingMessage(updatedRankings, timeframe);
        const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

        return {
          success: true,
          message: message + `\n\n⚡ *数据时间*: ${now} (实时价格更新)`,
          shouldReply: true
        };

      } catch (updateError) {
        // 如果实时更新失败，回退到缓存数据
        console.warn('Failed to update real-time prices, using cached data:', updateError);

        const message = this.formatRankingMessage(initialRankings, timeframe);

        return {
          success: true,
          message: message + '\n\n⚠️ *注意: 实时更新失败，使用缓存价格*',
          shouldReply: true
        };
      }

    } catch (error) {
      return {
        success: false,
        message: `❌ 查询排名数据时发生错误: ${error instanceof Error ? error.message : String(error)}`,
        shouldReply: true
      };
    }
  }

  private formatHistoricalHighMessage(data: any): string {
    const {
      symbol,
      timeframe,
      currentPrice,
      highPrice,
      highTimestamp,
      distancePercent,
      neededGainPercent
    } = data;

    const timeframeNames: Record<string, string> = {
      '1w': '1周',
      '1m': '1个月',
      '6m': '6个月',
      '1y': '1年',
      'all': '历史'
    };

    const highDate = new Date(highTimestamp).toLocaleDateString('zh-CN');
    const distanceDirection = distancePercent < 0 ? '已超过' : '距离';
    const distanceEmoji = distancePercent < 0 ? '🚀' : '📊';
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    let message = `${distanceEmoji} **${symbol} - ${timeframeNames[timeframe]}历史高价分析**\n\n`;
    message += `💰 **当前价格**: $${currentPrice.toFixed(6)} ⚡\n`;
    message += `🎯 **历史最高**: $${highPrice.toFixed(6)} (${highDate})\n`;
    message += `📏 **${distanceDirection}高价**: ${Math.abs(distancePercent).toFixed(2)}%\n`;

    if (distancePercent >= 0) {
      message += `📈 **需要涨幅**: ${neededGainPercent.toFixed(2)}%\n`;
    } else {
      message += `🎉 **已创新高**: 超过历史最高 ${Math.abs(distancePercent).toFixed(2)}%\n`;
    }

    message += `\n⏰ **数据时间**: ${now} (实时价格)`;

    return message;
  }

  private formatRankingMessage(rankings: any[], timeframe: string): string {
    const timeframeNames: Record<string, string> = {
      '1w': '1周',
      '1m': '1个月',
      '6m': '6个月',
      '1y': '1年',
      'all': '历史'
    };

    let message = `📊 **${timeframeNames[timeframe]}历史高价排名 TOP${rankings.length}**\n\n`;
    message += `_按距离历史高价由近到远排序_\n\n`;

    rankings.slice(0, 15).forEach((item, index) => {
      const symbol = item.symbol.replace('USDT', '');
      const emoji = item.distancePercent < 0 ? '🚀' : index < 3 ? '🔥' : '📈';
      const distanceText = item.distancePercent < 0
        ? `新高+${Math.abs(item.distancePercent).toFixed(1)}%`
        : `-${item.distancePercent.toFixed(1)}%`;

      message += `${emoji} **${index + 1}. ${symbol}** ${distanceText}\n`;
      message += `   $${item.currentPrice.toFixed(6)} (最高: $${item.highPrice.toFixed(6)})\n\n`;
    });

    if (rankings.length > 15) {
      message += `_... 还有 ${rankings.length - 15} 个代币_`;
    }

    return message;
  }

  private formatUsageMessage(): string {
    return `**📊 历史高价查询命令帮助**

**用法:**
• \`/high <symbol>\` - 查看代币历史最高价
• \`/high <symbol> <timeframe>\` - 查看指定时间框架历史高价
• \`/high <timeframe> all\` - 查看该时间框架排名

**示例:**
• \`/high sol\` - SOL的历史最高价
• \`/high btc 1m\` - BTC的1个月历史高价
• \`/high 1w all\` - 1周历史高价排名

**时间框架:**
\`1w\` (1周) | \`1m\` (1个月) | \`6m\` (6个月) | \`1y\` (1年) | \`all\` (全部历史)`;
  }
}