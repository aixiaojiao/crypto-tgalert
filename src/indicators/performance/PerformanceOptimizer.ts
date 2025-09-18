/**
 * 技术指标性能优化器
 * Performance Optimizer for Technical Indicators System
 */

import { TimeFrame } from '../types';
import { CacheType, GLOBAL_CACHE_CONFIG } from '../config/CacheConfig';
import { log } from '../../utils/logger';

/**
 * 性能指标接口
 */
export interface PerformanceMetrics {
  // 缓存性能
  cacheHitRate: number;           // 缓存命中率
  averageResponseTime: number;    // 平均响应时间(ms)
  memoryUsage: number;           // 内存使用量(MB)

  // 计算性能
  calculationsPerSecond: number;  // 每秒计算次数
  batchProcessingEfficiency: number; // 批处理效率

  // 系统性能
  cpuUsage?: number;             // CPU使用率
  errorRate: number;             // 错误率
}

/**
 * 使用统计接口
 */
export interface UsageStats {
  symbol: string;
  timeframe: TimeFrame;
  cacheType: CacheType;
  accessCount: number;
  lastAccessed: number;
  hitCount: number;
  missCount: number;
  averageCalculationTime: number;
}

/**
 * 优化建议接口
 */
export interface OptimizationRecommendation {
  type: 'cache_ttl' | 'batch_size' | 'memory_limit' | 'pre_cache';
  priority: 'high' | 'medium' | 'low';
  description: string;
  currentValue: number;
  recommendedValue: number;
  estimatedImprovement: string;
}

/**
 * 性能优化器类
 */
export class PerformanceOptimizer {
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private usageStats: Map<string, UsageStats> = new Map();
  private optimizationHistory: OptimizationRecommendation[] = [];

  private monitoringInterval: NodeJS.Timeout | undefined = undefined;

  constructor() {
    this.initializeMonitoring();
  }

  /**
   * 初始化性能监控
   */
  private initializeMonitoring(): void {
    log.info('🚀 Initializing Performance Optimizer');

    // 每30秒收集一次性能指标
    this.monitoringInterval = setInterval(() => {
      this.collectPerformanceMetrics();
      this.generateOptimizationRecommendations();
    }, 30 * 1000);
  }

