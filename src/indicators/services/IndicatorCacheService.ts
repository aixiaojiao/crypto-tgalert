import { injectable } from 'inversify';
import {
  IndicatorResult,
  SignalResult,
  CompositeSignal,
  TimeFrame,
  IndicatorParams
} from '../types';
import { CacheType, CacheConfigManager } from '../config/CacheConfig';
import { ILifecycleAware } from '../../core/Application';
import { log } from '../../utils/logger';

/**
 * 缓存项接口
 */
interface CacheItem<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * 缓存键接口
 */
interface CacheKey {
  type: 'indicator' | 'signal' | 'composite';
  symbol: string;
  indicatorName: string;
  timeframe: TimeFrame;
  params?: IndicatorParams;
  dataHash?: string; // 用于数据变化检测
}

/**
 * 缓存配置接口
 */
interface CacheConfig {
  maxSize: number;
  defaultTTL: number;
  cleanupInterval: number;
  enableLRU: boolean;
  enableStats: boolean;
}

/**
 * 缓存统计接口
 */
interface CacheStats {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  totalSize: number;
  hitRate: number;
  memoryUsage: number;
  oldestEntry: number;
  newestEntry: number;
}

/**
 * 指标缓存服务接口
 */
export interface IIndicatorCacheService {
  /**
   * 缓存指标计算结果
   */
  setIndicatorResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    result: IndicatorResult,
    params?: IndicatorParams,
    ttl?: number
  ): Promise<void>;

  /**
   * 获取缓存的指标结果
   */
  getIndicatorResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    params?: IndicatorParams
  ): Promise<IndicatorResult | null>;

  /**
   * 缓存信号分析结果
   */
  setSignalResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    result: SignalResult,
    params?: IndicatorParams,
    ttl?: number
  ): Promise<void>;

  /**
   * 获取缓存的信号结果
   */
  getSignalResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    params?: IndicatorParams
  ): Promise<SignalResult | null>;

  /**
   * 缓存综合信号分析结果
   */
  setCompositeSignal(
    symbol: string,
    timeframe: TimeFrame,
    result: CompositeSignal,
    ttl?: number
  ): Promise<void>;

  /**
   * 获取缓存的综合信号
   */
  getCompositeSignal(
    symbol: string,
    timeframe: TimeFrame
  ): Promise<CompositeSignal | null>;

  /**
   * 批量删除缓存
   */
  invalidateSymbol(symbol: string): Promise<number>;

  /**
   * 删除特定指标的缓存
   */
  invalidateIndicator(
    symbol: string,
    indicatorName: string,
    timeframe?: TimeFrame
  ): Promise<number>;

  /**
   * 清理所有缓存
   */
  clear(): Promise<void>;

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats;

  /**
   * 获取缓存大小
   */
  getSize(): number;

  /**
   * 设置缓存配置
   */
  setConfig(config: Partial<CacheConfig>): void;
}

/**
 * 指标缓存服务
 * 提供高性能的技术指标结果缓存功能
 */
@injectable()
export class IndicatorCacheService implements IIndicatorCacheService, ILifecycleAware {
  private cache = new Map<string, CacheItem<any>>();
  private isInitialized = false;
  private cleanupTimer: NodeJS.Timeout | undefined = undefined;

