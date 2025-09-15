import { EventEmitter } from 'events';
import { log } from '../utils/logger';
import { PriceAlertModel, PriceAlertConfig } from '../models/priceAlertModel';
import { TelegramBot } from '../bot';
import { formatPriceWithSeparators, formatPriceChange } from '../utils/priceFormatter';
import { getTokenRiskLevel, getRiskIcon } from '../config/tokenLists';

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

  // 多时间周期数据存储
  private timeframes: Map<string, TimeframeData> = new Map();

  // 冷却期管理 (防止同一配置短时间内重复触发)
  private cooldownMap: Map<string, number> = new Map(); // configId:symbol -> timestamp
  private readonly COOLDOWN_MS = 5 * 60 * 1000; // 5分钟冷却期

  constructor() {
    super();
    this.initializeTimeframes();
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
    setInterval(() => {
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
    this.alertConfigs.clear();
    this.cooldownMap.clear();

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

      // 检查冷却期
      const cooldownKey = `${config.id}:${symbol}`;
      const lastTrigger = this.cooldownMap.get(cooldownKey);
      if (lastTrigger && Date.now() - lastTrigger < this.COOLDOWN_MS) continue;

      // 获取对应时间周期的历史数据
      const timeframeData = this.timeframes.get(config.timeframe);
      if (!timeframeData) continue;

      const symbolSnapshots = timeframeData.snapshots.get(symbol);
      if (!symbolSnapshots || symbolSnapshots.length < 2) continue;

      // 计算时间窗口开始的价格
      const windowStart = Date.now() - timeframeData.windowMs;
      const startSnapshot = symbolSnapshots.find(s => s.timestamp <= windowStart) ||
                           symbolSnapshots[0]; // 如果没有足够历史数据，使用最早的

      if (!startSnapshot) continue;

      // 计算价格变动百分比
      const changePercent = ((currentSnapshot.price - startSnapshot.price) / startSnapshot.price) * 100;
      const absChangePercent = Math.abs(changePercent);

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
        await this.triggerAlert(config, symbol, {
          changePercent,
          fromPrice: startSnapshot.price,
          toPrice: currentSnapshot.price,
          timeframe: config.timeframe,
          volume24h: currentSnapshot.volume24h
        });

        // 设置冷却期
        this.cooldownMap.set(cooldownKey, Date.now());
      }
    }
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

      // 获取24h涨幅作为背景信息 (如果有的话)
      let backgroundInfo = '';
      const dailyData = this.timeframes.get('24h');
      if (dailyData) {
        const dailySnapshots = dailyData.snapshots.get(symbol);
        if (dailySnapshots && dailySnapshots.length >= 2) {
          const dailyStart = dailySnapshots[0];
          const dailyChange = ((alertData.toPrice - dailyStart.price) / dailyStart.price) * 100;
          const dailyChangeText = formatPriceChange(Math.abs(dailyChange));
          const dailySign = dailyChange >= 0 ? '+' : '';
          backgroundInfo = `\n24h涨幅: ${dailySign}${dailyChangeText}%`;
        }
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

      const message = `🚨 *价格急变报警*

${riskPrefix}**${cleanSymbol}/USDT**
${timeframeName}内${changeText} ${changeSign}${formattedChange}%
$${formattedFromPrice} → $${formattedToPrice}${backgroundInfo}

⚠️ *触发条件:* ${timeframeName}${alertTypeText} > ${config.thresholdPercent}%
⏰ ${formatTimeToUTC8(new Date())}`;

      // 发送给配置的用户
      await this.telegramBot.sendMessage(parseInt(config.userId), message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

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

      log.info(`Loaded ${this.alertConfigs.size} enabled price alert configs`);
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

    for (const [key, timestamp] of this.cooldownMap.entries()) {
      if (now - timestamp > this.COOLDOWN_MS) {
        this.cooldownMap.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`Cleaned up ${cleanedCount} expired cooldown records`);
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      enabled: this.isEnabled,
      alertConfigs: this.alertConfigs.size,
      activeCooldowns: this.cooldownMap.size,
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