  /**
   * 停止性能监控
   */
  public stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    log.info('🛑 Performance monitoring stopped');
  }

  /**
   * 记录缓存访问
   */
  public recordCacheAccess(
    symbol: string,
    timeframe: TimeFrame,
    cacheType: CacheType,
    isHit: boolean,
    responseTime: number
  ): void {
    const key = this.getStatsKey(symbol, timeframe, cacheType);

    let stats = this.usageStats.get(key);
    if (!stats) {
      stats = {
        symbol,
        timeframe,
        cacheType,
        accessCount: 0,
        lastAccessed: Date.now(),
        hitCount: 0,
        missCount: 0,
        averageCalculationTime: 0
      };
      this.usageStats.set(key, stats);
    }

    // 更新统计
    stats.accessCount++;
    stats.lastAccessed = Date.now();

    if (isHit) {
      stats.hitCount++;
    } else {
      stats.missCount++;
    }

    // 更新平均计算时间(指数移动平均)
    if (stats.averageCalculationTime === 0) {
      stats.averageCalculationTime = responseTime;
    } else {
      const alpha = 0.1; // 平滑因子
      stats.averageCalculationTime =
        alpha * responseTime + (1 - alpha) * stats.averageCalculationTime;
    }
  }

  /**
   * 收集性能指标
   */
  private collectPerformanceMetrics(): void {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1分钟窗口

    // 计算各种性能指标
    let totalAccess = 0;
    let totalHits = 0;
    let totalResponseTime = 0;
    let accessCount = 0;

    for (const stats of this.usageStats.values()) {
      if (now - stats.lastAccessed <= windowMs) {
        totalAccess += stats.accessCount;
        totalHits += stats.hitCount;
        totalResponseTime += stats.averageCalculationTime;
        accessCount++;
      }
    }

    const metrics: PerformanceMetrics = {
      cacheHitRate: totalAccess > 0 ? (totalHits / totalAccess) * 100 : 0,
      averageResponseTime: accessCount > 0 ? totalResponseTime / accessCount : 0,
      memoryUsage: this.estimateMemoryUsage(),
      calculationsPerSecond: totalAccess / (windowMs / 1000),
      batchProcessingEfficiency: this.calculateBatchEfficiency(),
      errorRate: 0 // TODO: 实现错误率统计
    };

    this.metrics.set(now.toString(), metrics);

    // 只保留最近1小时的指标
    const oneHourAgo = now - 60 * 60 * 1000;
    for (const [timestamp] of this.metrics) {
      if (parseInt(timestamp) < oneHourAgo) {
        this.metrics.delete(timestamp);
      }
    }
  }

  /**
   * 估算内存使用量
   */
  private estimateMemoryUsage(): number {
    // 简单的内存使用估算
    // 实际实现中应该使用更精确的方法
    let estimatedMB = 0;

    for (const stats of this.usageStats.values()) {
      // 基于缓存类型估算内存使用
      const baseSize = {
        [CacheType.OHLCV]: 2,      // 2KB per entry
        [CacheType.INDICATOR]: 1,   // 1KB per entry
        [CacheType.SIGNAL]: 0.5,   // 0.5KB per entry
        [CacheType.COMPOSITE]: 0.3 // 0.3KB per entry
      };

      estimatedMB += (baseSize[stats.cacheType] * stats.accessCount) / 1024;
    }

    return estimatedMB;
  }

  /**
   * 计算批处理效率
   */
  private calculateBatchEfficiency(): number {
    // 批处理效率 = 平均每批次处理数量 / 理论最优批次大小
    // 这是一个简化的计算，实际实现需要跟踪批处理统计

    const avgBatchSize = 5; // 假设当前平均批次大小
    const optimalBatchSize = 10; // 理论最优批次大小

    return (avgBatchSize / optimalBatchSize) * 100;
  }

  /**
   * 生成优化建议
   */
  private generateOptimizationRecommendations(): void {
    const recommendations: OptimizationRecommendation[] = [];

    // 分析缓存命中率
    const latestMetrics = this.getLatestMetrics();
    if (latestMetrics && latestMetrics.cacheHitRate < 80) {
      recommendations.push({
        type: 'cache_ttl',
        priority: 'high',
        description: '缓存命中率低，建议增加TTL时间',
        currentValue: latestMetrics.cacheHitRate,
        recommendedValue: 85,
        estimatedImprovement: '提升响应速度15-20%'
      });
    }

    // 分析内存使用
    if (latestMetrics && latestMetrics.memoryUsage > 400) { // 80% of 500MB limit
      recommendations.push({
        type: 'memory_limit',
        priority: 'medium',
        description: '内存使用过高，建议清理冷数据',
        currentValue: latestMetrics.memoryUsage,
        recommendedValue: 350,
        estimatedImprovement: '释放内存50MB+'
      });
    }

    // 分析批处理效率
    if (latestMetrics && latestMetrics.batchProcessingEfficiency < 70) {
      recommendations.push({
        type: 'batch_size',
        priority: 'medium',
        description: '批处理效率低，建议增加批次大小',
        currentValue: latestMetrics.batchProcessingEfficiency,
        recommendedValue: 85,
        estimatedImprovement: '提升处理吞吐量20-30%'
      });
    }

    // 分析预缓存机会
    const hotSymbols = this.getHotSymbols();
    if (hotSymbols.length > 0) {
      recommendations.push({
        type: 'pre_cache',
        priority: 'low',
        description: `发现${hotSymbols.length}个热门交易对，建议启用预缓存`,
        currentValue: 0,
        recommendedValue: hotSymbols.length,
        estimatedImprovement: '减少延迟30-40%'
      });
    }

    // 记录建议历史
    recommendations.forEach(rec => {
      this.optimizationHistory.push({
        ...rec,
        // 添加时间戳到描述中
        description: `[${new Date().toISOString()}] ${rec.description}`
      });
    });

    // 只保留最近100条建议
    if (this.optimizationHistory.length > 100) {
      this.optimizationHistory.splice(0, this.optimizationHistory.length - 100);
    }

    if (recommendations.length > 0) {
      log.info(`📊 Generated ${recommendations.length} optimization recommendations`, {
        recommendations: recommendations.map(r => ({
          type: r.type,
          priority: r.priority,
          improvement: r.estimatedImprovement
        }))
      });
    }
  }

  /**
   * 获取热门交易对
   */
  private getHotSymbols(): string[] {
    const symbolAccessCount = new Map<string, number>();

    for (const stats of this.usageStats.values()) {
      const current = symbolAccessCount.get(stats.symbol) || 0;
      symbolAccessCount.set(stats.symbol, current + stats.accessCount);
    }

    // 返回访问次数前5的交易对
    return Array.from(symbolAccessCount.entries())
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([symbol]) => symbol)
      .filter(symbol => !GLOBAL_CACHE_CONFIG.popularSymbols.includes(symbol));
  }

  /**
   * 获取最新性能指标
   */
  public getLatestMetrics(): PerformanceMetrics | null {
    if (this.metrics.size === 0) return null;

    const timestamps = Array.from(this.metrics.keys()).sort((a, b) => parseInt(b) - parseInt(a));
    return this.metrics.get(timestamps[0]) || null;
  }

  /**
   * 获取性能报告
   */
  public getPerformanceReport(): {
    currentMetrics: PerformanceMetrics | null;
    recommendations: OptimizationRecommendation[];
    topUsage: UsageStats[];
  } {
    // 获取使用频率最高的缓存项
    const topUsage = Array.from(this.usageStats.values())
      .sort((a, b) => b.accessCount - a.accessCount)
      .slice(0, 10);

    return {
      currentMetrics: this.getLatestMetrics(),
      recommendations: this.optimizationHistory.slice(-10), // 最近10条建议
      topUsage
    };
  }

  /**
   * 应用优化建议
   */
  public async applyOptimization(recommendation: OptimizationRecommendation): Promise<boolean> {
    log.info('🔧 Applying optimization recommendation', {
      type: recommendation.type,
      description: recommendation.description
    });

    try {
      switch (recommendation.type) {
        case 'cache_ttl':
          // TODO: 实现动态调整TTL
          log.info('📝 TTL optimization applied (placeholder)');
          break;

        case 'batch_size':
          // TODO: 实现动态调整批处理大小
          log.info('📝 Batch size optimization applied (placeholder)');
          break;

        case 'memory_limit':
          // TODO: 实现内存清理
          log.info('📝 Memory optimization applied (placeholder)');
          break;

        case 'pre_cache':
          // TODO: 实现预缓存
          log.info('📝 Pre-caching optimization applied (placeholder)');
          break;
      }

      return true;
    } catch (error) {
      log.error('❌ Failed to apply optimization', { error, recommendation });
      return false;
    }
  }

  /**
   * 生成统计键
   */
  private getStatsKey(symbol: string, timeframe: TimeFrame, cacheType: CacheType): string {
    return `${cacheType}:${symbol}:${timeframe}`;
  }

  /**
   * 清理旧统计数据
   */
  public cleanupOldStats(): void {
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24小时前

    for (const [key, stats] of this.usageStats) {
      if (stats.lastAccessed < cutoffTime) {
        this.usageStats.delete(key);
      }
    }

    log.debug('🧹 Cleaned up old performance statistics', {
      remainingStats: this.usageStats.size
    });
  }

  /**
   * 销毁优化器
   */
  public destroy(): void {
    this.stopMonitoring();
    this.metrics.clear();
    this.usageStats.clear();
    this.optimizationHistory.length = 0;

    log.info('🗑️ Performance Optimizer destroyed');
  }
}