import { binanceClient } from './binance';
import { PotentialAlertModel, PotentialAlertRecord } from '../models/potentialAlertModel';
import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { isRiskyToken, filterTradingPairs } from '../config/tokenLists';
import { formatPriceWithSeparators } from '../utils/priceFormatter';
import { resolve } from '../core/container';
import { SERVICE_IDENTIFIERS } from '../core/container/decorators';
import { IAdvancedFilterManager } from './filters/AdvancedFilterManager';
import { esp32NotificationService } from './esp32';
import { getVolumeThreshold } from '../config/volumeConfig';

/**
 * 潜力币信号扫描参数
 *
 * 信号定义（24h 窗口，三条件全部满足）：
 *   1) 价格 24h 涨幅 >= PRICE_CHANGE_THRESHOLD (5%)
 *   2) OI 24h 增长 >= OI_CHANGE_THRESHOLD (20%)
 *   3) Funding 至少满足以下之一：
 *      - 当前 funding (8h 归一化) <= 0
 *      - 24h 内 funding 降幅 >= 10bp（0.10%，在 8h 归一化后）
 *      - 当前 funding 原始值 < 近 24h funding 最高值（"松动"）
 *
 * 等级（由 funding 强度决定）：
 *   Level 1: funding (8h 归一化) <= -0.5%  （极强）
 *   Level 2: funding (8h 归一化) <= -0.1%  （强）
 *   Level 3: 其他（基础条件满足但 funding 未到负值极端）
 *
 * 注：TS 字段 priceChange1h/oiChange1h 是历史命名，语义上存储的是窗口内变化（当前=24h）。
 */
const CONFIG = {
  // 基础阈值（应用于 24h 窗口）
  PRICE_CHANGE_THRESHOLD_PERCENT: 5.0,
  OI_CHANGE_THRESHOLD_PERCENT: 20.0,
  FUNDING_DROP_BP: 0.001,  // 10 bp = 0.0010 (在 8h 归一化后的绝对下降量)

  // 等级阈值（针对 8h 归一化后的 funding）
  LEVEL_1_FUNDING: -0.005,  // -0.5%
  LEVEL_2_FUNDING: -0.001,  // -0.1%

  // 筛选：阈值不再硬编码，改由 getVolumeThreshold() 提供（见 extractCandidates 调用）

  // 扫描频率
  SCAN_INTERVAL_MS: 10 * 60 * 1000, // 10 分钟

  // 去重/冷却
  COOLDOWN_MS: 2 * 60 * 60 * 1000, // 同等级 2 小时冷却；升级立即推

  // OI 历史数据：1h × 24 条 = 24 小时窗口
  OI_HISTORY_PERIOD: '1h' as const,
  OI_HISTORY_LIMIT: 24,

  // 价格数据：1h × 24 条
  PRICE_KLINE_INTERVAL: '1h' as const,
  PRICE_KLINE_LIMIT: 24,

  // Funding 历史：取近 30 条，用于"松动"基准 + 24h 前 funding 对比
  FUNDING_HISTORY_LIMIT: 30,

  // 窗口长度（ms），用于 funding 24h 前对比
  WINDOW_MS: 24 * 60 * 60 * 1000,
};

export class PotentialAlertService {
  private telegramBot: TelegramBot | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private isScanning = false; // 防并发
  private isRunning = false;
  private filterManager: IAdvancedFilterManager | null = null;

  constructor() {
    try {
      this.filterManager = resolve(SERVICE_IDENTIFIERS.ADVANCED_FILTER_MANAGER) as IAdvancedFilterManager;
    } catch (error) {
      log.warn('PotentialAlertService: AdvancedFilterManager not available', { error });
    }
    log.info('PotentialAlertService initialized');
  }

  setTelegramBot(bot: TelegramBot): void {
    this.telegramBot = bot;
  }

  /**
   * 启动后台扫描（10 分钟一次）
   * 注意：受 PotentialAlertModel.isEnabled() 控制；关闭状态下定时器仍运行但直接跳过扫描
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('PotentialAlertService already running');
      return;
    }
    this.isRunning = true;

    // 首次扫描延迟 2 分钟，避免与启动期其他 API 调用撞车
    setTimeout(() => {
      this.safeScan();
    }, 2 * 60 * 1000);

    this.scanTimer = setInterval(() => {
      this.safeScan();
    }, CONFIG.SCAN_INTERVAL_MS);

    log.info('PotentialAlertService started', {
      enabled: PotentialAlertModel.isEnabled(),
      intervalMin: CONFIG.SCAN_INTERVAL_MS / 60000
    });
  }

  async stop(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.isRunning = false;
    log.info('PotentialAlertService stopped');
  }

  /**
   * 手动触发一次扫描（/potential 命令用）
   * 不受 enabled 开关限制
   * @returns 本次扫描检测到的候选数量
   */
  async manualScan(): Promise<PotentialAlertRecord[]> {
    return this.doScan(true);
  }

