import { injectable, inject } from 'inversify';
import {
  OHLCV,
  TimeFrame,
  IndicatorError
} from '../types';
import { SERVICE_IDENTIFIERS } from '../../core/container/decorators';
import { CacheType, CacheConfigManager } from '../config/CacheConfig';
import { BinanceClient } from '../../services/binance';
import { Kline, KlineInterval, KlinesParams } from '../../types/binance';
import { ILifecycleAware } from '../../core/Application';
import { log } from '../../utils/logger';

/**
 * OHLCV数据服务接口
 */
export interface IOHLCVDataService {
  /**
   * 获取K线数据
   */
  getOHLCVData(
    symbol: string,
    timeframe: TimeFrame,
    limit?: number,
    startTime?: number,
    endTime?: number,
    market?: 'spot' | 'futures'
  ): Promise<OHLCV[]>;

  /**
   * 获取最新的K线数据
   */
  getLatestOHLCV(
    symbol: string,
    timeframe: TimeFrame,
    market?: 'spot' | 'futures'
  ): Promise<OHLCV>;

  /**
   * 获取多个时间框架的数据
   */
  getMultiTimeframeData(
    symbol: string,
    timeframes: TimeFrame[],
    limit?: number,
    market?: 'spot' | 'futures'
  ): Promise<{ [timeframe: string]: OHLCV[] }>;

  /**
   * 验证符号是否有效
   */
  validateSymbol(
    symbol: string,
    market?: 'spot' | 'futures'
  ): Promise<boolean>;

  /**
   * 获取支持的时间框架
   */
  getSupportedTimeframes(): TimeFrame[];

  /**
   * 获取数据统计信息
   */
  getDataStats(): {
    requestsCount: number;
    cacheHitRate: number;
    averageResponseTime: number;
    errorCount: number;
  };
}

/**
 * 数据请求统计
 */
interface DataStats {
  totalRequests: number;
  cacheHits: number;
  totalResponseTime: number;
  errorCount: number;
}

/**
 * 缓存键构建器
 */
class CacheKeyBuilder {
  static build(
    symbol: string,
    timeframe: TimeFrame,
    limit?: number,
    startTime?: number,
    endTime?: number,
    market?: 'spot' | 'futures'
  ): string {
    const parts = [
      'ohlcv',
      symbol.toUpperCase(),
      timeframe,
      market || 'futures',
      limit || 'default',
      startTime || 'none',
      endTime || 'none'
    ];

    return parts.join(':');
  }
}

/**
 * OHLCV数据服务
 * 负责从Binance获取K线数据并转换为技术指标所需的OHLCV格式
 */
@injectable()
export class OHLCVDataService implements IOHLCVDataService, ILifecycleAware {
  private binanceClient: BinanceClient;
  private isInitialized = false;
  private cache = new Map<string, { data: OHLCV[]; timestamp: number; ttl: number }>();
  private stats: DataStats = {
    totalRequests: 0,
    cacheHits: 0,
    totalResponseTime: 0,
    errorCount: 0
  };


