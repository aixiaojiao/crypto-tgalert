import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { realtimeMarketCache, RankingResult } from './realtimeMarketCache';
import { formatPriceWithSeparators, formatPriceChange } from '../utils/priceFormatter';
import { getRiskIcon, getTokenRiskLevel, isRiskyToken } from '../config/tokenLists';
// Utility function for UTC+8 time formatting
function formatTimeToUTC8(date: Date | number): string {
  const targetDate = typeof date === 'number' ? new Date(date) : date;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(targetDate);
}

export interface RealtimeAlertConfig {
  enabled: boolean;
  minGainPercent: number; // 新进入阈值 (10%)
  majorMoveThreshold: number; // 大幅变动阈值 (3位)
  pushCooldownMs: number; // 推送冷却时间 (10分钟)
  maxPushPerSymbol: number; // 每个币种最大推送次数 (2次/冷却期)
}

interface SymbolPushRecord {
  symbol: string;
  pushCount: number;
  lastPushTime: number;
  cooldownUntil: number;
}

/**
 * 基于实时WebSocket数据的智能推送服务
 * 替代原有的定时轮询逻辑，提供事件驱动的推送机制
 */
export class RealtimeAlertService {
  private telegramBot: TelegramBot | null = null;
  private config: RealtimeAlertConfig;
  private pushRecords: Map<string, SymbolPushRecord> = new Map();
  private isEnabled: boolean = false;

  constructor(config?: Partial<RealtimeAlertConfig>) {
    this.config = {
      enabled: false,
      minGainPercent: 10,           // 新进入前10需涨幅>=10%
      majorMoveThreshold: 3,        // 排名变化>=3位
      pushCooldownMs: 10 * 60 * 1000, // 10分钟冷却
      maxPushPerSymbol: 2,          // 10分钟内最多推送2次
      ...config
    };

    log.info('RealtimeAlertService initialized', this.config);
  }

  /**
   * 设置Telegram Bot实例
   */
  setTelegramBot(bot: TelegramBot): void {
    this.telegramBot = bot;
    log.info('TelegramBot instance set in RealtimeAlertService');
  }

  /**
   * 启动实时推送服务
   */
  async start(): Promise<void> {
    if (this.isEnabled) {
      log.warn('RealtimeAlertService is already running');
      return;
    }

    if (!this.telegramBot) {
      throw new Error('TelegramBot instance must be set before starting RealtimeAlertService');
    }

    // 监听排名变化事件
    realtimeMarketCache.on('rankingChanged', (eventData) => {
      this.handleRankingChanged(eventData);
    });

    this.isEnabled = true;
    this.config.enabled = true;

    log.info('RealtimeAlertService started successfully', {
      minGainPercent: this.config.minGainPercent,
      majorMoveThreshold: this.config.majorMoveThreshold,
      pushCooldownMs: this.config.pushCooldownMs / 1000 / 60 + 'min'
    });
  }

  /**
   * 停止实时推送服务
   */
  async stop(): Promise<void> {
    if (!this.isEnabled) {
      log.warn('RealtimeAlertService is not running');
      return;
    }

    // 移除事件监听
    realtimeMarketCache.removeAllListeners('rankingChanged');

    this.isEnabled = false;
    this.config.enabled = false;
    this.pushRecords.clear();

    log.info('RealtimeAlertService stopped');
  }

  /**
   * 处理排名变化事件
   */
  private async handleRankingChanged(eventData: {
    current: RankingResult[];
    previous: RankingResult[];
    changes: Array<{
      symbol: string;
      currentPosition?: number;
      previousPosition?: number;
      changeType: 'new_entry' | 'position_change' | 'exit';
      changeValue?: number;
      priceChangePercent: number;
    }>;
  }): Promise<void> {
    if (!this.config.enabled || !this.telegramBot) return;

    try {
      const significantChanges = eventData.changes.filter(change =>
        this.isSignificantChange(change)
      );

      if (significantChanges.length === 0) return;

      // 过滤需要推送的变化（考虑冷却时间和推送限制）
      const pushableChanges = significantChanges.filter(change =>
        this.canPushSymbol(change.symbol)
      );

      if (pushableChanges.length === 0) {
        log.debug('No pushable changes after filtering', {
          totalChanges: significantChanges.length,
          filtered: significantChanges.map(c => `${c.symbol}:${c.changeType}`)
        });
        return;
      }

      // 检查是否应该触发推送（排除过多风险代币）
      if (!this.shouldTriggerPush(pushableChanges)) {
        log.debug('Push filtered out due to too many risky tokens', {
          riskyCount: pushableChanges.filter(c => isRiskyToken(c.symbol)).length,
          totalCount: pushableChanges.length
        });
        return;
      }

      // 发送推送消息
      await this.sendRankingAlert(eventData.current, pushableChanges);

      // 更新推送记录
      pushableChanges.forEach(change => {
        this.updatePushRecord(change.symbol);
      });

    } catch (error) {
      log.error('Failed to handle ranking change event', error);
    }
  }

  /**
   * 判断是否为重要变化
   */
  private isSignificantChange(change: any): boolean {
    switch (change.changeType) {
      case 'new_entry':
        // 新进入前10且涨幅达到阈值
        return change.priceChangePercent >= this.config.minGainPercent;

      case 'position_change':
        // 排名变化达到阈值
        return Math.abs(change.changeValue || 0) >= this.config.majorMoveThreshold;

      case 'exit':
        // 暂不推送退出前10的消息
        return false;

      default:
        return false;
    }
  }