  /**
   * 定时扫描入口，受开关控制
   */
  private async safeScan(): Promise<void> {
    if (!PotentialAlertModel.isEnabled()) {
      log.debug('PotentialAlertService: scan skipped (disabled)');
      return;
    }
    if (this.isScanning) {
      log.warn('PotentialAlertService: previous scan still running, skip');
      return;
    }
    this.isScanning = true;
    try {
      await this.doScan(false);
    } catch (error) {
      log.error('PotentialAlertService: scan failed', error);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 核心扫描逻辑
   * @param isManual 手动触发时即使没触发也返回所有候选，不受 cooldown 限制
   */
  private async doScan(isManual: boolean): Promise<PotentialAlertRecord[]> {
    const scanStart = Date.now();
    const triggered: PotentialAlertRecord[] = [];

    // Step 1: 获取候选列表（预筛）
    const candidates = await this.selectCandidates();
    if (candidates.length === 0) {
      log.info('PotentialAlertService: no candidates after prefiltering');
      return [];
    }

    log.info(`PotentialAlertService: scanning ${candidates.length} candidates`);

    // Step 2: 批量获取 funding 数据（一次调用获取全部）
    const allFunding = await binanceClient.getAllFundingRates().catch((err: any) => {
      log.error('Failed to fetch all funding rates', err);
      return [];
    });
    const fundingMap = new Map(allFunding.map((f: any) => [f.symbol, f]));

    // Step 3: 逐个检查（控制并发）
    const concurrency = 5;
    for (let i = 0; i < candidates.length; i += concurrency) {
      const batch = candidates.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(c => this.checkSymbol(c, fundingMap))
      );

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) {
          triggered.push(r.value);
        }
      }

      // 批次间短暂停顿
      if (i + concurrency < candidates.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const scanTime = Date.now() - scanStart;
    log.info(`PotentialAlertService: scan completed`, {
      candidates: candidates.length,
      triggered: triggered.length,
      timeMs: scanTime
    });

    // Step 4: 推送（手动扫描不去重，直接返回候选给命令处理器显示）
    if (!isManual) {
      for (const t of triggered) {
        await this.notifyIfNeeded(t);
      }
    }

    return triggered;
  }

  /**
   * 预筛候选币种：
   * - 合约 USDT 永续
   * - 24h 成交额 >= 30M (用 quoteVolume, 精确)
   * - 24h 涨幅 > 0
   * - 非系统黑/黄名单、已下架
   * - 非用户黑/黄名单
   *
   * 数据源：REST 24h stats（1 次调用获取全部，精确可靠）
   */
  private async selectCandidates(): Promise<Array<{ symbol: string; volume24h: number }>> {
    const stats = await binanceClient.getFutures24hrStatsMultiple();
    const validSymbols = filterTradingPairs(stats.map((s: any) => s.symbol));
    const userId = this.telegramBot?.getAuthorizedUserId() || undefined;

    const candidates: Array<{ symbol: string; volume24h: number }> = [];

    for (const s of stats) {
      if (!validSymbols.includes(s.symbol)) continue;
      if (isRiskyToken(s.symbol)) continue;

      const quoteVolume = parseFloat(s.quoteVolume);
      if (!Number.isFinite(quoteVolume) || quoteVolume < getVolumeThreshold()) continue;
      if (parseFloat(s.priceChangePercent) <= 0) continue;

      // 用户自定义过滤
      if (this.filterManager && userId) {
        try {
          const cleanSymbol = s.symbol.replace('USDT', '');
          const filterResult = await this.filterManager.checkFilter(userId, cleanSymbol);
          if (!filterResult.allowed) continue;
        } catch (err) {
          log.warn('Filter check failed, including symbol', { symbol: s.symbol, err });
        }
      }

      candidates.push({ symbol: s.symbol, volume24h: quoteVolume });
    }

    return candidates;
  }

  /**
   * 检查单个币种是否触发信号
   */
  private async checkSymbol(
    candidate: { symbol: string; volume24h: number },
    fundingMap: Map<string, any>
  ): Promise<PotentialAlertRecord | null> {
    const { symbol, volume24h } = candidate;

    try {
      // 并行获取 OI 历史和 funding 历史
      const [oiHistory, fundingHistory] = await Promise.all([
        binanceClient.getOpenInterestStats(symbol, CONFIG.OI_HISTORY_PERIOD, CONFIG.OI_HISTORY_LIMIT)
          .catch(() => [] as any[]),
        binanceClient.getFundingRateHistory(symbol, CONFIG.FUNDING_HISTORY_LIMIT).catch(() => [] as any[])
      ]);

      if (!oiHistory || oiHistory.length < 2) {
        log.debug(`${symbol}: insufficient OI history`);
        return null;
      }

      // --- OI 24h 变化 ---
      // oiHistory 按时间正序（1h × 24 条），head 为 24h 前，tail 为当前
      const oiNow = parseFloat(oiHistory[oiHistory.length - 1].sumOpenInterest);
      const oiWindowAgo = parseFloat(oiHistory[0].sumOpenInterest);
      if (!oiNow || !oiWindowAgo) return null;
      const oiChangePercent = ((oiNow - oiWindowAgo) / oiWindowAgo) * 100;
      if (oiChangePercent < CONFIG.OI_CHANGE_THRESHOLD_PERCENT) {
        log.debug(`${symbol}: OI change ${oiChangePercent.toFixed(2)}% < threshold ${CONFIG.OI_CHANGE_THRESHOLD_PERCENT}%`);
        return null;
      }

      // --- 价格 24h 变化 ---
      const klines = await binanceClient.getFuturesKlines({
        symbol,
        interval: CONFIG.PRICE_KLINE_INTERVAL,
        limit: CONFIG.PRICE_KLINE_LIMIT
      }).catch(() => [] as any[]);

      if (!klines || klines.length < 2) {
        log.debug(`${symbol}: insufficient kline history`);
        return null;
      }

      const priceNow = parseFloat(klines[klines.length - 1].close);
      const priceWindowAgo = parseFloat(klines[0].open); // 用 24h 前那根 1h 的开盘价作为基线
      if (!priceNow || !priceWindowAgo) return null;
      const priceChangePercent = ((priceNow - priceWindowAgo) / priceWindowAgo) * 100;
      if (priceChangePercent < CONFIG.PRICE_CHANGE_THRESHOLD_PERCENT) {
        log.debug(`${symbol}: price change ${priceChangePercent.toFixed(2)}% < threshold ${CONFIG.PRICE_CHANGE_THRESHOLD_PERCENT}%`);
        return null;
      }

      // --- Funding 判定 ---
      const fundingInfo = fundingMap.get(symbol);
      if (!fundingInfo) {
        log.debug(`${symbol}: no funding info`);
        return null;
      }
      const fundingRate8h = parseFloat(fundingInfo.fundingRate); // 已 8h 归一化
      const fundingIntervalHours = fundingInfo.fundingIntervalHours || 8;

      // 近 24h funding 最大值（原始值，未归一化）
      const fundingMax24h = fundingHistory.length > 0
        ? Math.max(...fundingHistory.map((f: any) => f.fundingRate))
        : 0;
      const currentFundingRaw = fundingHistory.length > 0
        ? fundingHistory[fundingHistory.length - 1].fundingRate
        : fundingRate8h / (8 / fundingIntervalHours); // 反归一化

      // 24h 前 funding（8h 归一化）—— 从历史中找 24h 前最近的那条
      const windowAgoMs = Date.now() - CONFIG.WINDOW_MS;
      let fundingRateWindowAgo8h: number | null = null;
      for (let i = fundingHistory.length - 1; i >= 0; i--) {
        if (fundingHistory[i].fundingTime <= windowAgoMs) {
          fundingRateWindowAgo8h = fundingHistory[i].fundingRate * (8 / fundingIntervalHours);
          break;
        }
      }

      // Funding 三选一条件
      const cond_negative = fundingRate8h <= 0;
      const cond_dropped = fundingRateWindowAgo8h !== null && (fundingRateWindowAgo8h - fundingRate8h) >= CONFIG.FUNDING_DROP_BP;
      const cond_softened = fundingMax24h > 0 && currentFundingRaw < fundingMax24h;

      if (!cond_negative && !cond_dropped && !cond_softened) {
        log.debug(`${symbol}: funding condition not met`, {
          fundingRate8h, fundingMax24h, currentFundingRaw, fundingRateWindowAgo8h
        });
        return null;
      }

      // --- 等级判定 ---
      let level: 1 | 2 | 3;
      if (fundingRate8h <= CONFIG.LEVEL_1_FUNDING) {
        level = 1;
      } else if (fundingRate8h <= CONFIG.LEVEL_2_FUNDING) {
        level = 2;
      } else {
        level = 3;
      }

      return {
        symbol,
        level,
        priceChange1h: priceChangePercent,
        oiChange1h: oiChangePercent,
        fundingRate8h,
        fundingIntervalHours,
        fundingMax24h,
        currentPrice: priceNow,
        volume24h,
        triggeredAt: Date.now()
      };

    } catch (error) {
      log.error(`PotentialAlertService: checkSymbol failed for ${symbol}`, error);
      return null;
    }
  }

  /**
   * 根据去重和等级变化规则决定是否推送
   */
  private async notifyIfNeeded(record: PotentialAlertRecord): Promise<void> {
    const lastAlert = PotentialAlertModel.getLastAlert(record.symbol);

    if (lastAlert) {
      const ageMs = record.triggeredAt - lastAlert.triggeredAt;
      const inCooldown = ageMs < CONFIG.COOLDOWN_MS;
      const levelImproved = record.level < lastAlert.level; // 数字越小等级越高

      if (inCooldown && !levelImproved) {
        log.debug(`${record.symbol}: in cooldown (${Math.round(ageMs / 60000)}min), skip`);
        return;
      }

      if (levelImproved) {
        log.info(`${record.symbol}: level improved ${lastAlert.level} → ${record.level}, pushing`);
      }
    }

    // 持久化
    PotentialAlertModel.recordAlert(record);

    // 推送
    await this.sendNotification(record);
  }

  /**
   * 发送 Telegram 推送
   */
  private async sendNotification(record: PotentialAlertRecord): Promise<void> {
    if (!this.telegramBot) {
      log.warn('PotentialAlertService: telegramBot not set, skip notification');
      return;
    }

    const userId = this.telegramBot.getAuthorizedUserId();
    if (!userId) return;

    const message = await this.formatMessage(record);

    try {
      await this.telegramBot.sendMessage(userId, message, { parse_mode: 'Markdown' });
      log.info(`PotentialAlertService: notification sent`, {
        symbol: record.symbol,
        level: record.level
      });
      // ESP32 语音：只念"级别 + 标的"，例如 "L2 强信号 ARKM"
      const levelName = record.level === 1 ? 'L1 极强信号' : record.level === 2 ? 'L2 强信号' : 'L3 潜力信号';
      const sym = record.symbol.replace(/USDT$/i, '');
      await esp32NotificationService.pushAlert('potential', `${levelName} ${sym}`);
    } catch (error) {
      log.error(`Failed to send potential alert for ${record.symbol}`, error);
    }
  }

  /**
   * 格式化推送消息（参考 /signals 样式）
   */
  private async formatMessage(r: PotentialAlertRecord): Promise<string> {
    const levelIcon = '⚡';
    const levelName = r.level === 1 ? 'L1 极强信号' : r.level === 2 ? 'L2 强信号' : 'L3 潜力信号';
    const displaySymbol = r.symbol.replace('USDT', '');

    const formattedPrice = await formatPriceWithSeparators(String(r.currentPrice), r.symbol);
    const fundingPct = (r.fundingRate8h * 100).toFixed(4);
    const fundingMaxPct = (r.fundingMax24h * 100).toFixed(4);

    let message = `${levelIcon} *${levelName} — ${displaySymbol}*\n\n`;
    message += `💰 *当前价格:* $${formattedPrice}\n`;
    message += `📈 *24h 涨幅:* +${r.priceChange1h.toFixed(2)}%\n`;
    message += `📊 *24h OI 增幅:* +${r.oiChange1h.toFixed(2)}%\n`;

    // Funding 信息（含松动信息）
    const fundingEmoji = r.fundingRate8h <= 0 ? '🟢' : '⚪';
    message += `💸 *Funding (8h):* ${fundingEmoji} ${fundingPct}%\n`;
    if (r.fundingMax24h > 0) {
      message += `   └ 24h 最高: ${fundingMaxPct}%`;
      if (r.fundingIntervalHours !== 8) {
        // 注意：fundingMax24h 是原始周期下的值，显示时提示
      }
      message += `\n`;
    }

    // 异常费率周期警示
    if (r.fundingIntervalHours !== 8) {
      message += `\n⚠️ *Funding 周期: ${r.fundingIntervalHours}h（非标准）*\n`;
      message += `   已偏离 8h 标准周期，说明费率异常极端!\n`;
    }

    message += `\n📊 *24h 成交额:* $${(r.volume24h / 1_000_000).toFixed(1)}M\n`;
    message += `⏰ *触发时间:* ${new Date(r.triggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n\n`;
    message += `💡 _价↑ OI↑ Funding↓/负 = 聪明钱入场，散户仍在空_`;

    return message;
  }

  /**
   * 获取运行状态
   */
  getStatus(): {
    running: boolean;
    enabled: boolean;
    scanning: boolean;
    intervalMin: number;
    todayStats: { total: number; byLevel: Record<number, number> };
  } {
    return {
      running: this.isRunning,
      enabled: PotentialAlertModel.isEnabled(),
      scanning: this.isScanning,
      intervalMin: CONFIG.SCAN_INTERVAL_MS / 60000,
      todayStats: PotentialAlertModel.getTodayStats()
    };
  }
}

export const potentialAlertService = new PotentialAlertService();
