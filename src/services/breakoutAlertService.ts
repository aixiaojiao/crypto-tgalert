import { log } from '../utils/logger';
import { binanceClient } from './binance';
import { filterTradingPairs, isRiskyToken } from '../config/tokenLists';
import { historicalHighService } from './historicalHighService';
import { HighTimeframe } from '../models/historicalHighModel';
import {
  BreakoutAlertModel,
  BreakoutAlertRecord,
  BreakoutTier,
} from '../models/breakoutAlertModel';
import { TelegramBot } from '../bot';
import { esp32NotificationService } from './esp32';
import type { FuturesTicker24hr, FuturesSymbolInfo, Kline } from '../types/binance';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const CONFIG = {
  SCAN_INTERVAL_MS: 10 * 60 * 1000,             // 每 10 分钟扫一次
  FIRST_SCAN_DELAY_MS: 3 * 60 * 1000,           // 启动后延迟 3 分钟首次扫描
  SYMBOL_API_DELAY_MS: 200,                     // 相邻 klines 调用间隔
  VOLUME_MULT_THRESHOLD: 1.5,                   // 最新 1h 量 / 前 20h 均量 >= 1.5
  VOLUME_LOOKBACK_HOURS: 20,                    // 放量比对的基准窗口
  MIN_VOLUME_USDT_24H: 1_000_000,               // 跟 historicalHighService 保持一致
  ONBOARD_CACHE_TTL_MS: DAY_MS,                 // onboardDate 缓存 24h
};

// ATH 优先级最高；顺序决定了一个 symbol 的最高突破档
const TIMEFRAME_PRIORITY: HighTimeframe[] = ['ATH', '52w', '180d', '30d', '7d'];

// 最小年龄（用于 notTooYoung 确认）
const MIN_AGE_DAYS: Record<HighTimeframe, number> = {
  '7d': 7,
  '30d': 30,
  '180d': 180,
  '52w': 364,
  'ATH': 0, // 任何上线都算
};

function tierOf(tf: HighTimeframe): BreakoutTier {
  switch (tf) {
    case '7d': return 'L3_weak';
    case '30d': return 'L2_mid';
    case '180d': return 'L1_strong';
    case '52w':
    case 'ATH': return 'L1_extreme';
  }
}

const TIER_LABEL: Record<BreakoutTier, string> = {
  L3_weak: 'L3 · 7d 新高',
  L2_mid: 'L2 · 30d 新高',
  L1_strong: 'L1 · 180d 新高',
  L1_extreme: 'L1 · 52w / ATH',
};

const TIER_ICON: Record<BreakoutTier, string> = {
  L3_weak: '📈',
  L2_mid: '⚡',
  L1_strong: '🔥',
  L1_extreme: '🚀',
};

interface Candidate {
  symbol: string;
  topTimeframe: HighTimeframe;
  refHigh: number;
  refHighAt: number;
  currentPrice: number;
}

interface ConfirmResult {
  passed: boolean;
  reason?: string;
  volumeRatio: number;
}

/**
 * 突破报警服务 v1 (P2)
 *
 * 职责：
 *   - 每 10 分钟扫一次全市场活跃 symbol
 *   - 对每 symbol 按档位优先级（ATH > 52w > 180d > 30d > 7d）找最高突破档
 *   - 二次确认：放量 + 持续 + 不刚上市
 *   - 档位独立 6h 冷却；同 symbol 升档立即推
 */
export class BreakoutAlertService {
  private telegramBot: TelegramBot | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private isRunning = false;

  // onboardDate 缓存（symbol → ms），每次 scan 按需刷新
  private onboardDateCache: Map<string, number> = new Map();
  private onboardCacheRefreshedAt = 0;

  setTelegramBot(bot: TelegramBot): void {
    this.telegramBot = bot;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      log.warn('BreakoutAlertService already running');
      return;
    }
    this.isRunning = true;

    setTimeout(() => { this.safeScan(); }, CONFIG.FIRST_SCAN_DELAY_MS);

    this.scanTimer = setInterval(() => { this.safeScan(); }, CONFIG.SCAN_INTERVAL_MS);

