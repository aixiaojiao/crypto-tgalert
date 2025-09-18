import { log } from './logger';

/**
 * 业务监控服务
 * 专门监控关键业务操作，用于跟踪问题直到复现
 */

export interface BusinessMetrics {
  operationType: string;
  timestamp: Date;
  userId?: string;
  symbol?: string;
  duration?: number;
  success: boolean;
  error?: string | undefined;
  details?: any;
}

export interface OperationTracker {
  startTime: number;
  operationType: string;
  context: any;
}

export class BusinessMonitor {
  private static instance: BusinessMonitor;
  private operations: Map<string, OperationTracker> = new Map();
  private metrics: BusinessMetrics[] = [];
  private readonly MAX_METRICS = 1000; // 保留最近1000条记录

  static getInstance(): BusinessMonitor {
    if (!BusinessMonitor.instance) {
      BusinessMonitor.instance = new BusinessMonitor();
    }
    return BusinessMonitor.instance;
  }

  /**
   * 开始跟踪操作
   */
  startOperation(operationId: string, operationType: string, context: any = {}): void {
    this.operations.set(operationId, {
      startTime: Date.now(),
      operationType,
      context
    });

    log.debug('🔍 业务监控: 开始跟踪操作', {
      operationId,
      operationType,
      context
    });
  }

  /**
   * 结束操作跟踪
   */
  endOperation(operationId: string, success: boolean, error?: string, details?: any): void {
    const operation = this.operations.get(operationId);
    if (!operation) {
      log.warn('⚠️ 业务监控: 未找到操作跟踪记录', { operationId });
      return;
    }

    const duration = Date.now() - operation.startTime;
    const metric: BusinessMetrics = {
      operationType: operation.operationType,
      timestamp: new Date(),
      duration,
      success,
      details: { ...operation.context, ...details }
    };

    if (error) {
      metric.error = error;
    }

    // 添加用户和符号信息（如果存在）
    if (operation.context.userId) metric.userId = operation.context.userId;
    if (operation.context.symbol) metric.symbol = operation.context.symbol;

    this.addMetric(metric);
    this.operations.delete(operationId);

    const logLevel = success ? 'info' : 'error';
    const status = success ? '✅' : '❌';

    log[logLevel](`${status} 业务监控: 操作完成`, {
      operationId,
      operationType: operation.operationType,
      duration,
      success,
      error,
      context: operation.context
    });
  }

  /**
   * 直接记录业务操作（不需要跟踪持续时间的操作）
   */
  recordOperation(operationType: string, success: boolean, context: any = {}, error?: string): void {
    const metric: BusinessMetrics = {
      operationType,
      timestamp: new Date(),
      success,
      details: context
    };

    if (error) {
      metric.error = error;
    }

    if (context.userId) metric.userId = context.userId;
    if (context.symbol) metric.symbol = context.symbol;

    this.addMetric(metric);

    const logLevel = success ? 'info' : 'error';
    const status = success ? '✅' : '❌';

    log[logLevel](`${status} 业务监控: ${operationType}`, {
      success,
      error,
      context
    });
  }

  /**
   * 添加指标并维护最大数量限制
   */
  private addMetric(metric: BusinessMetrics): void {
    this.metrics.push(metric);

    // 如果超过最大数量，删除最旧的记录
    if (this.metrics.length > this.MAX_METRICS) {
      this.metrics.splice(0, this.metrics.length - this.MAX_METRICS);
    }
  }

  /**
   * 获取操作统计
   */
  getOperationStats(operationType?: string, timeRangeMs: number = 3600000): any {
    const now = Date.now();
    const cutoff = new Date(now - timeRangeMs);

    let filteredMetrics = this.metrics.filter(m => m.timestamp > cutoff);
    if (operationType) {
      filteredMetrics = filteredMetrics.filter(m => m.operationType === operationType);
    }

    const total = filteredMetrics.length;
    const successful = filteredMetrics.filter(m => m.success).length;
    const failed = total - successful;
    const successRate = total > 0 ? (successful / total * 100).toFixed(2) : '0';

    const avgDuration = filteredMetrics
      .filter(m => m.duration !== undefined)
      .reduce((sum, m) => sum + (m.duration || 0), 0) / total || 0;

    return {
      operationType: operationType || 'ALL',
      timeRange: `${timeRangeMs / 1000}s`,
      total,
      successful,
      failed,
      successRate: `${successRate}%`,
      avgDuration: Math.round(avgDuration),
      recentErrors: filteredMetrics
        .filter(m => !m.success)
        .slice(-5)
        .map(m => ({ error: m.error, timestamp: m.timestamp, details: m.details }))
    };
  }