  constructor(
    @inject(SERVICE_IDENTIFIERS.BINANCE_CLIENT) binanceClient: BinanceClient
  ) {
    this.binanceClient = binanceClient;
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      log.info('🔧 Initializing OHLCV Data Service');

      // 验证Binance客户端连接
      const isConnected = await this.binanceClient.ping();
      if (!isConnected) {
        throw new Error('Failed to connect to Binance API');
      }

      // 初始化统计信息
      this.resetStats();

      // 启动缓存清理定时器
      this.startCacheCleanup();

      this.isInitialized = true;
      log.info('✅ OHLCV Data Service initialized successfully');

    } catch (error) {
      log.error('❌ Failed to initialize OHLCV Data Service', error);
      throw error;
    }
  }

  /**
   * 启动服务
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    log.info('🚀 OHLCV Data Service started');
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    log.info('🛑 Stopping OHLCV Data Service');

    // 清理缓存
    this.cache.clear();

    log.info('✅ OHLCV Data Service stopped');
  }

  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.resetStats();
    this.isInitialized = false;

    log.info('🗑️ OHLCV Data Service destroyed');
  }

  /**
   * 获取K线数据
   */
  async getOHLCVData(
    symbol: string,
    timeframe: TimeFrame,
    limit: number = 500,
    startTime?: number,
    endTime?: number,
    market: 'spot' | 'futures' = 'futures'
  ): Promise<OHLCV[]> {
    const startRequestTime = Date.now();

    try {
      this.stats.totalRequests++;

      // 验证输入参数
      this.validateInputs(symbol, timeframe, limit);

      // 检查缓存
      const cacheKey = CacheKeyBuilder.build(symbol, timeframe, limit, startTime, endTime, market);
      const cached = this.getFromCache(cacheKey);

      if (cached) {
        this.stats.cacheHits++;
        this.updateResponseTime(startRequestTime);

        log.debug(`OHLCV data from cache for ${symbol}`, {
          timeframe,
          market,
          dataPoints: cached.length
        });

        return cached;
      }

      // 从Binance获取数据
      const interval = this.timeframeToInterval(timeframe);
      const klinesParams: KlinesParams = {
        symbol: symbol.toUpperCase(),
        interval,
        limit: Math.min(limit, 1000) // Binance限制最大1000
      };

      if (startTime !== undefined) {
        klinesParams.startTime = startTime;
      }
      if (endTime !== undefined) {
        klinesParams.endTime = endTime;
      }

      let klines: Kline[];
      if (market === 'futures') {
        klines = await this.binanceClient.getFuturesKlines(klinesParams);
      } else {
        klines = await this.binanceClient.getKlines(klinesParams);
      }

      // 转换为OHLCV格式
      const ohlcvData = this.convertKlinesToOHLCV(klines);

      // 缓存结果
      this.setCache(cacheKey, ohlcvData, timeframe);

      this.updateResponseTime(startRequestTime);

      log.debug(`OHLCV data fetched for ${symbol}`, {
        timeframe,
        market,
        dataPoints: ohlcvData.length,
        fromCache: false
      });

      return ohlcvData;

    } catch (error) {
      this.stats.errorCount++;
      this.updateResponseTime(startRequestTime);

      log.error(`Failed to get OHLCV data for ${symbol}`, {
        timeframe,
        market,
        error
      });

      if (error instanceof IndicatorError) {
        throw error;
      }

      throw new IndicatorError(
        `Failed to fetch OHLCV data: ${error instanceof Error ? error.message : String(error)}`,
        'OHLCVDataService'
      );
    }
  }

  /**
   * 获取最新的K线数据
   */
  async getLatestOHLCV(
    symbol: string,
    timeframe: TimeFrame,
    market: 'spot' | 'futures' = 'futures'
  ): Promise<OHLCV> {
    try {
      const data = await this.getOHLCVData(symbol, timeframe, 1, undefined, undefined, market);

      if (data.length === 0) {
        throw new IndicatorError(`No OHLCV data available for ${symbol}`, 'OHLCVDataService');
      }

      return data[data.length - 1];

    } catch (error) {
      log.error(`Failed to get latest OHLCV for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * 获取多个时间框架的数据
   */
  async getMultiTimeframeData(
    symbol: string,
    timeframes: TimeFrame[],
    limit: number = 500,
    market: 'spot' | 'futures' = 'futures'
  ): Promise<{ [timeframe: string]: OHLCV[] }> {
    try {
      const results: { [timeframe: string]: OHLCV[] } = {};

      // 并行获取所有时间框架的数据
      const requests = timeframes.map(async (timeframe) => {
        try {
          const data = await this.getOHLCVData(symbol, timeframe, limit, undefined, undefined, market);
          return { timeframe, data };
        } catch (error) {
          log.warn(`Failed to get data for timeframe ${timeframe}:`, error);
          return { timeframe, data: [] };
        }
      });

      const responses = await Promise.all(requests);

      responses.forEach(({ timeframe, data }) => {
        results[timeframe] = data;
      });

      log.debug(`Multi-timeframe data fetched for ${symbol}`, {
        timeframes: timeframes.length,
        market,
        totalDataPoints: Object.values(results).reduce((sum, data) => sum + data.length, 0)
      });

      return results;

    } catch (error) {
      log.error(`Failed to get multi-timeframe data for ${symbol}`, error);
      throw error;
    }
  }

  /**
   * 验证符号是否有效
   */
  async validateSymbol(
    symbol: string,
    market: 'spot' | 'futures' = 'futures'
  ): Promise<boolean> {
    try {
      if (market === 'futures') {
        return await this.binanceClient.isFuturesSymbolValid(symbol);
      } else {
        return await this.binanceClient.isSymbolValid(symbol);
      }
    } catch (error) {
      log.debug(`Symbol validation failed for ${symbol}`, error);
      return false;
    }
  }

  /**
   * 获取支持的时间框架
   */
  getSupportedTimeframes(): TimeFrame[] {
    return [
      TimeFrame.M1,
      TimeFrame.M5,
      TimeFrame.M15,
      TimeFrame.M30,
      TimeFrame.H1,
      TimeFrame.H4,
      TimeFrame.D1,
      TimeFrame.W1,
      TimeFrame.MN1
    ];
  }

  /**
   * 获取数据统计信息
   */
  getDataStats() {
    const cacheHitRate = this.stats.totalRequests > 0
      ? (this.stats.cacheHits / this.stats.totalRequests) * 100
      : 0;

    const avgResponseTime = this.stats.totalRequests > 0
      ? this.stats.totalResponseTime / this.stats.totalRequests
      : 0;

    return {
      requestsCount: this.stats.totalRequests,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      averageResponseTime: Math.round(avgResponseTime * 100) / 100,
      errorCount: this.stats.errorCount
    };
  }

  // Private methods

  private validateInputs(symbol: string, timeframe: TimeFrame, limit: number): void {
    if (!symbol || typeof symbol !== 'string') {
      throw new IndicatorError('Symbol must be a non-empty string', 'OHLCVDataService');
    }

    if (!this.getSupportedTimeframes().includes(timeframe)) {
      throw new IndicatorError(`Unsupported timeframe: ${timeframe}`, 'OHLCVDataService');
    }

    if (limit <= 0 || limit > 1000) {
      throw new IndicatorError('Limit must be between 1 and 1000', 'OHLCVDataService');
    }
  }

  private timeframeToInterval(timeframe: TimeFrame): KlineInterval {
    const mapping: { [key in TimeFrame]: KlineInterval } = {
      [TimeFrame.M1]: '1m',
      [TimeFrame.M5]: '5m',
      [TimeFrame.M15]: '15m',
      [TimeFrame.M30]: '30m',
      [TimeFrame.H1]: '1h',
      [TimeFrame.H4]: '4h',
      [TimeFrame.D1]: '1d',
      [TimeFrame.W1]: '1w',
      [TimeFrame.MN1]: '1M'
    };

    return mapping[timeframe];
  }

  private convertKlinesToOHLCV(klines: Kline[]): OHLCV[] {
    return klines.map(kline => ({
      timestamp: kline.openTime,
      open: parseFloat(kline.open),
      high: parseFloat(kline.high),
      low: parseFloat(kline.low),
      close: parseFloat(kline.close),
      volume: parseFloat(kline.volume)
    }));
  }

  private getFromCache(key: string): OHLCV[] | null {
    const cached = this.cache.get(key);

    if (!cached) return null;

    // 检查TTL
    if (Date.now() > cached.timestamp + cached.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setCache(key: string, data: OHLCV[], timeframe: TimeFrame): void {
    const ttl = CacheConfigManager.getTTL(CacheType.OHLCV, timeframe);

    this.cache.set(key, {
      data: [...data], // 创建副本避免外部修改
      timestamp: Date.now(),
      ttl
    });
  }

  private startCacheCleanup(): void {
    // 每5分钟清理一次过期缓存
    setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];

      for (const [key, cached] of this.cache.entries()) {
        if (now > cached.timestamp + cached.ttl) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach(key => this.cache.delete(key));

      if (keysToDelete.length > 0) {
        log.debug(`Cleaned up ${keysToDelete.length} expired cache entries`);
      }
    }, 5 * 60 * 1000);
  }

  private updateResponseTime(startTime: number): void {
    const responseTime = Date.now() - startTime;
    this.stats.totalResponseTime += responseTime;
  }

  private resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      totalResponseTime: 0,
      errorCount: 0
    };
  }
}