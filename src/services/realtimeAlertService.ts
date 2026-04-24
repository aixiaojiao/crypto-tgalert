import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { realtimeMarketCache, RankingResult } from './realtimeMarketCache';
import { formatPriceWithSeparators, formatPriceChange } from '../utils/priceFormatter';
import { getRiskIcon, getTokenRiskLevel, isRiskyToken } from '../config/tokenLists';
import { isLowVolume, getVolumeIcon } from '../config/volumeConfig';
import { resolve } from '../core/container';
import { SERVICE_IDENTIFIERS } from '../core/container/decorators';
import { IAdvancedFilterManager } from './filters/AdvancedFilterManager';
import { esp32NotificationService } from './esp32';
import { detectL1NewTop } from './realtimeRankingUtils';
import { RankingAlertModel } from '../models/rankingAlertModel';
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
  private filterManager: IAdvancedFilterManager | null = null;

  constructor(config?: Partial<RealtimeAlertConfig>) {
    this.config = {
      enabled: false,
      minGainPercent: 10,           // 新进入前10需涨幅>=10%
      majorMoveThreshold: 3,        // 排名变化>=3位
      pushCooldownMs: 10 * 60 * 1000, // 10分钟冷却
      maxPushPerSymbol: 2,          // 10分钟内最多推送2次
      ...config
    };

    // Initialize filter manager
    try {
      this.filterManager = resolve(SERVICE_IDENTIFIERS.ADVANCED_FILTER_MANAGER) as IAdvancedFilterManager;
    } catch (error) {
      log.warn('Failed to initialize filter manager in RealtimeAlertService', { error });
    }

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
      // L1 榜首易主事件：有币进入 #1 且之前不在 #1
      // 强制判定为重要变化，即使未达到常规阈值（例如 #2→#1 仅 1 位）
      const l1NewTop = detectL1NewTop(eventData.changes);

      const significantChanges = eventData.changes.filter(change =>
        this.isSignificantChange(change) || change === l1NewTop
      );

      if (significantChanges.length === 0) return;

      // 过滤掉用户已加入过滤名单（黑/黄/mute）的代币 —— 它们不应作为推送触发源
      // 注：榜单展示时这些代币仍会显示（带标识图标），此处只影响"是否触发推送"
      const userFilteredChanges = await this.filterOutUserFilteredSymbols(significantChanges);

      if (userFilteredChanges.length === 0) {
        log.debug('All significant changes filtered by user filter, skip push', {
          total: significantChanges.length,
          symbols: significantChanges.map(c => c.symbol)
        });
        return;
      }

      // 全局规则：<30M 低成交量币不作为推送触发源（榜单展示时仍会显示并加 💧）
      const volumeFilteredChanges = userFilteredChanges.filter(change => {
        const ticker = realtimeMarketCache.getTickerData(change.symbol);
        return ticker ? !isLowVolume(ticker.volume) : false;
      });

      if (volumeFilteredChanges.length === 0) {
        log.debug('All significant changes are low-volume (<threshold), skip push', {
          total: userFilteredChanges.length,
          symbols: userFilteredChanges.map(c => c.symbol)
        });
        return;
      }

      // 过滤需要推送的变化（考虑冷却时间和推送限制）
      // L1 榜首易主事件绕过 symbol 冷却与次数上限
      const pushableChanges = volumeFilteredChanges.filter(change =>
        change === l1NewTop || this.canPushSymbol(change.symbol)
      );

      if (pushableChanges.length === 0) {
        log.debug('No pushable changes after cooldown filtering', {
          totalChanges: userFilteredChanges.length,
          filtered: userFilteredChanges.map(c => `${c.symbol}:${c.changeType}`)
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

      // 发送推送消息（若 L1 事件穿透所有过滤，则以 L1 形式推送）
      const l1ForPush = l1NewTop && pushableChanges.includes(l1NewTop) ? l1NewTop : undefined;
      await this.sendRankingAlert(eventData.current, pushableChanges, l1ForPush);

      // 更新推送记录
      pushableChanges.forEach(change => {
        this.updatePushRecord(change.symbol);
      });

    } catch (error) {
      log.error('Failed to handle ranking change event', error);
    }
  }

  /**
   * 过滤掉用户自定义过滤名单中的代币（黑/黄/mute + 系统黄名单）
   * 仅作用于"推送触发源"判定，不影响榜单显示
   */
  private async filterOutUserFilteredSymbols(
    changes: Array<{ symbol: string; changeType: string; [k: string]: any }>
  ): Promise<typeof changes> {
    if (!this.filterManager || !this.telegramBot) return changes;

    const userId = this.telegramBot.getAuthorizedUserId();
    if (!userId) return changes;

    const allowed: typeof changes = [];
    for (const change of changes) {
      try {
        const cleanSymbol = change.symbol.replace('USDT', '');
        const result = await this.filterManager.checkFilter(userId, cleanSymbol);
        if (result.allowed) {
          allowed.push(change);
        } else {
          log.debug('Change excluded from push trigger (user filter)', {
            symbol: change.symbol,
            changeType: change.changeType,
            filterSource: result.source
          });
        }
      } catch (err) {
        // 过滤器出错时为安全起见保留（避免误过滤）
        log.warn('Filter check failed, keeping change', { symbol: change.symbol, err });
        allowed.push(change);
      }
    }
    return allowed;
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
        // 只推送排名上升（changeValue > 0），下降不推送
        return (change.changeValue || 0) >= this.config.majorMoveThreshold;

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
  private async sendRankingAlert(
    currentRankings: RankingResult[],
    changes: any[],
    l1NewTop?: any
  ): Promise<void> {
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
      // L1 榜首易主时替换标题为强提醒样式（保留下方 TOP10 列表）
      let message: string;
      if (l1NewTop) {
        const newTopSym = l1NewTop.symbol.replace('USDT', '');
        message = `🚨 *L1 · 榜首易主 — ${newTopSym}*\n\n`;
      } else {
        message = `🏆 *24小时涨幅榜 TOP10*\n\n`;
      }

      // 应用用户过滤设置 - 涨幅榜只过滤下架/系统黑名单，mute/黄名单代币加标识显示
      let filteredRankings = currentRankings;
      const symbolFilterStatus = new Map<string, {allowed: boolean, source: string}>();

      if (this.filterManager) {
        try {
          const userId = authorizedUserId.toString();

          // 逐个检查每个代币的过滤状态
          for (const ranking of currentRankings) {
            const cleanSymbol = ranking.symbol.replace('USDT', '');
            const filterResult = await this.filterManager.checkFilter(userId, cleanSymbol);

            // 涨幅榜只过滤掉真正不应该显示的代币（下架、系统黑名单）
            const shouldExclude = !filterResult.allowed &&
              (filterResult.source === 'system_delisted' || filterResult.source === 'system_blacklist');

            symbolFilterStatus.set(ranking.symbol, {
              allowed: !shouldExclude,
              source: filterResult.source
            });
          }

          // 只过滤掉真正不应该显示的代币
          filteredRankings = currentRankings.filter(ranking => {
            const status = symbolFilterStatus.get(ranking.symbol);
            return status?.allowed !== false;
          });

          if (filteredRankings.length < currentRankings.length) {
            log.info('Some symbols excluded from ranking (delisted/system blacklist)', {
              originalCount: currentRankings.length,
              filteredCount: filteredRankings.length,
              userId
            });
          }
        } catch (filterError) {
          log.error('Error applying filters to ranking push, showing all symbols', { filterError });
        }
      }

      const top10 = filteredRankings.slice(0, 10);
      const priceFormatPromises = top10.map(async (ranking, index) => {
        const symbol = ranking.symbol.replace('USDT', '');
        const changePercent = formatPriceChange(ranking.priceChangePercent);
        const formattedPrice = await formatPriceWithSeparators(ranking.price.toString(), ranking.symbol);
        const riskLevel = getTokenRiskLevel(ranking.symbol);
        const riskIcon = getRiskIcon(riskLevel);

        // 根据过滤状态添加标识
        const filterStatus = symbolFilterStatus.get(ranking.symbol);
        let prefixIcon = riskIcon || '';

        if (filterStatus) {
          switch (filterStatus.source) {
            case 'user_mute':
              prefixIcon = '🔇'; // mute代币显示静音图标
              break;
            case 'system_yellowlist':
            case 'user_yellowlist':
              prefixIcon = '🟡'; // 黄名单代币
              break;
            case 'user_blacklist':
              prefixIcon = '🔒'; // 用户黑名单显示锁定图标
              break;
            // system_delisted 和 system_blacklist 已经被过滤掉了
          }
        }

        const volumeIcon = getVolumeIcon(ranking.volume);
        const prefix = `${volumeIcon}${prefixIcon || ''}`;
        const sign = ranking.priceChangePercent >= 0 ? '+' : '';
        return `${index + 1}. ${prefix}**${symbol}** ${sign}${changePercent}% ($${formattedPrice})\n`;
      });

      const formattedEntries = await Promise.all(priceFormatPromises);
      formattedEntries.forEach(entry => {
        message += entry;
      });

      // 添加变化提示（只过滤真正不应该显示的代币）
      let filteredNewEntries = changes.filter(c => c.changeType === 'new_entry');
      let filteredPositionChanges = changes.filter(c => c.changeType === 'position_change');

      // 对变化提示也应用相同的过滤逻辑
      if (this.filterManager) {
        try {
          const userId = authorizedUserId.toString();

          // 过滤新进入的代币（只过滤下架/系统黑名单）
          if (filteredNewEntries.length > 0) {
            const allowedNewEntries = [];
            for (const change of filteredNewEntries) {
              const cleanSymbol = change.symbol.replace('USDT', '');
              const filterResult = await this.filterManager.checkFilter(userId, cleanSymbol);

              // 只过滤掉真正不应该显示的代币
              const shouldExclude = !filterResult.allowed &&
                (filterResult.source === 'system_delisted' || filterResult.source === 'system_blacklist');

              if (!shouldExclude) {
                allowedNewEntries.push(change);
              }
            }
            filteredNewEntries = allowedNewEntries;
          }

          // 过滤排名变化的代币（只过滤下架/系统黑名单）
          if (filteredPositionChanges.length > 0) {
            const allowedPositionChanges = [];
            for (const change of filteredPositionChanges) {
              const cleanSymbol = change.symbol.replace('USDT', '');
              const filterResult = await this.filterManager.checkFilter(userId, cleanSymbol);

              // 只过滤掉真正不应该显示的代币
              const shouldExclude = !filterResult.allowed &&
                (filterResult.source === 'system_delisted' || filterResult.source === 'system_blacklist');

              if (!shouldExclude) {
                allowedPositionChanges.push(change);
              }
            }
            filteredPositionChanges = allowedPositionChanges;
          }
        } catch (filterError) {
          log.error('Error applying filters to ranking changes', { filterError });
        }
      }

      // L1 榜首易主置顶显示，从常规列表中剔除避免重复
      if (l1NewTop) {
        filteredNewEntries = filteredNewEntries.filter(c => c !== l1NewTop);
        filteredPositionChanges = filteredPositionChanges.filter(c => c !== l1NewTop);
      }

      if (l1NewTop || filteredNewEntries.length > 0 || filteredPositionChanges.length > 0) {
        message += `\n📊 *本次变化:*\n`;

        // L1 榜首易主（强提醒）
        if (l1NewTop) {
          const sym = l1NewTop.symbol.replace('USDT', '');
          const ticker = realtimeMarketCache.getTickerData(l1NewTop.symbol);
          const volumeIcon = getVolumeIcon(ticker?.volume);
          const filterStatus = symbolFilterStatus.get(l1NewTop.symbol);
          let prefixIcon = '';
          if (filterStatus) {
            switch (filterStatus.source) {
              case 'user_mute':
                prefixIcon = '🔇';
                break;
              case 'system_yellowlist':
              case 'user_yellowlist':
                prefixIcon = '🟡';
                break;
              case 'user_blacklist':
                prefixIcon = '🔒';
                break;
            }
          }
          const prefix = `${volumeIcon}${prefixIcon}`;
          if (l1NewTop.changeType === 'new_entry') {
            message += `• 🚨 L1 ${prefix}**${sym}** 新进入榜首 #1\n`;
          } else {
            message += `• 🚨 L1 ${prefix}**${sym}** 登顶 (#${l1NewTop.previousPosition}→#1)\n`;
          }
        }

        // 新进入前10
        if (filteredNewEntries.length > 0) {
          for (const change of filteredNewEntries.slice(0, 2)) {
            const symbol = change.symbol.replace('USDT', '');

            // 添加过滤状态标识
            const filterStatus = symbolFilterStatus.get(change.symbol);
            let prefixIcon = '';
            if (filterStatus) {
              switch (filterStatus.source) {
                case 'user_mute':
                  prefixIcon = '🔇';
                  break;
                case 'system_yellowlist':
                case 'user_yellowlist':
                  prefixIcon = '🟡';
                  break;
                case 'user_blacklist':
                  prefixIcon = '🔒';
                  break;
              }
            }

            const ticker = realtimeMarketCache.getTickerData(change.symbol);
            const volumeIcon = getVolumeIcon(ticker?.volume);
            const prefix = `${volumeIcon}${prefixIcon || ''}`;
            message += `• 🆕 ${prefix}**${symbol}** 新进入#${change.currentPosition}\n`;
          }
        }

        // 排名大幅变化
        if (filteredPositionChanges.length > 0) {
          for (const change of filteredPositionChanges.slice(0, 2)) {
            const symbol = change.symbol.replace('USDT', '');

            // 添加过滤状态标识
            const filterStatus = symbolFilterStatus.get(change.symbol);
            let prefixIcon = '';
            if (filterStatus) {
              switch (filterStatus.source) {
                case 'user_mute':
                  prefixIcon = '🔇';
                  break;
                case 'system_yellowlist':
                case 'user_yellowlist':
                  prefixIcon = '🟡';
                  break;
                case 'user_blacklist':
                  prefixIcon = '🔒';
                  break;
              }
            }

            const ticker = realtimeMarketCache.getTickerData(change.symbol);
            const volumeIcon = getVolumeIcon(ticker?.volume);
            const prefix = `${volumeIcon}${prefixIcon || ''}`;
            const moveDirection = change.changeValue > 0 ? '⬆️' : '⬇️';
            const moveText = change.changeValue > 0 ? '上升' : '下降';
            message += `• ${moveDirection} ${prefix}**${symbol}** ${moveText}${Math.abs(change.changeValue)}位 (#${change.previousPosition}→#${change.currentPosition})\n`;
          }
        }
      }

      message += `\n📊 数据来源: ⚡ 实时数据`;
      message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;

      // 发送消息
      const userId = this.telegramBot.getAuthorizedUserId();
      if (userId) {
        // L1 榜首易主留痕（供 /brief 汇总）
        if (l1NewTop) {
          try {
            RankingAlertModel.recordAlert({
              symbol: l1NewTop.symbol,
              alertType: 'l1_new_top',
              changeType: l1NewTop.changeType === 'new_entry' ? 'new_entry' : 'position_change',
              previousPosition: l1NewTop.changeType === 'new_entry' ? null : (l1NewTop.previousPosition ?? null),
              triggeredAt: Date.now(),
            });
          } catch (e) {
            log.error('Failed to persist L1 ranking alert', e);
          }
        }

        await this.telegramBot.sendToAuthorizedUser(message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        });

        log.info(`Realtime ranking alert sent`, {
          userId,
          changesCount: changes.length,
          newEntries: filteredNewEntries.length,
          positionChanges: filteredPositionChanges.length
        });

        // ESP32 语音：只念一条最关键的（避免一次 push 播过长）
        // 优先级：L1 榜首易主 > 新入榜 > 排名上升
        let tts = '';
        if (l1NewTop) {
          const sym = (l1NewTop.symbol || '').replace(/USDT$/i, '');
          tts = `L1 榜首易主 ${sym}`;
        } else if (filteredNewEntries.length > 0) {
          const first = filteredNewEntries[0];
          const sym = ((first as any).symbol || '').replace(/USDT$/i, '');
          tts = `涨幅榜新进入 ${sym}`;
        } else if (filteredPositionChanges.length > 0) {
          const first = filteredPositionChanges[0] as any;
          const sym = (first.symbol || '').replace(/USDT$/i, '');
          const dir = first.changeValue > 0 ? '上升' : '下降';
          tts = `${sym} 排名${dir}`;
        }
        if (tts) {
          await esp32NotificationService.pushAlert('ranking', tts);
        }
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