  /**
   * 检查币种是否可以推送
   */
  private canPushSymbol(symbol: string): boolean {
    const now = Date.now();
    const record = this.pushRecords.get(symbol);

    if (!record) return true;

    // 检查是否还在冷却期
    if (now < record.cooldownUntil) {
      return false;
    }

    // 检查推送次数限制
    if (record.pushCount >= this.config.maxPushPerSymbol) {
      return false;
    }

    return true;
  }

  /**
   * 更新币种推送记录
   */
  private updatePushRecord(symbol: string): void {
    const now = Date.now();
    const record = this.pushRecords.get(symbol);

    if (!record || now >= record.cooldownUntil) {
      // 新记录或冷却期结束，重置计数
      this.pushRecords.set(symbol, {
        symbol,
        pushCount: 1,
        lastPushTime: now,
        cooldownUntil: now + this.config.pushCooldownMs
      });
    } else {
      // 冷却期内，增加推送次数
      record.pushCount++;
      record.lastPushTime = now;
      this.pushRecords.set(symbol, record);
    }
  }

  /**
   * 判断是否应该触发推送（排除风险代币过多的情况）
   */
  private shouldTriggerPush(changes: any[]): boolean {
    const riskyTokenCount = changes.filter(change => isRiskyToken(change.symbol)).length;
    const riskyRatio = riskyTokenCount / changes.length;

    // 如果风险代币占比超过70%，则不推送
    return riskyRatio <= 0.7;
  }

  /**
   * 发送排名变化推送消息
   */
  private async sendRankingAlert(currentRankings: RankingResult[], changes: any[]): Promise<void> {
    if (!this.telegramBot) return;

    try {
      // 检查用户是否启用了涨幅榜推送
      const authorizedUserId = this.telegramBot.getAuthorizedUserId();
      if (!authorizedUserId) {
        log.warn('No authorized user found for realtime alert');
        return;
      }

      // Check if user has gainers alerts enabled (simplified check)
      // Note: For now we'll assume the push is enabled if service is running
      // TODO: Implement proper user preference checking

      // 构建完整的TOP10排行榜消息，与/gainers命令格式一致
      let message = `🚀 *24小时涨幅榜 TOP10*\n\n`;

      // 显示完整TOP10榜单
      const top10 = currentRankings.slice(0, 10);
      const priceFormatPromises = top10.map(async (ranking, index) => {
        const symbol = ranking.symbol.replace('USDT', '');
        const changePercent = formatPriceChange(ranking.priceChangePercent);
        const formattedPrice = await formatPriceWithSeparators(ranking.price.toString(), ranking.symbol);
        const riskLevel = getTokenRiskLevel(ranking.symbol);
        const riskIcon = getRiskIcon(riskLevel);
        const prefix = riskIcon ? `${riskIcon}` : '';
        const sign = ranking.priceChangePercent >= 0 ? '+' : '';
        return `${index + 1}. ${prefix}**${symbol}** ${sign}${changePercent}% ($${formattedPrice})\n`;
      });

      const formattedEntries = await Promise.all(priceFormatPromises);
      formattedEntries.forEach(entry => {
        message += entry;
      });

      // 添加变化提示
      const newEntries = changes.filter(c => c.changeType === 'new_entry');
      const positionChanges = changes.filter(c => c.changeType === 'position_change');

      if (newEntries.length > 0 || positionChanges.length > 0) {
        message += `\n🔥 *本次变化:*\n`;

        // 新进入前10
        if (newEntries.length > 0) {
          for (const change of newEntries.slice(0, 2)) {
            const symbol = change.symbol.replace('USDT', '');
            message += `• 🆕 **${symbol}** 新进入#${change.currentPosition}\n`;
          }
        }

        // 排名大幅变化
        if (positionChanges.length > 0) {
          for (const change of positionChanges.slice(0, 2)) {
            const symbol = change.symbol.replace('USDT', '');
            const moveDirection = change.changeValue > 0 ? '⬆️' : '⬇️';
            const moveText = change.changeValue > 0 ? '上升' : '下降';
            message += `• ${moveDirection} **${symbol}** ${moveText}${Math.abs(change.changeValue)}位 (#${change.previousPosition}→#${change.currentPosition})\n`;
          }
        }
      }

      message += `\n📊 数据来源: ⚡ 实时数据`;
      message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;

      // 发送消息
      const userId = this.telegramBot.getAuthorizedUserId();
      if (userId) {
        await this.telegramBot.sendToAuthorizedUser(message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });

        log.info(`Realtime ranking alert sent`, {
          userId,
          changesCount: changes.length,
          newEntries: newEntries.length,
          positionChanges: positionChanges.length
        });
      }

    } catch (error) {
      log.error('Failed to send ranking alert', error);
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    const now = Date.now();
    const activeCooldowns = Array.from(this.pushRecords.values())
      .filter(record => now < record.cooldownUntil);

    return {
      enabled: this.isEnabled,
      config: this.config,
      totalPushRecords: this.pushRecords.size,
      activeCooldowns: activeCooldowns.length,
      cooldownSymbols: activeCooldowns.map(r => r.symbol)
    };
  }

  /**
   * 清理过期的推送记录
   */
  cleanupExpiredRecords(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [symbol, record] of this.pushRecords.entries()) {
      if (now >= record.cooldownUntil) {
        this.pushRecords.delete(symbol);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      log.debug(`Cleaned ${cleaned} expired push records`);
    }
  }
}

// 创建全局实例
export const realtimeAlertService = new RealtimeAlertService();