import { log } from '../utils/logger';
import { binanceClient } from './binance';
import { filterTradingPairs, isRiskyToken } from '../config/tokenLists';
import {
  HistoricalHighModel,
  HistoricalHighRecord,
  HighTimeframe,
  ALL_TIMEFRAMES,
} from '../models/historicalHighModel';
import type { Kline, FuturesSymbolInfo, FuturesTicker24hr } from '../types/binance';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// 死币过滤阈值（可调）
const MIN_VOLUME_USDT_24H = 1_000_000;          // 24h 成交额 < 1M USDT 视为死币
const HIGH_VOLUME_USDT_24H = 50_000_000;        // 成交额 >= 50M USDT 的币跳过振幅检查（主流币波动小也算活跃）
const MIN_24H_AMPLITUDE_PCT = 3;                // 24h 振幅 < 3% 且成交额 < 50M 视为死币

// 刷新节奏
const COLD_REFRESH_INTERVAL_MS = 24 * HOUR_MS;  // 冷层：每 24h 全量重算
const WARM_REFRESH_INTERVAL_MS = HOUR_MS;       // 温层：每 1h 检查新高
const SYMBOL_REQUEST_DELAY_MS = 200;            // 相邻 API 调用间隔，避免 rate limit

const BINANCE_MAX_KLINES_PER_REQ = 1500;

export interface HighsForSymbol {
  '7d': HistoricalHighRecord | null;
  '30d': HistoricalHighRecord | null;
  '180d': HistoricalHighRecord | null;
  '52w': HistoricalHighRecord | null;
  'ATH': HistoricalHighRecord | null;
}

export interface RankingRow {
  symbol: string;
  currentPrice: number;
  highPrice: number;
  highAt: number;
  distancePercent: number;       // 负值表示当前价已超过缓存高点
  neededGainPercent: number;     // 当前价涨多少 % 能到高点；已超过则为 0
}

/**
 * 历史高点缓存 v3
 *
 * 职责：
 *   - 冷层：每 24h 拉 1d/1h K 线全量重算 5 档高点 + 死币过滤
 *   - 温层：每 1h 检查最新 1h K 线是否破高，破则更新
 *   - 查询：同步从 DB 读缓存高点；实时距离用即时价计算
 *
 * ATH 仅使用合约数据（onboardDate 之后），不引入 spot
 */
export class HistoricalHighService {
  private coldTimer: NodeJS.Timeout | null = null;
  private warmTimer: NodeJS.Timeout | null = null;
  private coldInProgress = false;
  private warmInProgress = false;

  /** 合约上线日期缓存（symbol → onboardDate ms），避免频繁调 exchangeInfo */
  private onboardDateCache: Map<string, number> = new Map();

  /**
   * 服务启动：
   *   - 模型初始化 (同步)
   *   - 如果缓存为空或陈旧 (>24h)，启动一次冷刷新 (异步, 不阻塞)
   *   - 装定时器 (24h / 1h)
   *
   * 不会阻塞调用方启动流程
   */
  async start(): Promise<void> {
    if (!HistoricalHighModel.isDatabaseInitialized()) {
      HistoricalHighModel.initDatabase();
    }

    const stats = HistoricalHighModel.getStats();
    const now = Date.now();
    const isEmpty = stats.rows === 0;
    const isStale =
      stats.newestCollectedAt !== null && now - stats.newestCollectedAt > COLD_REFRESH_INTERVAL_MS;

    if (isEmpty || isStale) {
      log.info('HistoricalHighService: scheduling immediate cold refresh', {
        reason: isEmpty ? 'empty cache' : 'stale cache',
      });
      // 不 await —— 让服务启动继续，冷刷新在后台跑
      this.runColdRefresh().catch(err => {
        log.error('HistoricalHighService: initial cold refresh failed', err);
      });
    }

    this.coldTimer = setInterval(() => {
      this.runColdRefresh().catch(err => {
        log.error('HistoricalHighService: scheduled cold refresh failed', err);
      });
    }, COLD_REFRESH_INTERVAL_MS);

    this.warmTimer = setInterval(() => {
      this.runWarmRefresh().catch(err => {
        log.error('HistoricalHighService: scheduled warm refresh failed', err);
      });
    }, WARM_REFRESH_INTERVAL_MS);

    log.info('HistoricalHighService started', {
      cachedRows: stats.rows,
      cachedSymbols: stats.symbols,
      newestCollectedAt: stats.newestCollectedAt
        ? new Date(stats.newestCollectedAt).toISOString()
        : null,
    });
  }

