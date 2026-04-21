import { binanceClient } from './binance';
import { FundingAlertModel, FundingAlertRecord, FundingAlertType } from '../models/fundingAlertModel';
import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { filterTradingPairs, isRiskyToken } from '../config/tokenLists';
import { resolve } from '../core/container';
import { SERVICE_IDENTIFIERS } from '../core/container/decorators';
import { IAdvancedFilterManager } from './filters/AdvancedFilterManager';
import { esp32NotificationService } from './esp32';
import { getVolumeThreshold } from '../config/volumeConfig';

/**
 * 费率报警配置
 *
 * 触发以下阈值时推送：
 *   - 费率降为负数 (< 0)
 *   - 费率突破 -0.5%、-1%、-1.5%（8h 归一化）
 *   - 费率周期变为 4h 或 1h（说明交易所判断行情极端）
 *
 * 同一 symbol + alertType 在 4 小时滑动窗口内只报一次。
 */
const CONFIG = {
  // 成交量过滤改为运行时从 volumeConfig.getVolumeThreshold() 读取（保留此处注释以便查找）

  // 费率阈值（8h 归一化后的小数值）
  RATE_THRESHOLDS: [
    { type: 'negative' as FundingAlertType, threshold: 0, label: 'L3 · 负费率', icon: '💸' },
    { type: 'rate_-0.5' as FundingAlertType, threshold: -0.005, label: 'L2 · 费率 -0.5%', icon: '💸' },
    { type: 'rate_-1' as FundingAlertType, threshold: -0.01, label: 'L1 · 费率 -1%', icon: '💸' },
    { type: 'rate_-1.5' as FundingAlertType, threshold: -0.015, label: 'L1+ · 费率 -1.5%', icon: '💸' },
  ],

  // negative 档位的最小绝对值门槛：费率抖动在 [-NEGATIVE_MIN_ABS, +∞) 视为"未进入负费率区间"，
  // 只有跌破 -NEGATIVE_MIN_ABS 才触发报警。避免 0 附近噪音抖动（历史数据 ~84% 属此类）。
  NEGATIVE_MIN_ABS: 0.0005, // 0.05%

  // 周期阈值
  INTERVAL_THRESHOLDS: [
    { type: 'interval_4h' as FundingAlertType, interval: 4, label: 'L2 · 周期异常 4h', icon: '💸' },
    { type: 'interval_1h' as FundingAlertType, interval: 1, label: 'L1 · 周期异常 1h', icon: '💸' },
  ],

  // 扫描频率
  SCAN_INTERVAL_MS: 10 * 60 * 1000, // 10 分钟
};

export class FundingAlertService {
  private telegramBot: TelegramBot | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private isRunning = false;
  private filterManager: IAdvancedFilterManager | null = null;

  constructor() {
    try {
      this.filterManager = resolve(SERVICE_IDENTIFIERS.ADVANCED_FILTER_MANAGER) as IAdvancedFilterManager;
    } catch (error) {
      log.warn('FundingAlertService: AdvancedFilterManager not available', { error });
    }
    log.info('FundingAlertService initialized');
  }

  setTelegramBot(bot: TelegramBot): void {
    this.telegramBot = bot;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('FundingAlertService already running');
      return;
    }
    this.isRunning = true;

    // 首次扫描延迟 3 分钟，避免启动期 API 撞车
    setTimeout(() => {
      this.safeScan();
    }, 3 * 60 * 1000);

    this.scanTimer = setInterval(() => {
      this.safeScan();
    }, CONFIG.SCAN_INTERVAL_MS);

