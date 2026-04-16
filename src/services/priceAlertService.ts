import { EventEmitter } from 'events';
import { log } from '../utils/logger';
import { PriceAlertModel, PriceAlertConfig } from '../models/priceAlertModel';
import { TelegramBot } from '../bot';
import { formatPriceWithSeparators, formatPriceChange } from '../utils/priceFormatter';
import { getTokenRiskLevel, getRiskIcon } from '../config/tokenLists';
import { resolve } from '../core/container';
import { SERVICE_IDENTIFIERS } from '../core/container/decorators';
import { IAdvancedFilterManager } from './filters/AdvancedFilterManager';
import { realtimeMarketCache } from './realtimeMarketCache';
import { esp32NotificationService } from './esp32';

export interface PriceSnapshot {
  symbol: string;
  price: number;
  timestamp: number;
  volume24h: number;
}

export interface TimeframeData {
  timeframe: string;
  windowMs: number;
  snapshots: Map<string, PriceSnapshot[]>; // symbol -> snapshots
}

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

/**
 * 多时间周期价格报警服务
 * 监控价格变动并触发用户自定义的报警条件
 */
export class PriceAlertService extends EventEmitter {
  private telegramBot: TelegramBot | null = null;
  private isEnabled: boolean = false;
  private alertConfigs: Map<number, PriceAlertConfig> = new Map();
  private filterManager: IAdvancedFilterManager | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // 多时间周期数据存储
  private timeframes: Map<string, TimeframeData> = new Map();

  // 1分钟内防重复通知记录 (symbol:timeframe -> 最后触发时间)
  private recentTriggers: Map<string, {changePercent: number, price: number, timestamp: number}> = new Map();

  constructor() {
    super();
    this.initializeTimeframes();

    // Initialize filter manager
    try {
      this.filterManager = resolve(SERVICE_IDENTIFIERS.ADVANCED_FILTER_MANAGER) as IAdvancedFilterManager;
    } catch (error) {
      log.warn('Failed to initialize filter manager in PriceAlertService', { error });
    }
  }

  /**
   * 初始化时间周期数据结构
   */
  private initializeTimeframes(): void {
    const timeframeConfigs = [
      { timeframe: '1m', windowMs: 1 * 60 * 1000 },
      { timeframe: '5m', windowMs: 5 * 60 * 1000 },
      { timeframe: '15m', windowMs: 15 * 60 * 1000 },
      { timeframe: '30m', windowMs: 30 * 60 * 1000 },
      { timeframe: '1h', windowMs: 60 * 60 * 1000 },
      { timeframe: '4h', windowMs: 4 * 60 * 60 * 1000 },
      { timeframe: '24h', windowMs: 24 * 60 * 60 * 1000 },
      { timeframe: '3d', windowMs: 3 * 24 * 60 * 60 * 1000 }
    ];

    for (const config of timeframeConfigs) {
      this.timeframes.set(config.timeframe, {
        timeframe: config.timeframe,
        windowMs: config.windowMs,
        snapshots: new Map()
      });
    }

    log.info('Price alert timeframes initialized', {
      timeframes: Array.from(this.timeframes.keys())
    });
  }

  /**
   * 设置Telegram Bot实例
   */
  setTelegramBot(bot: TelegramBot): void {
    this.telegramBot = bot;
    log.info('TelegramBot instance set in PriceAlertService');
  }