  async stop(): Promise<void> {
    if (this.coldTimer) {
      clearInterval(this.coldTimer);
      this.coldTimer = null;
    }
    if (this.warmTimer) {
      clearInterval(this.warmTimer);
      this.warmTimer = null;
    }
    log.info('HistoricalHighService stopped');
  }

  // ─────────── 查询 API ───────────

  queryHigh(symbol: string, timeframe: HighTimeframe): HistoricalHighRecord | null {
    return HistoricalHighModel.getHigh(symbol.toUpperCase(), timeframe);
  }

  queryAllHighs(symbol: string): HighsForSymbol {
    return HistoricalHighModel.getAllHighsForSymbol(symbol.toUpperCase()) as HighsForSymbol;
  }

  /**
   * 按距高点接近程度排名
   * 实时价来自 binanceClient（非缓存），保证精准
   */
  async getRankingByProximityToHigh(
    timeframe: HighTimeframe,
    limit: number = 20,
  ): Promise<RankingRow[]> {
    const records = HistoricalHighModel.getAllForTimeframe(timeframe);
    if (records.length === 0) return [];

    // 一次性批量拉 24hr 行情（包含 lastPrice），比逐个 symbol 查快
    let tickers: FuturesTicker24hr[] = [];
    try {
      tickers = await binanceClient.getFutures24hrStatsMultiple(records.map(r => r.symbol));
    } catch (err) {
      log.warn('HistoricalHighService: ranking getFutures24hrStatsMultiple failed', err);
    }
    const priceMap = new Map<string, number>();
    for (const t of tickers) {
      priceMap.set(t.symbol, parseFloat(t.lastPrice));
    }

    const rows: RankingRow[] = [];
    for (const r of records) {
      const currentPrice = priceMap.get(r.symbol);
      if (currentPrice === undefined || currentPrice <= 0) continue;
      const distancePercent =
        currentPrice >= r.highPrice
          ? -((currentPrice - r.highPrice) / r.highPrice) * 100
          : ((r.highPrice - currentPrice) / currentPrice) * 100;
      const neededGainPercent =
        currentPrice >= r.highPrice ? 0 : ((r.highPrice - currentPrice) / currentPrice) * 100;
      rows.push({
        symbol: r.symbol,
        currentPrice,
        highPrice: r.highPrice,
        highAt: r.highAt,
        distancePercent,
        neededGainPercent,
      });
    }

    rows.sort((a, b) => a.neededGainPercent - b.neededGainPercent);
    return rows.slice(0, limit);
  }

  getCacheStatus(): {
    cachedSymbols: number;
    cachedRows: number;
    oldestCollectedAt: number | null;
    newestCollectedAt: number | null;
    coldInProgress: boolean;
    warmInProgress: boolean;
  } {
    const s = HistoricalHighModel.getStats();
    return {
      cachedSymbols: s.symbols,
      cachedRows: s.rows,
      oldestCollectedAt: s.oldestCollectedAt,
      newestCollectedAt: s.newestCollectedAt,
      coldInProgress: this.coldInProgress,
      warmInProgress: this.warmInProgress,
    };
  }

  // ─────────── 冷刷新：全量重算 ───────────