  /**
   * 获取所有操作类型的统计
   */
  getAllStats(timeRangeMs: number = 3600000): any {
    const operationTypes = [...new Set(this.metrics.map(m => m.operationType))];
    const stats: any = {};

    stats.summary = this.getOperationStats(undefined, timeRangeMs);
    stats.byOperation = {};

    operationTypes.forEach(type => {
      stats.byOperation[type] = this.getOperationStats(type, timeRangeMs);
    });

    return stats;
  }

  /**
   * 检查是否有持续的失败模式
   */
  detectFailurePatterns(timeRangeMs: number = 1800000): any[] {
    const now = Date.now();
    const cutoff = new Date(now - timeRangeMs);
    const recentMetrics = this.metrics.filter(m => m.timestamp > cutoff);

    const patterns: any[] = [];
    const operationTypes = [...new Set(recentMetrics.map(m => m.operationType))];

    operationTypes.forEach(type => {
      const typeMetrics = recentMetrics.filter(m => m.operationType === type);
      const failed = typeMetrics.filter(m => !m.success).length;
      const total = typeMetrics.length;

      if (total >= 5 && failed / total > 0.5) {
        patterns.push({
          operationType: type,
          failureRate: ((failed / total) * 100).toFixed(2) + '%',
          totalOperations: total,
          failedOperations: failed,
          recentErrors: typeMetrics
            .filter(m => !m.success)
            .slice(-3)
            .map(m => m.error)
        });
      }
    });

    return patterns;
  }

  /**
   * 清理旧的操作跟踪记录（防止内存泄漏）
   */
  cleanupStaleOperations(maxAgeMs: number = 300000): void {
    const now = Date.now();
    const staleOperations: string[] = [];

    this.operations.forEach((operation, operationId) => {
      if (now - operation.startTime > maxAgeMs) {
        staleOperations.push(operationId);
      }
    });

    staleOperations.forEach(operationId => {
      const operation = this.operations.get(operationId);
      if (operation) {
        log.warn('🧹 业务监控: 清理过期操作', {
          operationId,
          operationType: operation.operationType,
          staleDuration: now - operation.startTime
        });
        this.operations.delete(operationId);
      }
    });

    if (staleOperations.length > 0) {
      log.info('🧹 业务监控: 清理完成', {
        cleanedOperations: staleOperations.length,
        remainingOperations: this.operations.size
      });
    }
  }
}

// 导出单例实例
export const businessMonitor = BusinessMonitor.getInstance();

// 便捷函数
export function startBusinessOperation(operationType: string, context: any = {}): string {
  const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  businessMonitor.startOperation(operationId, operationType, context);
  return operationId;
}

export function endBusinessOperation(operationId: string, success: boolean, error?: string, details?: any): void {
  businessMonitor.endOperation(operationId, success, error, details);
}

export function recordBusinessOperation(operationType: string, success: boolean, context: any = {}, error?: string): void {
  businessMonitor.recordOperation(operationType, success, context, error);
}

// 定期清理过期操作（每5分钟）
setInterval(() => {
  businessMonitor.cleanupStaleOperations();
}, 5 * 60 * 1000);

// 定期报告业务统计（每30分钟）
setInterval(() => {
  const stats = businessMonitor.getAllStats(1800000); // 30分钟内的统计
  const patterns = businessMonitor.detectFailurePatterns(1800000);

  log.info('📊 业务监控: 定期报告', {
    summary: stats.summary,
    failurePatterns: patterns.length > 0 ? patterns : '无异常模式'
  });

  if (patterns.length > 0) {
    log.warn('⚠️ 业务监控: 检测到失败模式', { patterns });
  }
}, 30 * 60 * 1000);