  private config: CacheConfig;
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0
  };

  constructor() {
    // 使用全局缓存配置初始化
    const globalConfig = CacheConfigManager.getGlobalConfig();
    this.config = {
      maxSize: 15000,                         // 优化后的最大缓存项数
      defaultTTL: globalConfig.defaultTTL,
      cleanupInterval: globalConfig.cleanupInterval,
      enableLRU: true,
      enableStats: globalConfig.enableStats
    };
  }

  /**
   * 初始化缓存服务
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      log.info('🔧 Initializing Indicator Cache Service');

      // 启动清理定时器
      this.startCleanupTimer();

      // 重置统计
      this.resetStats();

      this.isInitialized = true;
      log.info('✅ Indicator Cache Service initialized successfully');

    } catch (error) {
      log.error('❌ Failed to initialize Indicator Cache Service', error);
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

    log.info('🚀 Indicator Cache Service started');
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    log.info('🛑 Stopping Indicator Cache Service');

    // 停止清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    log.info('✅ Indicator Cache Service stopped');
  }

  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    await this.stop();

    // 清理所有缓存
    this.cache.clear();
    this.resetStats();
    this.isInitialized = false;

    log.info('🗑️ Indicator Cache Service destroyed');
  }

  /**
   * 缓存指标计算结果
   */
  async setIndicatorResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    result: IndicatorResult,
    params?: IndicatorParams,
    ttl?: number
  ): Promise<void> {
    try {
      const cacheKeyData: CacheKey = {
        type: 'indicator',
        symbol,
        indicatorName,
        timeframe
      };
      if (params) {
        cacheKeyData.params = params;
      }
      const key = this.buildCacheKey(cacheKeyData);

      const actualTTL = ttl || CacheConfigManager.getTTL(CacheType.INDICATOR, timeframe) || this.config.defaultTTL;

      await this.setCache(key, result, actualTTL);

      log.debug(`Cached indicator result: ${indicatorName} for ${symbol}:${timeframe}`);

    } catch (error) {
      log.warn(`Failed to cache indicator result for ${symbol}:${indicatorName}`, error);
    }
  }

  /**
   * 获取缓存的指标结果
   */
  async getIndicatorResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    params?: IndicatorParams
  ): Promise<IndicatorResult | null> {
    try {
      const cacheKeyData: CacheKey = {
        type: 'indicator',
        symbol,
        indicatorName,
        timeframe
      };
      if (params) {
        cacheKeyData.params = params;
      }
      const key = this.buildCacheKey(cacheKeyData);

      return await this.getCache<IndicatorResult>(key);

    } catch (error) {
      log.warn(`Failed to get cached indicator result for ${symbol}:${indicatorName}`, error);
      return null;
    }
  }

  /**
   * 缓存信号分析结果
   */
  async setSignalResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    result: SignalResult,
    params?: IndicatorParams,
    ttl?: number
  ): Promise<void> {
    try {
      const cacheKeyData: CacheKey = {
        type: 'signal',
        symbol,
        indicatorName,
        timeframe
      };
      if (params) {
        cacheKeyData.params = params;
      }
      const key = this.buildCacheKey(cacheKeyData);

      const actualTTL = ttl || CacheConfigManager.getTTL(CacheType.SIGNAL, timeframe) || this.config.defaultTTL;

      await this.setCache(key, result, actualTTL);

      log.debug(`Cached signal result: ${indicatorName} for ${symbol}:${timeframe}`);

    } catch (error) {
      log.warn(`Failed to cache signal result for ${symbol}:${indicatorName}`, error);
    }
  }

  /**
   * 获取缓存的信号结果
   */
  async getSignalResult(
    symbol: string,
    indicatorName: string,
    timeframe: TimeFrame,
    params?: IndicatorParams
  ): Promise<SignalResult | null> {
    try {
      const cacheKeyData: CacheKey = {
        type: 'signal',
        symbol,
        indicatorName,
        timeframe
      };
      if (params) {
        cacheKeyData.params = params;
      }
      const key = this.buildCacheKey(cacheKeyData);

      return await this.getCache<SignalResult>(key);

    } catch (error) {
      log.warn(`Failed to get cached signal result for ${symbol}:${indicatorName}`, error);
      return null;
    }
  }

  /**
   * 缓存综合信号分析结果
   */
  async setCompositeSignal(
    symbol: string,
    timeframe: TimeFrame,
    result: CompositeSignal,
    ttl?: number
  ): Promise<void> {
    try {
      const key = this.buildCacheKey({
        type: 'composite',
        symbol,
        indicatorName: 'composite',
        timeframe
      });

      const actualTTL = ttl || CacheConfigManager.getTTL(CacheType.COMPOSITE, timeframe) || this.config.defaultTTL;

      await this.setCache(key, result, actualTTL);

      log.debug(`Cached composite signal for ${symbol}:${timeframe}`);

    } catch (error) {
      log.warn(`Failed to cache composite signal for ${symbol}`, error);
    }
  }

  /**
   * 获取缓存的综合信号
   */
  async getCompositeSignal(
    symbol: string,
    timeframe: TimeFrame
  ): Promise<CompositeSignal | null> {
    try {
      const key = this.buildCacheKey({
        type: 'composite',
        symbol,
        indicatorName: 'composite',
        timeframe
      });

      return await this.getCache<CompositeSignal>(key);

    } catch (error) {
      log.warn(`Failed to get cached composite signal for ${symbol}`, error);
      return null;
    }
  }

  /**
   * 批量删除缓存
   */
  async invalidateSymbol(symbol: string): Promise<number> {
    try {
      const symbolUpper = symbol.toUpperCase();
      const keysToDelete: string[] = [];

      for (const key of this.cache.keys()) {
        if (key.includes(`:${symbolUpper}:`)) {
          keysToDelete.push(key);
        }
      }

      keysToDelete.forEach(key => this.cache.delete(key));

      log.debug(`Invalidated ${keysToDelete.length} cache entries for ${symbol}`);
      return keysToDelete.length;

    } catch (error) {
      log.warn(`Failed to invalidate cache for symbol ${symbol}`, error);
      return 0;
    }
  }

  /**
   * 删除特定指标的缓存
   */
  async invalidateIndicator(
    symbol: string,
    indicatorName: string,
    timeframe?: TimeFrame
  ): Promise<number> {
    try {
      const symbolUpper = symbol.toUpperCase();
      const keysToDelete: string[] = [];

      for (const key of this.cache.keys()) {
        const keyParts = key.split(':');
        const keySymbol = keyParts[1];
        const keyIndicator = keyParts[2];
        const keyTimeframe = keyParts[3];

        if (keySymbol === symbolUpper && keyIndicator === indicatorName) {
          if (!timeframe || keyTimeframe === timeframe) {
            keysToDelete.push(key);
          }
        }
      }

      keysToDelete.forEach(key => this.cache.delete(key));

      log.debug(`Invalidated ${keysToDelete.length} cache entries for ${symbol}:${indicatorName}`);
      return keysToDelete.length;

    } catch (error) {
      log.warn(`Failed to invalidate cache for ${symbol}:${indicatorName}`, error);
      return 0;
    }
  }

  /**
   * 清理所有缓存
   */
  async clear(): Promise<void> {
    try {
      const size = this.cache.size;
      this.cache.clear();
      this.resetStats();

      log.info(`Cleared all cache entries (${size} items)`);

    } catch (error) {
      log.warn('Failed to clear cache', error);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const hitRate = this.stats.totalRequests > 0
      ? (this.stats.cacheHits / this.stats.totalRequests) * 100
      : 0;

    let oldestEntry = Date.now();
    let newestEntry = 0;

    for (const item of this.cache.values()) {
      if (item.timestamp < oldestEntry) {
        oldestEntry = item.timestamp;
      }
      if (item.timestamp > newestEntry) {
        newestEntry = item.timestamp;
      }
    }

    return {
      totalRequests: this.stats.totalRequests,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      totalSize: this.cache.size,
      hitRate: Math.round(hitRate * 100) / 100,
      memoryUsage: this.estimateMemoryUsage(),
      oldestEntry: this.cache.size > 0 ? oldestEntry : 0,
      newestEntry: this.cache.size > 0 ? newestEntry : 0
    };
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return this.cache.size;
  }

  /**
   * 设置缓存配置
   */
  setConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };

    // 重新启动清理定时器
    if (config.cleanupInterval && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.startCleanupTimer();
    }

    log.debug('Cache configuration updated', this.config);
  }

  // Private methods

  private buildCacheKey(cacheKey: CacheKey): string {
    const parts = [
      cacheKey.type,
      cacheKey.symbol.toUpperCase(),
      cacheKey.indicatorName,
      cacheKey.timeframe
    ];

    if (cacheKey.params) {
      const paramHash = this.hashParams(cacheKey.params);
      parts.push(paramHash);
    }

    if (cacheKey.dataHash) {
      parts.push(cacheKey.dataHash);
    }

    return parts.join(':');
  }

  private hashParams(params: IndicatorParams): string {
    // 简单的参数哈希，用于区分不同的参数组合
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('|');

    return Buffer.from(sortedParams).toString('base64').substring(0, 8);
  }

  private async setCache<T>(key: string, data: T, ttl: number): Promise<void> {
    // 检查缓存大小限制
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      if (this.config.enableLRU) {
        this.evictLRU();
      } else {
        // 如果不启用LRU，拒绝新的缓存
        return;
      }
    }

    const item: CacheItem<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      accessCount: 0,
      lastAccessed: Date.now()
    };

    this.cache.set(key, item);
  }

  private async getCache<T>(key: string): Promise<T | null> {
    this.stats.totalRequests++;

    const item = this.cache.get(key);

    if (!item) {
      this.stats.cacheMisses++;
      return null;
    }

    // 检查TTL
    if (Date.now() > item.timestamp + item.ttl) {
      this.cache.delete(key);
      this.stats.cacheMisses++;
      return null;
    }

    // 更新访问统计
    item.accessCount++;
    item.lastAccessed = Date.now();

    this.stats.cacheHits++;
    return item.data as T;
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Date.now();

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessed < oldestTime) {
        oldestTime = item.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      log.debug(`Evicted LRU cache entry: ${oldestKey}`);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, this.config.cleanupInterval);
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (now > item.timestamp + item.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      log.debug(`Cleaned up ${keysToDelete.length} expired cache entries`);
    }
  }

  private estimateMemoryUsage(): number {
    // 简单估算内存使用（字节）
    let totalSize = 0;

    for (const [key, item] of this.cache.entries()) {
      // 键的大小
      totalSize += key.length * 2; // 假设字符串是UTF-16

      // 数据的大小（粗略估算）
      totalSize += JSON.stringify(item.data).length * 2;

      // CacheItem元数据的大小
      totalSize += 64; // 粗略估算
    }

    return totalSize;
  }

  private resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
  }
}