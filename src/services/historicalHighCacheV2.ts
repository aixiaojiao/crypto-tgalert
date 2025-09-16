import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { join } from 'path';
import { binanceClient } from './binance';
import { log } from '../utils/logger';
import { filterHistoricalDataPairs } from '../config/tokenLists';

export interface CachedHistoricalHigh {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  highPrice: number;
  highTimestamp: number;
  distancePercent: number;
  neededGainPercent: number;
  lastUpdated: number;
}

export interface RankingData {
  symbol: string;
  currentPrice: number;
  highPrice: number;
  highTimestamp: number;
  distancePercent: number;
  neededGainPercent: number;
}

interface KlineData {
  openTime: number;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  closeTime: number;
}

interface TimeframeConfig {
  interval: string;
  windowMs: number;
  displayName: string;
}

/**
 * 历史新高缓存服务 V2 - 一次性收集模式
 */
class HistoricalHighCacheV2 extends EventEmitter {
  private cache: Map<string, CachedHistoricalHigh> = new Map();
  private isInitialized = false;
  private readonly cacheFilePath = join(process.cwd(), 'data', 'historical-high-cache.json');

  // 目标时间框架配置 (只收集需要的)
  private readonly timeframeConfigs: Record<string, TimeframeConfig> = {
    '1w': { interval: '1h', windowMs: 7 * 24 * 60 * 60 * 1000, displayName: '1周' },
    '1m': { interval: '1d', windowMs: 30 * 24 * 60 * 60 * 1000, displayName: '1个月' },
    '6m': { interval: '1d', windowMs: 180 * 24 * 60 * 60 * 1000, displayName: '6个月' },
    '1y': { interval: '1d', windowMs: 365 * 24 * 60 * 60 * 1000, displayName: '1年' },
    'all': { interval: '1d', windowMs: 0, displayName: '全量历史' }
  };