  /**
   * 启动价格报警服务
   */
  async start(): Promise<void> {
    if (this.isEnabled) {
      log.warn('PriceAlertService is already running');
      return;
    }

    if (!this.telegramBot) {
      throw new Error('TelegramBot instance must be set before starting PriceAlertService');
    }

    // 确保数据库已初始化，然后加载配置
    if (PriceAlertModel.isDatabaseInitialized()) {
      await this.loadAlertConfigs();
    } else {
      log.warn('Database not initialized, will load configs later when available');
    }

    this.isEnabled = true;

    // 定期清理过期数据和冷却记录
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredData();
      this.cleanupExpiredCooldowns();
    }, 5 * 60 * 1000); // 每5分钟清理一次

    log.info('PriceAlertService started successfully', {
      enabledAlerts: this.alertConfigs.size
    });
  }

  /**
   * 停止价格报警服务
   */
  async stop(): Promise<void> {
    this.isEnabled = false;

    // 清理定时器
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.alertConfigs.clear();
    this.recentTriggers.clear();

    // 清空所有时间周期数据
    for (const timeframeData of this.timeframes.values()) {
      timeframeData.snapshots.clear();
    }

    log.info('PriceAlertService stopped');
  }

  /**
   * 处理价格更新 (由WebSocket调用)
   */
  async onPriceUpdate(symbol: string, price: number, volume24h: number): Promise<void> {
    if (!this.isEnabled) return;

    const now = Date.now();
    const snapshot: PriceSnapshot = {
      symbol,
      price,
      timestamp: now,
      volume24h
    };


    // 存储到所有时间周期
    for (const timeframeData of this.timeframes.values()) {
      let symbolSnapshots = timeframeData.snapshots.get(symbol);
      if (!symbolSnapshots) {
        symbolSnapshots = [];
        timeframeData.snapshots.set(symbol, symbolSnapshots);
      }

      symbolSnapshots.push(snapshot);

      // 移除超出时间窗口的数据
      const cutoffTime = now - timeframeData.windowMs;
      timeframeData.snapshots.set(
        symbol,
        symbolSnapshots.filter(s => s.timestamp > cutoffTime)
      );
    }

    // 检查报警条件
    await this.checkAlertConditions(symbol, snapshot);
  }

  /**
   * 检查报警条件
   */
  private async checkAlertConditions(symbol: string, currentSnapshot: PriceSnapshot): Promise<void> {

    for (const config of this.alertConfigs.values()) {
      // 跳过已禁用的配置
      if (!config.isEnabled) continue;

      // 检查代币过滤
      if (config.symbol && config.symbol !== symbol) continue;

      // 获取对应时间周期的历史数据
      const timeframeData = this.timeframes.get(config.timeframe);
      if (!timeframeData) continue;

      const symbolSnapshots = timeframeData.snapshots.get(symbol);
      if (!symbolSnapshots || symbolSnapshots.length < 2) continue;

      // 计算时间窗口开始的价格 - 使用更稳定的算法
      const now = Date.now();
      const windowStart = now - timeframeData.windowMs;

      // 找到最接近窗口开始时间的快照，而不是第一个满足条件的
      let startSnapshot = symbolSnapshots[0]; // 默认最早的
      let minTimeDiff = Math.abs(startSnapshot.timestamp - windowStart);

      for (const snapshot of symbolSnapshots) {
        const timeDiff = Math.abs(snapshot.timestamp - windowStart);
        if (timeDiff < minTimeDiff && snapshot.timestamp <= windowStart) {
          startSnapshot = snapshot;
          minTimeDiff = timeDiff;
        }
      }

      if (!startSnapshot) continue;

      // 计算价格变动百分比
      const changePercent = ((currentSnapshot.price - startSnapshot.price) / startSnapshot.price) * 100;
      const absChangePercent = Math.abs(changePercent);

      // 检查变动是否足够显著(避免微小波动触发)
      if (absChangePercent < 0.1) continue; // 小于0.1%的变动忽略

      // 检查是否触发报警条件
      let shouldTrigger = false;
      switch (config.alertType) {
        case 'gain':
          shouldTrigger = changePercent > 0 && absChangePercent >= config.thresholdPercent;
          break;
        case 'loss':
          shouldTrigger = changePercent < 0 && absChangePercent >= config.thresholdPercent;
          break;
        case 'both':
          shouldTrigger = absChangePercent >= config.thresholdPercent;
          break;
      }

      if (shouldTrigger) {
        // 1分钟内防重复通知检查

        // 动态冷却规则: 根据时间框架计算冷却时间
        const globalKey = `${symbol}:${config.timeframe}`;
        const globalRecent = this.recentTriggers.get(globalKey);

        // 计算动态冷却时间
        const cooldownMs = this.calculateCooldownMs(config.timeframe);
        const cooldownMinutes = Math.floor(cooldownMs / (60 * 1000)); // 转换为分钟显示

        if (globalRecent && now - globalRecent.timestamp < cooldownMs) {
          const passedSeconds = Math.floor((now - globalRecent.timestamp) / 1000);
          log.info(`🚫 ${cooldownMinutes}分钟内重复通知 ${symbol} ${config.timeframe}: 距离上次通知 ${passedSeconds}秒`);
          continue;
        }

        // 立即记录触发时间，防止并发问题
        const triggerTime = Date.now();
        this.recentTriggers.set(globalKey, {
          changePercent,
          price: currentSnapshot.price,
          timestamp: triggerTime
        });

        // 异步触发报警
        await this.triggerAlert(config, symbol, {
          changePercent,
          fromPrice: startSnapshot.price,
          toPrice: currentSnapshot.price,
          timeframe: config.timeframe,
          volume24h: currentSnapshot.volume24h
        });

        log.info(`✅ Alert triggered for ${symbol} ${config.timeframe}: ${changePercent.toFixed(2)}% change`);
      }
    }
  }

  /**
   * 计算基于时间框架的动态冷却时间
   * 规则：冷却时间 = 时间框架 ÷ 2
   * 限制：最低1分钟，最高2小时
   */
  private calculateCooldownMs(timeframe: string): number {
    const timeframeMap: Record<string, number> = {
      '1m': 1 * 60 * 1000,      // 1分钟 → 30秒冷却
      '5m': 5 * 60 * 1000,      // 5分钟 → 2.5分钟冷却
      '15m': 15 * 60 * 1000,    // 15分钟 → 7.5分钟冷却
      '30m': 30 * 60 * 1000,    // 30分钟 → 15分钟冷却
      '1h': 60 * 60 * 1000,     // 1小时 → 30分钟冷却
      '4h': 4 * 60 * 60 * 1000, // 4小时 → 2小时冷却
      '24h': 24 * 60 * 60 * 1000, // 24小时 → 12小时冷却（超过上限）
      '3d': 3 * 24 * 60 * 60 * 1000 // 3天 → 36小时冷却（超过上限）
    };

    const timeframeMs = timeframeMap[timeframe] || (5 * 60 * 1000); // 默认5分钟
    const cooldownMs = timeframeMs / 2; // 除以2

    // 限制：最低1分钟(60000ms)，最高2小时(7200000ms)
    const MIN_COOLDOWN = 1 * 60 * 1000;
    const MAX_COOLDOWN = 2 * 60 * 60 * 1000;

    return Math.max(MIN_COOLDOWN, Math.min(MAX_COOLDOWN, cooldownMs));
  }

  /**
   * 触发报警
   */
  private async triggerAlert(
    config: PriceAlertConfig,
    symbol: string,
    alertData: {
      changePercent: number;
      fromPrice: number;
      toPrice: number;
      timeframe: string;
      volume24h: number;
    }
  ): Promise<void> {
    try {
      // 记录触发历史
      await PriceAlertModel.recordTrigger({
        configId: config.id!,
        symbol,
        timeframe: alertData.timeframe,
        changePercent: alertData.changePercent,
        fromPrice: alertData.fromPrice,
        toPrice: alertData.toPrice,
        volume24h: alertData.volume24h
      });

      // 发送推送消息
      await this.sendAlertMessage(config, symbol, alertData);

      log.info('Price alert triggered', {
        configId: config.id,
        userId: config.userId,
        symbol,
        timeframe: alertData.timeframe,
        changePercent: alertData.changePercent.toFixed(2)
      });

    } catch (error) {
      log.error('Failed to trigger price alert', error);
    }
  }

  /**
   * 发送报警推送消息
   */
  private async sendAlertMessage(
    config: PriceAlertConfig,
    symbol: string,
    alertData: {
      changePercent: number;
      fromPrice: number;
      toPrice: number;
      timeframe: string;
      volume24h: number;
    }
  ): Promise<void> {
    if (!this.telegramBot) return;

    try {
      // 检查是否应该发送警报（过滤检查）
      let filterReason = '';
      if (this.filterManager) {
        const filterResult = await this.filterManager.shouldSendAlert(
          config.userId,
          symbol,
          'price_alert'
        );

        if (!filterResult.allowed) {
          // 记录被屏蔽的警报统计
          await PriceAlertModel.recordFilteredAlert({
            configId: config.id!,
            symbol,
            filterReason: filterResult.reason,
            filterSource: filterResult.source
          });

          log.info('Price alert filtered out', {
            userId: config.userId,
            symbol,
            timeframe: alertData.timeframe,
            reason: filterResult.reason
          });
          return;
        }

        // 保存风险标识用于消息生成
        if (filterResult.reason && filterResult.reason.includes('黄名单')) {
          filterReason = filterResult.reason;
        }
      }
      const cleanSymbol = symbol.replace('USDT', '');
      const changeSign = alertData.changePercent >= 0 ? '+' : '';
      const changeText = alertData.changePercent >= 0 ? '上涨' : '下跌';
      const formattedChange = formatPriceChange(Math.abs(alertData.changePercent));
      const formattedFromPrice = await formatPriceWithSeparators(alertData.fromPrice.toString(), symbol);
      const formattedToPrice = await formatPriceWithSeparators(alertData.toPrice.toString(), symbol);

      // 获取风险标识
      const riskLevel = getTokenRiskLevel(symbol);
      const riskIcon = getRiskIcon(riskLevel);
      const riskPrefix = riskIcon ? `${riskIcon} ` : '';

      // 获取24h涨幅作为背景信息 (使用与/rank命令相同的实时缓存数据)
      let backgroundInfo = '';
      const tickerData = realtimeMarketCache.getTickerData(symbol);
      if (tickerData && tickerData.priceChangePercent !== undefined) {
        const dailyChange = tickerData.priceChangePercent;
        const dailyChangeText = formatPriceChange(Math.abs(dailyChange));
        const dailySign = dailyChange >= 0 ? '+' : '';
        backgroundInfo = `\n24h涨幅: ${dailySign}${dailyChangeText}%`;
      }

      // 时间周期显示名称
      const timeframeNames: Record<string, string> = {
        '1m': '1分钟',
        '5m': '5分钟',
        '15m': '15分钟',
        '30m': '30分钟',
        '1h': '1小时',
        '4h': '4小时',
        '24h': '24小时',
        '3d': '3天'
      };

      const timeframeName = timeframeNames[alertData.timeframe] || alertData.timeframe;
      const alertTypeText = config.alertType === 'gain' ? '涨幅' :
                           config.alertType === 'loss' ? '跌幅' : '变动';

      // 根据警报ID和涨跌方向获取视觉标识
      const isGain = alertData.changePercent >= 0;
      const visualIcon = (await import('../utils/alertParser')).AlertCommandParser.getAlertVisualIcon(
        config.id?.toString() || 'unknown',
        isGain
      );
      const alertTitle = isGain ? '拉涨报警' : '下跌报警';

      // 组合风险标识
      const allRiskPrefix = riskPrefix + (filterReason ? `${filterReason} ` : '');

      const message = `${visualIcon} *${alertTitle}*

${allRiskPrefix}**${cleanSymbol}/USDT**
${timeframeName}内${changeText} ${changeSign}${formattedChange}%
$${formattedFromPrice} → $${formattedToPrice}${backgroundInfo}

⚠️ *触发条件:* ${timeframeName}${alertTypeText} > ${config.thresholdPercent}%
⏰ ${formatTimeToUTC8(new Date())}`;

      // 发送给配置的用户
      await this.telegramBot.sendMessage(parseInt(config.userId), message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      // ESP32 语音推送（短摘要）
      const tts = `${cleanSymbol} ${timeframeName}${changeText}${changeSign}${formattedChange}%`;
      await esp32NotificationService.pushAlert('pump_dump', tts);

    } catch (error) {
      log.error('Failed to send price alert message', error);
    }
  }

  /**
   * 加载报警配置
   */
  private async loadAlertConfigs(): Promise<void> {
    try {
      // 检查数据库是否已初始化
      if (!PriceAlertModel.isDatabaseInitialized()) {
        log.warn('Price alert database not yet initialized, skipping config load');
        return;
      }

      const configs = await PriceAlertModel.getEnabledAlerts();
      this.alertConfigs.clear();

      for (const config of configs) {
        if (config.id) {
          this.alertConfigs.set(config.id, config);
        }
      }

      // 详细记录加载的警报配置，特别关注下跌警报
      const alertTypeCounts = {
        gain: 0,
        loss: 0,
        both: 0
      };

      for (const config of this.alertConfigs.values()) {
        if (config.alertType in alertTypeCounts) {
          alertTypeCounts[config.alertType as keyof typeof alertTypeCounts]++;
        }
      }

      log.info(`Loaded ${this.alertConfigs.size} enabled price alert configs`, {
        gain: alertTypeCounts.gain,
        loss: alertTypeCounts.loss,
        both: alertTypeCounts.both,
        total: this.alertConfigs.size
      });
    } catch (error) {
      log.error('Failed to load alert configs', error);
    }
  }

  /**
   * 重新加载配置 (当用户修改配置时调用)
   */
  async reloadConfigs(): Promise<void> {
    if (PriceAlertModel.isDatabaseInitialized()) {
      await this.loadAlertConfigs();
    } else {
      log.warn('Database not initialized, cannot reload configs');
    }
  }

  /**
   * 清理过期数据
   */
  private cleanupExpiredData(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const timeframeData of this.timeframes.values()) {
      const cutoffTime = now - timeframeData.windowMs;

      for (const [symbol, snapshots] of timeframeData.snapshots.entries()) {
        const beforeCount = snapshots.length;
        const filtered = snapshots.filter(s => s.timestamp > cutoffTime);

        if (filtered.length === 0) {
          timeframeData.snapshots.delete(symbol);
        } else {
          timeframeData.snapshots.set(symbol, filtered);
        }

        cleanedCount += beforeCount - filtered.length;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`Cleaned up ${cleanedCount} expired price snapshots`);
    }
  }

  /**
   * 清理过期的冷却记录
   */
  private cleanupExpiredCooldowns(): void {
    const now = Date.now();
    let cleanedCount = 0;

    // 清理过期的触发记录 (保留5分钟)
    for (const [key, record] of this.recentTriggers.entries()) {
      if (now - record.timestamp > 5 * 60 * 1000) {
        this.recentTriggers.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`Cleaned up ${cleanedCount} expired trigger records`);
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      alertConfigs: this.alertConfigs.size,
      recentTriggers: this.recentTriggers.size,
      timeframeDataCounts: Object.fromEntries(
        Array.from(this.timeframes.entries()).map(([tf, data]) => [
          tf, data.snapshots.size
        ])
      )
    };
  }
}

// 创建全局实例
export const priceAlertService = new PriceAlertService();