  async runColdRefresh(): Promise<{ refreshed: number; skipped: number; pruned: number }> {
    if (this.coldInProgress) {
      log.warn('HistoricalHighService: cold refresh already running, skip');
      return { refreshed: 0, skipped: 0, pruned: 0 };
    }
    this.coldInProgress = true;
    const start = Date.now();
    log.info('HistoricalHighService: cold refresh starting');

    try {
      const activeSymbols = await this.buildActiveSymbolList();
      if (activeSymbols.length === 0) {
        log.warn('HistoricalHighService: no active symbols, abort cold refresh');
        return { refreshed: 0, skipped: 0, pruned: 0 };
      }

      // 删除已成死币的 cached symbol
      const cached = new Set(HistoricalHighModel.getCachedSymbols());
      const active = new Set(activeSymbols);
      let pruned = 0;
      for (const sym of cached) {
        if (!active.has(sym)) {
          pruned += HistoricalHighModel.deleteSymbol(sym);
        }
      }
      if (pruned > 0) {
        log.info(`HistoricalHighService: pruned ${pruned} dead-coin rows`);
      }

      let refreshed = 0;
      let skipped = 0;
      for (let i = 0; i < activeSymbols.length; i++) {
        const symbol = activeSymbols[i];
        try {
          await this.refreshSymbolCold(symbol);
          refreshed++;
          if ((i + 1) % 50 === 0) {
            log.info(
              `HistoricalHighService: cold refresh progress ${i + 1}/${activeSymbols.length}`,
            );
          }
        } catch (err) {
          skipped++;
          log.warn(`HistoricalHighService: cold refresh ${symbol} failed`, {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        // 避免 Binance rate limit
        if (i < activeSymbols.length - 1) {
          await sleep(SYMBOL_REQUEST_DELAY_MS);
        }
      }

      const durationMs = Date.now() - start;
      log.info('HistoricalHighService: cold refresh done', {
        total: activeSymbols.length,
        refreshed,
        skipped,
        pruned,
        durationMs,
      });
      return { refreshed, skipped, pruned };
    } finally {
      this.coldInProgress = false;
    }
  }

  /**
   * 单 symbol 冷刷新：一次性拉 1h (7d) + 1d (ATH) 的 K 线，一并算出 5 档高点
   */
  private async refreshSymbolCold(symbol: string): Promise<void> {
    const now = Date.now();

    // 7d — 1h K 线，168 根
    const klines1h = await binanceClient.getFuturesKlines({
      symbol,
      interval: '1h',
      limit: 168,
      endTime: now,
    });
    if (klines1h.length === 0) throw new Error('no 1h klines');
    const high7d = this.computeHigh(klines1h);
    HistoricalHighModel.upsertHigh({
      symbol,
      timeframe: '7d',
      highPrice: high7d.price,
      highAt: high7d.at,
      windowStart: klines1h[0].openTime,
      windowEnd: klines1h[klines1h.length - 1].closeTime,
      collectedAt: now,
    });

    // 30d / 180d / 52w / ATH — 1d K 线，需要覆盖到上线日
    const onboardDate = this.onboardDateCache.get(symbol);
    const daysSinceOnboard = onboardDate ? Math.floor((now - onboardDate) / DAY_MS) + 1 : 1500;
    const klines1d = await this.fetchAll1dKlines(symbol, Math.min(daysSinceOnboard, 5000), now);
    if (klines1d.length === 0) throw new Error('no 1d klines');

    // 从末尾切出各窗口
    const winByTf: Record<Exclude<HighTimeframe, '7d'>, Kline[]> = {
      '30d': klines1d.slice(-30),
      '180d': klines1d.slice(-180),
      '52w': klines1d.slice(-364),
      'ATH': klines1d,
    };

    for (const tf of ['30d', '180d', '52w', 'ATH'] as const) {
      const window = winByTf[tf];
      if (window.length === 0) continue;
      const peak = this.computeHigh(window);
      HistoricalHighModel.upsertHigh({
        symbol,
        timeframe: tf,
        highPrice: peak.price,
        highAt: peak.at,
        windowStart: window[0].openTime,
        windowEnd: window[window.length - 1].closeTime,
        collectedAt: now,
      });
    }
  }

  /** 翻页拉 1d K 线以覆盖 ATH，Binance 单次最多 1500 根 */
  private async fetchAll1dKlines(symbol: string, daysNeeded: number, endTime: number): Promise<Kline[]> {
    const all: Kline[] = [];
    let curEnd = endTime;
    let remaining = Math.min(daysNeeded, 5000);
    while (remaining > 0) {
      const limit = Math.min(remaining, BINANCE_MAX_KLINES_PER_REQ);
      const batch = await binanceClient.getFuturesKlines({
        symbol,
        interval: '1d',
        limit,
        endTime: curEnd,
      });
      if (batch.length === 0) break;
      all.unshift(...batch);
      remaining -= batch.length;
      if (batch.length < limit) break; // 已到开端
      curEnd = batch[0].openTime - 1;
      await sleep(SYMBOL_REQUEST_DELAY_MS);
    }
    return all;
  }

  // ─────────── 温刷新：仅比对最新 1h K 线是否破高 ───────────

  async runWarmRefresh(): Promise<{ updated: number; skipped: number }> {
    if (this.warmInProgress) {
      log.debug('HistoricalHighService: warm refresh already running, skip');
      return { updated: 0, skipped: 0 };
    }
    if (this.coldInProgress) {
      log.debug('HistoricalHighService: cold in progress, skip warm');
      return { updated: 0, skipped: 0 };
    }
    this.warmInProgress = true;
    const start = Date.now();

    try {
      const symbols = HistoricalHighModel.getCachedSymbols();
      if (symbols.length === 0) return { updated: 0, skipped: 0 };

      let updated = 0;
      let skipped = 0;
      const now = Date.now();

      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        try {
          const klines = await binanceClient.getFuturesKlines({
            symbol,
            interval: '1h',
            limit: 1,
            endTime: now,
          });
          if (klines.length === 0) continue;
          const latest = klines[0];
          const latestHigh = parseFloat(latest.high);

          const currentHighs = HistoricalHighModel.getAllHighsForSymbol(symbol);
          for (const tf of ALL_TIMEFRAMES) {
            const existing = currentHighs[tf];
            if (!existing) continue;
            if (latestHigh > existing.highPrice) {
              HistoricalHighModel.upsertHigh({
                symbol,
                timeframe: tf,
                highPrice: latestHigh,
                highAt: latest.openTime,
                windowStart: existing.windowStart,
                windowEnd: latest.closeTime,
                collectedAt: now,
              });
              updated++;
              log.info('HistoricalHighService: new high detected', {
                symbol,
                tf,
                old: existing.highPrice,
                new: latestHigh,
              });
            }
          }
        } catch (err) {
          skipped++;
          log.debug(`HistoricalHighService: warm refresh ${symbol} skipped`, {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        if (i < symbols.length - 1) {
          await sleep(SYMBOL_REQUEST_DELAY_MS);
        }
      }

      log.info('HistoricalHighService: warm refresh done', {
        symbols: symbols.length,
        updated,
        skipped,
        durationMs: Date.now() - start,
      });
      return { updated, skipped };
    } finally {
      this.warmInProgress = false;
    }
  }

  // ─────────── 死币过滤 ───────────

  private async buildActiveSymbolList(): Promise<string[]> {
    const [exchangeInfo, tickers] = await Promise.all([
      binanceClient.getFuturesExchangeInfo(),
      binanceClient.getFutures24hrStatsMultiple().catch(err => {
        log.warn('HistoricalHighService: 24hr stats failed', err);
        return [] as FuturesTicker24hr[];
      }),
    ]);

    // onboardDate 入缓存，冷刷新复用
    for (const s of exchangeInfo.symbols) {
      this.onboardDateCache.set(s.symbol, s.onboardDate);
    }

    // 用 24hr ticker 的 high/low 算 24h 振幅（7d 还没 K 线，启动期就算不到）
    const volumeMap = new Map<string, number>();
    const amplitude24hMap = new Map<string, number>();
    for (const t of tickers) {
      volumeMap.set(t.symbol, parseFloat(t.quoteVolume));
      const high = parseFloat(t.highPrice);
      const low = parseFloat(t.lowPrice);
      const amp = low > 0 ? ((high - low) / low) * 100 : 0;
      amplitude24hMap.set(t.symbol, amp);
    }

    // 由 FuturesSymbolInfo 收集 TRADING + 永续 symbol，再走 tokenLists 过滤（去 USDC/季度/下架）
    const tradingPerps = exchangeInfo.symbols
      .filter((s: FuturesSymbolInfo) => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
      .map(s => s.symbol);

    const base = filterTradingPairs(tradingPerps);

    const active: string[] = [];
    for (const symbol of base) {
      if (isRiskyToken(symbol)) continue;
      const vol = volumeMap.get(symbol) ?? 0;
      // 成交额太低直接剔除
      if (vol < MIN_VOLUME_USDT_24H) continue;
      // 高成交额（主流币/活跃币）跳过振幅检查；中低成交额要求 24h 振幅 >= 3%
      if (vol < HIGH_VOLUME_USDT_24H) {
        const amp = amplitude24hMap.get(symbol) ?? 0;
        // tickers 缺失则 amp=0, 按 0 处理（< 3%）-> 剔除 (保守);
        // 但若连 tickers 都没有，也说明这币不活跃
        if (amp < MIN_24H_AMPLITUDE_PCT) continue;
      }
      active.push(symbol);
    }

    log.info('HistoricalHighService: active symbol list built', {
      tradingPerps: tradingPerps.length,
      afterBase: base.length,
      afterFilters: active.length,
    });

    return active;
  }

  /** 从 K 线序列里找最高价及对应 K 线时间 */
  private computeHigh(klines: Kline[]): { price: number; at: number } {
    let price = 0;
    let at = 0;
    for (const k of klines) {
      const h = parseFloat(k.high);
      if (h > price) {
        price = h;
        at = k.openTime;
      }
    }
    return { price, at };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const historicalHighService = new HistoricalHighService();