    log.info('FundingAlertService started', {
      enabled: FundingAlertModel.isEnabled(),
      intervalMin: CONFIG.SCAN_INTERVAL_MS / 60000
    });
  }

  async stop(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.isRunning = false;
    log.info('FundingAlertService stopped');
  }

  private async safeScan(): Promise<void> {
    if (!FundingAlertModel.isEnabled()) {
      log.debug('FundingAlertService: scan skipped (disabled)');
      return;
    }
    if (this.isScanning) {
      log.warn('FundingAlertService: previous scan still running, skip');
      return;
    }
    this.isScanning = true;
    try {
      await this.doScan();
    } catch (error) {
      log.error('FundingAlertService: scan failed', error);
    } finally {
      this.isScanning = false;
    }
  }

  private async doScan(): Promise<void> {
    const scanStart = Date.now();

    // Step 1: 获取全部费率和 24h 统计（用于成交量过滤）
    const [allFunding, allStats] = await Promise.all([
      binanceClient.getAllFundingRates().catch((err: any) => {
        log.error('FundingAlertService: failed to fetch funding rates', err);
        return [];
      }),
      binanceClient.getFutures24hrStatsMultiple().catch((err: any) => {
        log.error('FundingAlertService: failed to fetch 24hr stats', err);
        return [];
      }),
    ]);

    if (allFunding.length === 0 || allStats.length === 0) {
      log.warn('FundingAlertService: no data, skip scan');
      return;
    }

    // 构建成交量 map
    const volumeMap = new Map<string, number>();
    for (const s of allStats) {
      volumeMap.set(s.symbol, parseFloat(s.quoteVolume));
    }

    // 过滤有效交易对
    const validSymbols = new Set(filterTradingPairs(allFunding.map(f => f.symbol)));
    const userId = this.telegramBot?.getAuthorizedUserId() || undefined;

    let alertCount = 0;

    for (const funding of allFunding) {
      const { symbol } = funding;
      if (!validSymbols.has(symbol)) continue;
      if (isRiskyToken(symbol)) continue;

      // 全局成交量过滤
      const volume = volumeMap.get(symbol) || 0;
      if (volume < getVolumeThreshold()) continue;

      // 用户自定义过滤
      if (this.filterManager && userId) {
        try {
          const cleanSymbol = symbol.replace('USDT', '');
          const filterResult = await this.filterManager.checkFilter(userId, cleanSymbol);
          if (!filterResult.allowed) continue;
        } catch (err) {
          log.warn('FundingAlertService: filter check failed', { symbol, err });
        }
      }

      const fundingRate8h = parseFloat(funding.fundingRate as any);
      const fundingIntervalHours = funding.fundingIntervalHours || 8;

      // 读取上次观察到的状态（费率 + 周期），用于两种边沿判断
      // - negative: 上次 >= 0 且本次 < 0
      // - interval_4h / interval_1h: 上次不是该周期且本次变为该周期
      // 首次观察一律只记录不报警，避免启动期轰炸
      const prevState = FundingAlertModel.getLastState(symbol);
      const prevRate = prevState?.rate ?? null;
      const prevInterval = prevState?.intervalHours ?? null;

      // 检查费率阈值
      // negative: 边沿触发；其他阈值保持电平触发 + 4h 去重
      for (const { type, threshold, label, icon } of CONFIG.RATE_THRESHOLDS) {
        let triggered: boolean;
        if (type === 'negative') {
          // 用 -NEGATIVE_MIN_ABS 作为双侧门槛：prev 处于 "非显著负" 区间且本次跌破门槛
          triggered = prevRate !== null
            && prevRate >= -CONFIG.NEGATIVE_MIN_ABS
            && fundingRate8h < -CONFIG.NEGATIVE_MIN_ABS;
        } else {
          triggered = fundingRate8h <= threshold;
        }

        // negative 已是边沿触发，无需再过 4h 冷却
        const needsDedup = type !== 'negative';
        if (triggered && (!needsDedup || !FundingAlertModel.hasAlertedRecently(symbol, type))) {
          const record: FundingAlertRecord = {
            symbol,
            alertType: type,
            fundingRate8h,
            fundingIntervalHours,
            triggeredAt: Date.now(),
          };
          FundingAlertModel.recordAlert(record);
          await this.sendNotification(record, label, icon);
          alertCount++;
        }
      }

      // 检查周期阈值（边沿触发：上次不是此周期，本次变为此周期）
      // 目的是只在交易所主动调整周期时报警，避免把"本来就是 4h"的大量山寨也报出来
      for (const { type, interval, label, icon } of CONFIG.INTERVAL_THRESHOLDS) {
        const triggered =
          prevInterval !== null &&
          prevInterval !== interval &&
          fundingIntervalHours === interval;
        if (triggered) {
          const record: FundingAlertRecord = {
            symbol,
            alertType: type,
            fundingRate8h,
            fundingIntervalHours,
            triggeredAt: Date.now(),
          };
          FundingAlertModel.recordAlert(record);
          await this.sendNotification(record, label, icon);
          alertCount++;
        }
      }

      // 更新状态（供下一轮扫描做边沿比对）
      FundingAlertModel.upsertRateState(symbol, fundingRate8h, fundingIntervalHours, Date.now());
    }

    const scanTime = Date.now() - scanStart;
    log.info('FundingAlertService: scan completed', {
      symbols: allFunding.length,
      alerts: alertCount,
      timeMs: scanTime
    });
  }

  private async sendNotification(record: FundingAlertRecord, label: string, icon: string): Promise<void> {
    if (!this.telegramBot) {
      log.warn('FundingAlertService: telegramBot not set, skip notification');
      return;
    }

    const userId = this.telegramBot.getAuthorizedUserId();
    if (!userId) return;

    const message = this.formatMessage(record, label, icon);

    try {
      await this.telegramBot.sendMessage(userId, message, { parse_mode: 'Markdown' });
      log.info('FundingAlertService: notification sent', {
        symbol: record.symbol,
        alertType: record.alertType
      });

      const sym = record.symbol.replace(/USDT$/i, '');
      const isInterval = record.alertType.startsWith('interval_');
      const voiceText = isInterval
        ? `费率周期 ${label} ${sym}`
        : `费率 ${label} ${sym}`;
      await esp32NotificationService.pushAlert('funding', voiceText);
    } catch (error) {
      log.error(`FundingAlertService: failed to send notification for ${record.symbol}`, error);
    }
  }

  private formatMessage(r: FundingAlertRecord, label: string, icon: string): string {
    const displaySymbol = r.symbol.replace('USDT', '');
    const fundingPct = (r.fundingRate8h * 100).toFixed(4);
    const isInterval = r.alertType.startsWith('interval_');

    const title = `${label} — ${displaySymbol}`;

    let message = `${icon} *${title}*\n\n`;
    message += `💸 *当前费率 (8h):* ${fundingPct}%\n`;

    if (r.fundingIntervalHours !== 8) {
      message += `⏱ *结算周期:* ${r.fundingIntervalHours}h（非标准 8h）\n`;
    }

    if (isInterval) {
      message += `\n⚠️ 交易所已将结算周期调整为 *${r.fundingIntervalHours}h*，说明行情极端！\n`;
    }

    message += `\n⏰ *触发时间:* ${new Date(r.triggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    if (r.alertType === 'negative') {
      message += `\n💡 _费率跌破 -0.05% 时触发（忽略 0 附近噪音），持续为负不重复提醒_`;
    } else {
      message += `\n💡 _同一币种同一阈值 4 小时内仅报警一次_`;
    }

    return message;
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    scanning: boolean;
    intervalMin: number;
    todayStats: { total: number; byType: Record<string, number> };
  } {
    return {
      running: this.isRunning,
      enabled: FundingAlertModel.isEnabled(),
      scanning: this.isScanning,
      intervalMin: CONFIG.SCAN_INTERVAL_MS / 60000,
      todayStats: FundingAlertModel.getTodayStats()
    };
  }
}

export const fundingAlertService = new FundingAlertService();
