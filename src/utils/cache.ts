import * as fs from 'fs';
import * as path from 'path';
import { log } from './logger';
import { Injectable, Singleton } from '../core/container/decorators';

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  size: number;
  hitRate: number;
}

export interface CacheOptions {
  maxSize?: number;
  defaultTtl?: number;
  persistentCacheDir?: string;
  enablePersistent?: boolean;
}

/**
 * Multi-tier caching system with L1 memory cache and L2 persistent cache
 */
@Injectable()
export class CacheManager<T = any> {
  private memoryCache = new Map<string, CacheEntry<T>>();
  private stats = {
    hits: 0,
    misses: 0,
    sets: 0
  };
  
  private maxSize: number;
  private defaultTtl: number;
  private persistentCacheDir: string;
  private enablePersistent: boolean;
  
  // TTL configurations based on PRD
  public static readonly TTL = {
    PRICE: 30 * 1000,         // 30 seconds
    STATS_24H: 5 * 60 * 1000, // 5 minutes
    FUNDING: 10 * 60 * 1000,  // 10 minutes
    OI_HIST: 60 * 60 * 1000,  // 1 hour
    SYMBOLS: 24 * 60 * 60 * 1000 // 24 hours
  };

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize || 10000;
    this.defaultTtl = options.defaultTtl || CacheManager.TTL.STATS_24H;
    this.persistentCacheDir = options.persistentCacheDir || path.join(process.cwd(), 'data', 'cache');
    this.enablePersistent = options.enablePersistent ?? true;
    
    if (this.enablePersistent) {
      this.ensureCacheDirectory();
    }
    
    log.info('CacheManager initialized', {
      maxSize: this.maxSize,
      defaultTtl: this.defaultTtl,
      persistentCache: this.enablePersistent
    });
  }

  /**
   * Get value from cache with automatic fallback to persistent cache
   */
  async get(key: string): Promise<T | null> {
    // L1: Check memory cache first
    const memoryEntry = this.memoryCache.get(key);
    if (memoryEntry && !this.isExpired(memoryEntry)) {
      this.stats.hits++;
      log.debug(`Cache HIT (memory): ${key}`);
      return memoryEntry.value;
    }

    // L2: Check persistent cache
    if (this.enablePersistent) {
      const persistentValue = await this.getPersistent(key);
      if (persistentValue !== null) {
        // Promote to memory cache for faster future access
        this.memoryCache.set(key, {
          value: persistentValue,
          timestamp: Date.now(),
          ttl: this.defaultTtl
        });
        this.stats.hits++;
        log.debug(`Cache HIT (persistent): ${key}`);
        return persistentValue;
      }
    }

    // Cache miss
    this.stats.misses++;
    log.debug(`Cache MISS: ${key}`);
    return null;
  }

  /**
   * Set value in cache with custom TTL
   */
  async set(key: string, value: T, ttl: number = this.defaultTtl): Promise<void> {
    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl
    };

    // L1: Store in memory cache
    this.memoryCache.set(key, entry);
    
    // L2: Store in persistent cache for longer-lived data
    if (this.enablePersistent && ttl >= CacheManager.TTL.STATS_24H) {
      await this.setPersistent(key, entry);
    }

    this.stats.sets++;
    
    // Implement LRU eviction if memory cache is full
    if (this.memoryCache.size > this.maxSize) {
      this.evictLRU();
    }

    log.debug(`Cache SET: ${key} (TTL: ${ttl}ms)`);
  }

  /**
   * Batch get multiple keys efficiently
   */
  async batchGet(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();
    
    for (const key of keys) {
      const value = await this.get(key);
      results.set(key, value);
    }
    
    return results;
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let invalidated = 0;
    
    // Invalidate memory cache
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        this.memoryCache.delete(key);
        invalidated++;
      }
    }
    
    // TODO: Implement persistent cache pattern invalidation
    log.info(`Invalidated ${invalidated} cache entries matching pattern: ${pattern}`);
    return invalidated;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      sets: this.stats.sets,
      size: this.memoryCache.size,
      hitRate: total > 0 ? (this.stats.hits / total) * 100 : 0
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.memoryCache.clear();
    this.stats = { hits: 0, misses: 0, sets: 0 };
    log.info('Cache cleared');
  }

  // Private methods

  private isExpired(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  private evictLRU(): void {
    // Find and remove the oldest entry
    let oldestKey = '';
    let oldestTimestamp = Date.now();
    
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
      log.debug(`Evicted LRU cache entry: ${oldestKey}`);
    }
  }

  private ensureCacheDirectory(): void {
    try {
      if (!fs.existsSync(this.persistentCacheDir)) {
        fs.mkdirSync(this.persistentCacheDir, { recursive: true });
      }
    } catch (error) {
      log.error('Failed to create cache directory', error);
      this.enablePersistent = false;
    }
  }

  private async getPersistent(key: string): Promise<T | null> {
    try {
      const filePath = this.getCacheFilePath(key);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const data = fs.readFileSync(filePath, 'utf8');
      const entry: CacheEntry<T> = JSON.parse(data);
      
      if (this.isExpired(entry)) {
        // Remove expired file
        fs.unlinkSync(filePath);
        return null;
      }
      
      return entry.value;
    } catch (error) {
      log.error(`Failed to read persistent cache: ${key}`, error);
      return null;
    }
  }

  private async setPersistent(key: string, entry: CacheEntry<T>): Promise<void> {
    try {
      const filePath = this.getCacheFilePath(key);
      const data = JSON.stringify(entry);
      fs.writeFileSync(filePath, data, 'utf8');
    } catch (error) {
      log.error(`Failed to write persistent cache: ${key}`, error);
    }
  }

  private getCacheFilePath(key: string): string {
    // Create safe filename from cache key
    const safeKey = key.replace(/[^a-zA-Z0-9-_]/g, '_');
    return path.join(this.persistentCacheDir, `${safeKey}.json`);
  }
}

// DI-ready cache service classes for different data types
@Singleton
export class PriceCacheService extends CacheManager {
  constructor() {
    super({
      maxSize: 5000,
      defaultTtl: CacheManager.TTL.PRICE,
      enablePersistent: false // Price data is too volatile for persistent cache
    });
  }
}

@Singleton
export class MarketDataCacheService extends CacheManager {
  constructor() {
    super({
      maxSize: 2000,
      defaultTtl: CacheManager.TTL.STATS_24H,
      enablePersistent: true
    });
  }
}

@Singleton
export class OICacheService extends CacheManager {
  constructor() {
    super({
      maxSize: 3000,
      defaultTtl: CacheManager.TTL.OI_HIST,
      enablePersistent: true
    });
  }
}

@Singleton
export class FundingCacheService extends CacheManager {
  constructor() {
    super({
      maxSize: 1000,
      defaultTtl: CacheManager.TTL.FUNDING,
      enablePersistent: true
    });
  }
}

// 保持向后兼容的导出（迁移期间使用）
export const priceCache = new CacheManager({
  maxSize: 5000,
  defaultTtl: CacheManager.TTL.PRICE,
  enablePersistent: false // Price data is too volatile for persistent cache
});

export const marketDataCache = new CacheManager({
  maxSize: 2000,
  defaultTtl: CacheManager.TTL.STATS_24H,
  enablePersistent: true
});

export const oiCache = new CacheManager({
  maxSize: 3000,
  defaultTtl: CacheManager.TTL.OI_HIST,
  enablePersistent: true
});

export const fundingCache = new CacheManager({
  maxSize: 1000,
  defaultTtl: CacheManager.TTL.FUNDING,
  enablePersistent: true
});