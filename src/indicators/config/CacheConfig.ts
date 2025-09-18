/**
 * 技术指标缓存配置集中管理
 * Centralized Cache Configuration for Technical Indicators
 */

import { TimeFrame } from '../types';

/**
 * 缓存类型枚举
 */
export enum CacheType {
  OHLCV = 'ohlcv',           // K线数据缓存
  INDICATOR = 'indicator',    // 指标计算结果缓存
  SIGNAL = 'signal',         // 信号分析结果缓存
  COMPOSITE = 'composite'     // 综合信号缓存
}

/**
 * 缓存策略配置接口
 */
export interface CacheStrategyConfig {
  /** 缓存类型 */
  type: CacheType;
  /** 各时间框架的TTL配置(毫秒) */
  ttlByTimeframe: { [timeframe in TimeFrame]: number };
  /** 最大缓存项数 */
  maxSize: number;
  /** 是否启用LRU淘汰 */
  enableLRU: boolean;
  /** 内存使用限制(MB) */
  memoryLimitMB?: number;
}

/**
 * 全局缓存配置
 */
export interface GlobalCacheConfig {
  /** 默认TTL(毫秒) */
  defaultTTL: number;
  /** 清理间隔(毫秒) */
  cleanupInterval: number;
  /** 是否启用统计 */
  enableStats: boolean;
  /** 是否启用智能预缓存 */
  enablePredictiveCaching: boolean;
  /** 预缓存热门符号列表 */
  popularSymbols: string[];
  /** 预缓存优先时间框架 */
  preferredTimeframes: TimeFrame[];
  /** 总内存限制(MB) */
  totalMemoryLimitMB: number;
}

/**
 * 性能优化的缓存TTL配置
 * 基于市场活跃度和数据更新频率优化
 */
const OPTIMIZED_TTL_CONFIG = {
  // OHLCV数据TTL - 基于K线完成时间优化
  [CacheType.OHLCV]: {
    [TimeFrame.M1]: 45 * 1000,        // 45秒 - 给15秒缓冲时间
    [TimeFrame.M5]: 3 * 60 * 1000,    // 3分钟 - 优化为更长缓存
    [TimeFrame.M15]: 8 * 60 * 1000,   // 8分钟 - 平衡实时性和性能
    [TimeFrame.M30]: 15 * 60 * 1000,  // 15分钟
    [TimeFrame.H1]: 30 * 60 * 1000,   // 30分钟
    [TimeFrame.H4]: 2 * 60 * 60 * 1000, // 2小时
    [TimeFrame.D1]: 8 * 60 * 60 * 1000, // 8小时
    [TimeFrame.W1]: 2 * 24 * 60 * 60 * 1000, // 2天
    [TimeFrame.MN1]: 7 * 24 * 60 * 60 * 1000 // 7天
  },

  // 指标计算结果TTL - 基于计算复杂度优化
  [CacheType.INDICATOR]: {
    [TimeFrame.M1]: 30 * 1000,        // 30秒
    [TimeFrame.M5]: 2 * 60 * 1000,    // 2分钟
    [TimeFrame.M15]: 5 * 60 * 1000,   // 5分钟
    [TimeFrame.M30]: 10 * 60 * 1000,  // 10分钟
    [TimeFrame.H1]: 20 * 60 * 1000,   // 20分钟
    [TimeFrame.H4]: 60 * 60 * 1000,   // 1小时
    [TimeFrame.D1]: 6 * 60 * 60 * 1000, // 6小时
    [TimeFrame.W1]: 24 * 60 * 60 * 1000, // 1天
    [TimeFrame.MN1]: 7 * 24 * 60 * 60 * 1000 // 7天
  },

  // 信号分析结果TTL - 更短的缓存时间以保持信号敏感性
  [CacheType.SIGNAL]: {
    [TimeFrame.M1]: 20 * 1000,        // 20秒
    [TimeFrame.M5]: 90 * 1000,        // 90秒
    [TimeFrame.M15]: 4 * 60 * 1000,   // 4分钟
    [TimeFrame.M30]: 8 * 60 * 1000,   // 8分钟
    [TimeFrame.H1]: 15 * 60 * 1000,   // 15分钟
    [TimeFrame.H4]: 45 * 60 * 1000,   // 45分钟
    [TimeFrame.D1]: 4 * 60 * 60 * 1000, // 4小时
    [TimeFrame.W1]: 18 * 60 * 60 * 1000, // 18小时
    [TimeFrame.MN1]: 4 * 24 * 60 * 60 * 1000 // 4天
  },

  // 综合信号TTL - 最短缓存时间以保持决策实时性
  [CacheType.COMPOSITE]: {
    [TimeFrame.M1]: 15 * 1000,        // 15秒
    [TimeFrame.M5]: 45 * 1000,        // 45秒
    [TimeFrame.M15]: 3 * 60 * 1000,   // 3分钟
    [TimeFrame.M30]: 5 * 60 * 1000,   // 5分钟
    [TimeFrame.H1]: 8 * 60 * 1000,    // 8分钟
    [TimeFrame.H4]: 20 * 60 * 1000,   // 20分钟
    [TimeFrame.D1]: 2 * 60 * 60 * 1000, // 2小时
    [TimeFrame.W1]: 8 * 60 * 60 * 1000, // 8小时
    [TimeFrame.MN1]: 2 * 24 * 60 * 60 * 1000 // 2天
  }
};

