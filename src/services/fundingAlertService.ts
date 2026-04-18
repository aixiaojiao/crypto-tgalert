import { binanceClient } from './binance';
import { FundingAlertModel, FundingAlertRecord, FundingAlertType } from '../models/fundingAlertModel';
import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { filterTradingPairs, isRiskyToken } from '../config/tokenLists';
import { resolve } from '../core/container';
import { SERVICE_IDENTIFIERS } from '../core/container/decorators';
import { IAdvancedFilterManager } from './filters/AdvancedFilterManager';
import { esp32NotificationService } from './esp32';

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
  // 全局成交量过滤（与其他报警保持一致）
  MIN_VOLUME_USDT: 30_000_000,

  // 费率阈值（8h 归一化后的小数值）
  RATE_THRESHOLDS: [
    { type: 'negative' as FundingAlertType, threshold: 0, label: '负费率', icon: '🔴' },
    { type: 'rate_-0.5' as FundingAlertType, threshold: -0.005, label: '-0.5%', icon: '🟠' },
    { type: 'rate_-1' as FundingAlertType, threshold: -0.01, label: '-1%', icon: '🔥' },
    { type: 'rate_-1.5' as FundingAlertType, threshold: -0.015, label: '-1.5%', icon: '💀' },
  ],

  // 周期阈值
  INTERVAL_THRESHOLDS: [
    { type: 'interval_4h' as FundingAlertType, interval: 4, label: '4h', icon: '⚠️' },
    { type: 'interval_1h' as FundingAlertType, interval: 1, label: '1h', icon: '🚨' },
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
      if (volume < CONFIG.MIN_VOLUME_USDT) continue;

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

      // 检查费率阈值
      for (const { type, threshold, label, icon } of CONFIG.RATE_THRESHOLDS) {
        const triggered = type === 'negative'
          ? fundingRate8h < 0
          : fundingRate8h <= threshold;

        if (triggered && !FundingAlertModel.hasAlertedRecently(symbol, type)) {
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

      // 检查周期阈值
      for (const { type, interval, label, icon } of CONFIG.INTERVAL_THRESHOLDS) {
        if (fundingIntervalHours === interval && !FundingAlertModel.hasAlertedRecently(symbol, type)) {
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

    let title: string;
    if (isInterval) {
      title = `费率周期异常 — ${displaySymbol}`;
    } else {
      title = `费率报警 ${label} — ${displaySymbol}`;
    }

    let message = `${icon} *${title}*\n\n`;
    message += `💸 *当前费率 (8h):* ${fundingPct}%\n`;

    if (r.fundingIntervalHours !== 8) {
      message += `⏱ *结算周期:* ${r.fundingIntervalHours}h（非标准 8h）\n`;
    }

    if (isInterval) {
      message += `\n⚠️ 交易所已将结算周期调整为 *${r.fundingIntervalHours}h*，说明行情极端！\n`;
    }

    message += `\n⏰ *触发时间:* ${new Date(r.triggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    message += `\n💡 _同一币种同一阈值 4 小时内仅报警一次_`;

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