    log.info('BreakoutAlertService started', {
      enabled: BreakoutAlertModel.isEnabled(),
      intervalMin: CONFIG.SCAN_INTERVAL_MS / 60000,
    });
  }

  async stop(): Promise<void> {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    this.isRunning = false;
    log.info('BreakoutAlertService stopped');
  }

  getStatus(): {
    running: boolean;
    enabled: boolean;
    scanning: boolean;
    intervalMin: number;
    todayStats: { total: number; byTier: Record<string, number> };
  } {
    return {
      running: this.isRunning,
      enabled: BreakoutAlertModel.isEnabled(),
      scanning: this.isScanning,
      intervalMin: CONFIG.SCAN_INTERVAL_MS / 60000,
      todayStats: BreakoutAlertModel.getTodayStats(),
    };
  }

  private async safeScan(): Promise<void> {
    if (!BreakoutAlertModel.isEnabled()) {
      log.debug('BreakoutAlertService: scan skipped (disabled)');
      return;
    }
    if (this.isScanning) {
      log.warn('BreakoutAlertService: previous scan still running, skip');
      return;
    }
    this.isScanning = true;
    try {
      await this.doScan();
    } catch (err) {
      log.error('BreakoutAlertService: scan failed', err);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * 对外暴露的手动扫描入口（给未来 /breakout_manual 命令使用）
   */
  async manualScan(): Promise<{ triggered: number; candidates: number }> {
    return this.doScan();
  }

  private async doScan(): Promise<{ triggered: number; candidates: number }> {
    const scanStart = Date.now();

    // Step 1: 拉 24h ticker 得到 lastPrice map（+ 做基础流动性过滤）
    let tickers: FuturesTicker24hr[] = [];
    try {
      tickers = await binanceClient.getFutures24hrStatsMultiple();
    } catch (err) {
      log.error('BreakoutAlertService: getFutures24hrStatsMultiple failed', err);
      return { triggered: 0, candidates: 0 };
    }

    const priceMap = new Map<string, number>();
    const volumeMap = new Map<string, number>();
    for (const t of tickers) {
      priceMap.set(t.symbol, parseFloat(t.lastPrice));
      volumeMap.set(t.symbol, parseFloat(t.quoteVolume));
    }

    // Step 2: 扫缓存的 symbols 找候选
    const cachedSymbols = new Set(
      filterTradingPairs(
        Array.from(priceMap.keys()).filter(s => !isRiskyToken(s)),
      ),
    );
    // 进一步只保留历史高点缓存里有数据的
    const candidates: Candidate[] = [];
    for (const symbol of cachedSymbols) {
      const currentPrice = priceMap.get(symbol);
      if (!currentPrice || currentPrice <= 0) continue;
      const vol = volumeMap.get(symbol) ?? 0;
      if (vol < CONFIG.MIN_VOLUME_USDT_24H) continue;

      const allHighs = historicalHighService.queryAllHighs(symbol);

      // 找最高优先级的破点
      let top: Candidate | null = null;
      for (const tf of TIMEFRAME_PRIORITY) {
        const rec = allHighs[tf];
        if (!rec) continue;
        if (currentPrice > rec.highPrice) {
          top = {
            symbol,
            topTimeframe: tf,
            refHigh: rec.highPrice,
            refHighAt: rec.highAt,
            currentPrice,
          };
          break;
        }
      }
      if (top) candidates.push(top);
    }

    log.info(`BreakoutAlertService: scan candidates ${candidates.length}`);

    if (candidates.length === 0) {
      return { triggered: 0, candidates: 0 };
    }

    // 更新 onboardDate 缓存（如需要）
    await this.ensureOnboardDates();

    // Step 3: 逐个做二次确认 + 冷却判断 + 推送
    let triggered = 0;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const tier = tierOf(c.topTimeframe);

      // 冷却：同 symbol + 同 tier 6h 内只报一次
      if (BreakoutAlertModel.hasAlertedRecently(c.symbol, tier)) continue;

      // 年龄：避免刚上币的 "从上线起就是 ATH"
      if (!this.notTooYoung(c.symbol, c.topTimeframe)) continue;

      // 拉 klines 做放量 + 持续确认
      let klines: Kline[];
      try {
        klines = await binanceClient.getFuturesKlines({
          symbol: c.symbol,
          interval: '1h',
          limit: CONFIG.VOLUME_LOOKBACK_HOURS + 1,
          endTime: Date.now(),
        });
      } catch (err) {
        log.debug(`BreakoutAlertService: klines fetch failed for ${c.symbol}`, {
          err: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      const confirm = this.confirmBreakout(klines, c.refHigh);
      if (!confirm.passed) {
        log.debug(`BreakoutAlertService: ${c.symbol} ${c.topTimeframe} rejected: ${confirm.reason}`);
        if (i < candidates.length - 1) await sleep(CONFIG.SYMBOL_API_DELAY_MS);
        continue;
      }

      const breakPct = ((c.currentPrice - c.refHigh) / c.refHigh) * 100;
      const record: BreakoutAlertRecord = {
        symbol: c.symbol,
        tier,
        timeframe: c.topTimeframe,
        refHigh: c.refHigh,
        currentPrice: c.currentPrice,
        breakPct,
        volumeRatio: confirm.volumeRatio,
        triggeredAt: Date.now(),
      };
      BreakoutAlertModel.recordAlert(record);
      await this.sendNotification(record, c.refHighAt);
      triggered++;

      if (i < candidates.length - 1) await sleep(CONFIG.SYMBOL_API_DELAY_MS);
    }

    log.info('BreakoutAlertService: scan done', {
      candidates: candidates.length,
      triggered,
      durationMs: Date.now() - scanStart,
    });

    return { triggered, candidates: candidates.length };
  }

  // ─────────── 二次确认 ───────────

  /**
   * 放量 + 持续 两项确认（纯函数，便于测试）
   *
   * 放量：最新 1h 的 quoteAssetVolume >= 前 N 小时平均 × 1.5
   * 持续：最新 1h 的 low > refHigh（本小时还没跌回去）
   */
  confirmBreakout(klines: Kline[], refHigh: number): ConfirmResult {
    if (klines.length < 2) return { passed: false, reason: 'insufficient klines', volumeRatio: 0 };

    const latest = klines[klines.length - 1];
    const history = klines.slice(0, -1); // 前 N 根做基准

    // 放量
    const latestVol = parseFloat(latest.quoteAssetVolume);
    if (!(latestVol > 0)) return { passed: false, reason: 'latest vol = 0', volumeRatio: 0 };
    const avg = history.reduce((s, k) => s + parseFloat(k.quoteAssetVolume), 0) / history.length;
    if (!(avg > 0)) return { passed: false, reason: 'avg vol = 0', volumeRatio: 0 };
    const ratio = latestVol / avg;
    if (ratio < CONFIG.VOLUME_MULT_THRESHOLD) {
      return { passed: false, reason: `volume ratio ${ratio.toFixed(2)} < ${CONFIG.VOLUME_MULT_THRESHOLD}`, volumeRatio: ratio };
    }

    // 持续
    const latestLow = parseFloat(latest.low);
    if (latestLow <= refHigh) {
      return { passed: false, reason: `latest low ${latestLow} <= refHigh ${refHigh}`, volumeRatio: ratio };
    }

    return { passed: true, volumeRatio: ratio };
  }

  // ─────────── 年龄确认 ───────────

  private notTooYoung(symbol: string, tf: HighTimeframe): boolean {
    const onboardDate = this.onboardDateCache.get(symbol);
    if (!onboardDate) return true; // 缓存缺失就放行（避免漏推）
    const ageMs = Date.now() - onboardDate;
    const minAgeMs = MIN_AGE_DAYS[tf] * DAY_MS;
    return ageMs >= minAgeMs;
  }

  private async ensureOnboardDates(): Promise<void> {
    const now = Date.now();
    if (now - this.onboardCacheRefreshedAt < CONFIG.ONBOARD_CACHE_TTL_MS && this.onboardDateCache.size > 0) {
      return;
    }
    try {
      const info = await binanceClient.getFuturesExchangeInfo();
      for (const s of info.symbols as FuturesSymbolInfo[]) {
        this.onboardDateCache.set(s.symbol, s.onboardDate);
      }
      this.onboardCacheRefreshedAt = now;
    } catch (err) {
      log.warn('BreakoutAlertService: exchangeInfo refresh failed', err);
    }
  }

  // ─────────── 推送 ───────────

  private async sendNotification(record: BreakoutAlertRecord, refHighAt: number): Promise<void> {
    if (!this.telegramBot) {
      log.warn('BreakoutAlertService: telegramBot not set, skip notification');
      return;
    }
    const userId = this.telegramBot.getAuthorizedUserId();
    if (!userId) return;

    const message = this.formatMessage(record, refHighAt);

    try {
      await this.telegramBot.sendMessage(userId, message, { parse_mode: 'Markdown' });
      log.info('BreakoutAlertService: notification sent', {
        symbol: record.symbol,
        tier: record.tier,
        tf: record.timeframe,
      });

      // ESP32 语音：复用已有的 'breakthrough' 类型
      const sym = record.symbol.replace(/USDT$/i, '');
      const voiceText = `突破 ${record.timeframe} ${sym}`;
      await esp32NotificationService.pushAlert('breakthrough', voiceText);
    } catch (err) {
      log.error(`BreakoutAlertService: failed to send notification for ${record.symbol}`, err);
    }
  }

  private formatMessage(r: BreakoutAlertRecord, refHighAt: number): string {
    const display = r.symbol.replace(/USDT$/i, '');
    const tierLabel = TIER_LABEL[r.tier];
    const icon = TIER_ICON[r.tier];
    const highDate = new Date(refHighAt).toISOString().slice(0, 10);

    let msg = `${icon} *突破 ${tierLabel} — ${display}*\n\n`;
    msg += `💰 当前: \`${formatPrice(r.currentPrice)}\`\n`;
    msg += `🎯 ${r.timeframe} 高点: \`${formatPrice(r.refHigh)}\` (${highDate})\n`;
    msg += `📈 突破幅度: *+${r.breakPct.toFixed(2)}%*\n`;
    msg += `🔊 放量: 1h 量 × ${r.volumeRatio.toFixed(2)} (> ${CONFIG.VOLUME_MULT_THRESHOLD})\n`;
    msg += `🕒 持续: 未跌破参考高点 ✓\n\n`;
    msg += `⏰ ${new Date(r.triggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n`;
    msg += `💡 _同档位 6h 内不再推送；升档（如 30d → 180d）会立即再推_`;
    return msg;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPrice(p: number): string {
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toFixed(6);
}

export const breakoutAlertService = new BreakoutAlertService();