/**
 * 预定义缓存策略配置
 */
export const CACHE_STRATEGIES: { [key in CacheType]: CacheStrategyConfig } = {
  [CacheType.OHLCV]: {
    type: CacheType.OHLCV,
    ttlByTimeframe: OPTIMIZED_TTL_CONFIG[CacheType.OHLCV],
    maxSize: 5000,          // K线数据量大，限制数量
    enableLRU: true,
    memoryLimitMB: 100      // 100MB内存限制
  },

  [CacheType.INDICATOR]: {
    type: CacheType.INDICATOR,
    ttlByTimeframe: OPTIMIZED_TTL_CONFIG[CacheType.INDICATOR],
    maxSize: 10000,         // 指标计算结果相对较小
    enableLRU: true,
    memoryLimitMB: 200      // 200MB内存限制
  },

  [CacheType.SIGNAL]: {
    type: CacheType.SIGNAL,
    ttlByTimeframe: OPTIMIZED_TTL_CONFIG[CacheType.SIGNAL],
    maxSize: 8000,
    enableLRU: true,
    memoryLimitMB: 80       // 80MB内存限制
  },

  [CacheType.COMPOSITE]: {
    type: CacheType.COMPOSITE,
    ttlByTimeframe: OPTIMIZED_TTL_CONFIG[CacheType.COMPOSITE],
    maxSize: 3000,          // 综合信号数据量最小
    enableLRU: true,
    memoryLimitMB: 50       // 50MB内存限制
  }
};

/**
 * 全局缓存配置
 */
export const GLOBAL_CACHE_CONFIG: GlobalCacheConfig = {
  defaultTTL: 5 * 60 * 1000,         // 5分钟默认TTL
  cleanupInterval: 2 * 60 * 1000,    // 2分钟清理一次(优化频率)
  enableStats: true,
  enablePredictiveCaching: true,

  // 热门交易对配置(基于交易量和关注度)
  popularSymbols: [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
    'MATICUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT'
  ],

  // 优先时间框架(基于用户使用频率)
  preferredTimeframes: [
    TimeFrame.M15, TimeFrame.H1, TimeFrame.H4, TimeFrame.D1, TimeFrame.M5
  ],

  totalMemoryLimitMB: 500             // 总内存限制500MB
};

/**
 * 缓存配置管理器
 */
export class CacheConfigManager {
  /**
   * 获取指定缓存类型的TTL配置
   */
  static getTTLConfig(cacheType: CacheType): { [timeframe in TimeFrame]: number } {
    return CACHE_STRATEGIES[cacheType].ttlByTimeframe;
  }

  /**
   * 获取指定缓存类型和时间框架的TTL
   */
  static getTTL(cacheType: CacheType, timeframe: TimeFrame): number {
    return CACHE_STRATEGIES[cacheType].ttlByTimeframe[timeframe];
  }

  /**
   * 获取缓存策略配置
   */
  static getStrategy(cacheType: CacheType): CacheStrategyConfig {
    return CACHE_STRATEGIES[cacheType];
  }

  /**
   * 获取全局缓存配置
   */
  static getGlobalConfig(): GlobalCacheConfig {
    return GLOBAL_CACHE_CONFIG;
  }

  /**
   * 计算内存使用优先级
   * 基于时间框架和缓存类型计算优先级
   */
  static getMemoryPriority(cacheType: CacheType, timeframe: TimeFrame): number {
    const typeWeight = {
      [CacheType.COMPOSITE]: 4,    // 最高优先级
      [CacheType.SIGNAL]: 3,
      [CacheType.INDICATOR]: 2,
      [CacheType.OHLCV]: 1         // 最低优先级
    };

    const timeframeWeight = {
      [TimeFrame.M1]: 1,
      [TimeFrame.M5]: 2,
      [TimeFrame.M15]: 4,          // 高优先级
      [TimeFrame.M30]: 3,
      [TimeFrame.H1]: 5,           // 最高优先级
      [TimeFrame.H4]: 4,
      [TimeFrame.D1]: 3,
      [TimeFrame.W1]: 2,
      [TimeFrame.MN1]: 1
    };

    return typeWeight[cacheType] * timeframeWeight[timeframe];
  }

  /**
   * 是否应该预缓存指定符号和时间框架
   */
  static shouldPreCache(symbol: string, timeframe: TimeFrame): boolean {
    const isPopularSymbol = GLOBAL_CACHE_CONFIG.popularSymbols.includes(symbol.toUpperCase());
    const isPreferredTimeframe = GLOBAL_CACHE_CONFIG.preferredTimeframes.includes(timeframe);

    return GLOBAL_CACHE_CONFIG.enablePredictiveCaching &&
           isPopularSymbol &&
           isPreferredTimeframe;
  }

  /**
   * 获取批处理建议大小
   * 基于缓存类型和系统负载返回最优批处理大小
   */
  static getBatchSize(cacheType: CacheType): number {
    const batchSizes = {
      [CacheType.OHLCV]: 5,        // K线数据较大，小批次
      [CacheType.INDICATOR]: 10,    // 指标计算中等批次
      [CacheType.SIGNAL]: 15,      // 信号分析大批次
      [CacheType.COMPOSITE]: 8     // 综合信号中等批次
    };

    return batchSizes[cacheType];
  }
}