  /**
   * 一次性初始化缓存
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // 首先尝试从文件加载缓存
    const loaded = await this.loadCacheFromFile();
    if (loaded) {
      this.isInitialized = true;
      log.info(`✅ Historical high cache loaded from file: ${this.cache.size} entries`);
      return;
    }

    log.info('🚀 Starting one-time historical high data collection...');

    try {
      // 获取所有期货交易对
      const symbols = await this.getFuturesSymbols();
      log.info(`📊 Found ${symbols.length} futures symbols to process`);

      // 并发处理，控制并发数量
      const concurrencyLimit = 8;
      let processed = 0;
      const failed: string[] = [];

      for (let i = 0; i < symbols.length; i += concurrencyLimit) {
        const batch = symbols.slice(i, i + concurrencyLimit);

        const batchResults = await Promise.allSettled(
          batch.map(symbol => this.collectSymbolData(symbol))
        );

        // 统计结果
        batchResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            failed.push(batch[index]);
            log.warn(`Failed to collect data for ${batch[index]}: ${result.reason}`);
          }
        });

        processed += batch.length;
        const progress = Math.round((processed / symbols.length) * 100);
        log.info(`📈 Progress: ${processed}/${symbols.length} (${progress}%) - Cache size: ${this.cache.size}`);

        // 批次间延迟
        if (i + concurrencyLimit < symbols.length) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      }

      this.isInitialized = true;

      // 保存缓存到文件
      await this.saveCacheToFile();

      log.info(`✅ Historical high cache initialized successfully!`);
      log.info(`📊 Total cached entries: ${this.cache.size}`);
      log.info(`❌ Failed symbols: ${failed.length}`);

      if (failed.length > 0) {
        log.warn(`Failed symbols (first 10): ${failed.slice(0, 10).join(', ')}`);
      }

    } catch (error) {
      log.error('❌ Failed to initialize historical high cache:', error);
      throw error;
    }
  }

  /**
   * 收集单个代币的历史数据
   */
  private async collectSymbolData(symbol: string): Promise<void> {
    try {
      // 获取当前价格
      const currentPrice = await binanceClient.getFuturesPrice(symbol);

      // 处理所有目标时间框架
      for (const [timeframe, config] of Object.entries(this.timeframeConfigs)) {
        await this.processTimeframe(symbol, timeframe, config, currentPrice);
        // 小延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 50));
      }

    } catch (error) {
      log.error(`Failed to collect data for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * 处理单个时间框架
   */
  private async processTimeframe(
    symbol: string,
    timeframe: string,
    config: TimeframeConfig,
    currentPrice: number
  ): Promise<void> {
    try {
      const now = Date.now();
      let startTime: number;

      if (timeframe === 'all') {
        // 全量历史数据：从币安期货上线开始（2019年）
        startTime = new Date('2019-09-01').getTime();
      } else {
        // 其他时间框架
        startTime = now - config.windowMs;
      }

      // 获取K线数据
      const klines = await this.getKlineData(symbol, config.interval, startTime, now);

      if (klines.length === 0) {
        log.debug(`No kline data for ${symbol} ${timeframe}`);
        return;
      }

      // 找到期间内最高价（包含当前价格）
      let highPrice = currentPrice;
      let highTimestamp = now;

      for (const kline of klines) {
        const klineHigh = parseFloat(kline.highPrice);
        if (klineHigh > highPrice) {
          highPrice = klineHigh;
          highTimestamp = kline.closeTime;
        }
      }

      // 计算距离百分比
      const distancePercent = ((currentPrice - highPrice) / highPrice) * 100;
      const neededGainPercent = distancePercent >= 0 ? 0 : Math.abs(distancePercent);

      // 存入缓存
      const cacheKey = `${symbol}:${timeframe}`;
      this.cache.set(cacheKey, {
        symbol,
        timeframe,
        currentPrice,
        highPrice,
        highTimestamp,
        distancePercent,
        neededGainPercent,
        lastUpdated: now
      });

    } catch (error) {
      log.error(`Failed to process ${symbol} ${timeframe}:`, error);
    }
  }

  /**
   * 获取K线数据 - 支持分批获取全量历史数据
   */
  private async getKlineData(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number
  ): Promise<KlineData[]> {
    try {
      const allKlines: KlineData[] = [];
      const batchSize = 1000;
      let currentStartTime = startTime;

      // 对于全量历史数据，需要分批获取
      while (currentStartTime < endTime) {
        const rawKlines = await binanceClient.getFuturesKlines({
          symbol,
          interval: interval as any,
          startTime: currentStartTime,
          endTime,
          limit: batchSize
        });

        if (rawKlines.length === 0) {
          break;
        }

        const mappedKlines = rawKlines.map(kline => ({
          openTime: kline.openTime,
          openPrice: kline.open,
          highPrice: kline.high,
          lowPrice: kline.low,
          closePrice: kline.close,
          volume: kline.volume,
          closeTime: kline.closeTime
        }));

        allKlines.push(...mappedKlines);

        // 如果返回的数据少于批次大小，说明已经获取完所有数据
        if (rawKlines.length < batchSize) {
          break;
        }

        // 设置下一批的开始时间（最后一根K线的结束时间 + 1毫秒）
        currentStartTime = rawKlines[rawKlines.length - 1].closeTime + 1;

        // 小延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      log.debug(`Collected ${allKlines.length} klines for ${symbol} ${interval} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);
      return allKlines;

    } catch (error) {
      log.error(`Failed to get kline data for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * 获取所有期货交易对
   */
  private async getFuturesSymbols(): Promise<string[]> {
    try {
      const exchangeInfo = await binanceClient.getFuturesExchangeInfo();
      const allSymbols = exchangeInfo.symbols
        .filter(symbol =>
          symbol.status === 'TRADING' &&
          symbol.contractType === 'PERPETUAL' &&
          symbol.quoteAsset === 'USDT'
        )
        .map(symbol => symbol.symbol);

      // 只过滤已下架代币，保留黑名单代币数据
      const filteredSymbols = filterHistoricalDataPairs(allSymbols);

      log.info(`📊 Filtered symbols: ${allSymbols.length} -> ${filteredSymbols.length} (removed ${allSymbols.length - filteredSymbols.length} delisted tokens)`);

      return filteredSymbols;
    } catch (error) {
      log.error('Failed to get futures symbols:', error);
      return [];
    }
  }

  /**
   * 查询历史新高信息
   */
  queryHistoricalHigh(symbol: string, timeframe: string): CachedHistoricalHigh | null {
    if (!this.isInitialized) {
      log.warn('Historical high cache not initialized yet');
      return null;
    }

    // 确保symbol以USDT结尾
    if (!symbol.endsWith('USDT')) {
      symbol = symbol + 'USDT';
    }

    const cacheKey = `${symbol.toUpperCase()}:${timeframe}`;
    return this.cache.get(cacheKey) || null;
  }

  /**
   * 获取排名
   */
  getRankingByProximityToHigh(timeframe: string, limit: number = 20): RankingData[] {
    if (!this.isInitialized) {
      log.warn('Historical high cache not initialized yet');
      return [];
    }

    const results: RankingData[] = [];

    // 筛选指定时间框架的数据
    for (const [key, data] of this.cache.entries()) {
      if (key.endsWith(`:${timeframe}`)) {
        results.push({
          symbol: data.symbol,
          currentPrice: data.currentPrice,
          highPrice: data.highPrice,
          highTimestamp: data.highTimestamp,
          distancePercent: data.distancePercent,
          neededGainPercent: data.neededGainPercent
        });
      }
    }

    log.info(`Found ${results.length} symbols for timeframe ${timeframe}`);

    // 按距离历史新高排序
    const sortedResults = results.sort((a, b) =>
      Math.abs(a.distancePercent) - Math.abs(b.distancePercent)
    );

    // 记录前几名用于调试
    const top5 = sortedResults.slice(0, 5);
    log.info(`Top 5 closest to ${timeframe} high: ${top5.map(r =>
      `${r.symbol}(${r.distancePercent.toFixed(2)}%)`
    ).join(', ')}`);

    return sortedResults.slice(0, limit);
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    isInitialized: boolean;
    cacheSize: number;
    timeframes: string[];
    symbolCount: number;
  } {
    const symbols = new Set<string>();
    for (const key of this.cache.keys()) {
      const symbol = key.split(':')[0];
      symbols.add(symbol);
    }

    return {
      isInitialized: this.isInitialized,
      cacheSize: this.cache.size,
      timeframes: Object.keys(this.timeframeConfigs),
      symbolCount: symbols.size
    };
  }

  /**
   * 获取支持的时间框架
   */
  getSupportedTimeframes(): Array<{ key: string; displayName: string }> {
    return Object.entries(this.timeframeConfigs).map(([key, config]) => ({
      key,
      displayName: config.displayName
    }));
  }

  /**
   * 从文件加载缓存
   */
  private async loadCacheFromFile(): Promise<boolean> {
    try {
      // 检查文件是否存在
      await fs.access(this.cacheFilePath);

      const fileContent = await fs.readFile(this.cacheFilePath, 'utf-8');
      const data = JSON.parse(fileContent);

      // 检查数据格式和时效性
      if (!data.version || !data.timestamp || !data.cache) {
        log.warn('Cache file format invalid, will rebuild cache');
        return false;
      }

      // 检查缓存是否过期（7天）
      const cacheAge = Date.now() - data.timestamp;
      const maxAge = 7 * 24 * 60 * 60 * 1000; // 7天

      if (cacheAge > maxAge) {
        log.info('Cache file expired, will rebuild cache');
        return false;
      }

      // 加载缓存数据
      this.cache.clear();
      for (const [key, value] of Object.entries(data.cache)) {
        this.cache.set(key, value as CachedHistoricalHigh);
      }

      log.info(`📁 Loaded ${this.cache.size} entries from cache file (age: ${Math.round(cacheAge / (24 * 60 * 60 * 1000))} days)`);
      return true;

    } catch (error) {
      log.debug('No cache file found or failed to load, will collect fresh data');
      return false;
    }
  }

  /**
   * 保存缓存到文件
   */
  private async saveCacheToFile(): Promise<void> {
    try {
      // 确保目录存在
      const dataDir = join(process.cwd(), 'data');
      await fs.mkdir(dataDir, { recursive: true });

      const cacheData = {
        version: '2.0',
        timestamp: Date.now(),
        cache: Object.fromEntries(this.cache.entries())
      };

      await fs.writeFile(this.cacheFilePath, JSON.stringify(cacheData, null, 2));
      log.info(`💾 Historical high cache saved to file: ${this.cache.size} entries`);

    } catch (error) {
      log.error('Failed to save cache to file:', error);
    }
  }

  /**
   * 重新收集特定代币的数据
   */
  async recollectSymbols(symbols: string[]): Promise<{ success: string[]; failed: string[] }> {
    if (!this.isInitialized) {
      log.warn('Cache not initialized, cannot recollect symbols');
      return { success: [], failed: symbols };
    }

    const success: string[] = [];
    const failed: string[] = [];

    log.info(`🔄 Starting recollection for ${symbols.length} symbols: ${symbols.join(', ')}`);

    for (const symbol of symbols) {
      try {
        await this.collectSymbolData(symbol);
        success.push(symbol);
        log.info(`✅ Recollected data for ${symbol}`);

        // 延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        failed.push(symbol);
        log.error(`❌ Failed to recollect ${symbol}:`, error);
      }
    }

    // 保存更新后的缓存
    if (success.length > 0) {
      await this.saveCacheToFile();
      log.info(`💾 Updated cache saved with ${success.length} new symbols`);
    }

    log.info(`🔄 Recollection completed: ${success.length} success, ${failed.length} failed`);
    return { success, failed };
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    // 保存缓存到文件
    if (this.cache.size > 0) {
      await this.saveCacheToFile();
    }

    this.cache.clear();
    this.isInitialized = false;
    log.info('Historical high cache V2 service stopped');
  }
}

export const historicalHighCache = new HistoricalHighCacheV2();
export { HistoricalHighCacheV2 };