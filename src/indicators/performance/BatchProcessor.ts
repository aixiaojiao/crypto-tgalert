/**
 * 批处理器 - 优化多指标并行计算
 * Batch Processor for Optimized Multi-Indicator Parallel Computing
 */

import { OHLCV, IndicatorResult, SignalResult, CompositeSignal, TimeFrame, IndicatorParams } from '../types';
import { PerformanceOptimizer } from './PerformanceOptimizer';
import { log } from '../../utils/logger';

/**
 * 批处理任务接口
 */
export interface BatchTask {
  id: string;
  type: 'indicator' | 'signal' | 'composite';
  symbol: string;
  timeframe: TimeFrame;
  indicatorName?: string;
  params?: IndicatorParams;
  data?: OHLCV[];
  priority: 'high' | 'medium' | 'low';
  createdAt: number;
}

/**
 * 批处理结果接口
 */
export interface BatchResult {
  taskId: string;
  success: boolean;
  result?: IndicatorResult | SignalResult | CompositeSignal;
  error?: string;
  executionTime: number;
  cacheHit: boolean;
}

/**
 * 批处理统计接口
 */
export interface BatchStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageExecutionTime: number;
  cacheHitRate: number;
  throughputPerSecond: number;
  queueSize: number;
}

/**
 * 批处理队列配置
 */
interface BatchQueueConfig {
  maxBatchSize: number;
  maxWaitTime: number;        // 最大等待时间(ms)
  maxConcurrentBatches: number;
  priorityWeights: { high: number; medium: number; low: number };
}

/**
 * 高性能批处理器
 */
export class BatchProcessor {
  private taskQueue: BatchTask[] = [];
  private processingBatches = new Set<string>();
  private completedResults = new Map<string, BatchResult>();

  private stats: BatchStats = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    averageExecutionTime: 0,
    cacheHitRate: 0,
    throughputPerSecond: 0,
    queueSize: 0
  };

  private config: BatchQueueConfig = {
    maxBatchSize: 20,           // 最大批次大小
    maxWaitTime: 100,           // 100ms最大等待
    maxConcurrentBatches: 3,    // 最多3个并发批次
    priorityWeights: { high: 10, medium: 5, low: 1 }
  };

  private processingTimer: NodeJS.Timeout | undefined = undefined;
  private performanceOptimizer: PerformanceOptimizer | undefined = undefined;
  private processingStartTime = 0;

  constructor(performanceOptimizer?: PerformanceOptimizer) {
    this.performanceOptimizer = performanceOptimizer;
    this.startProcessingLoop();
  }

  /**
   * 添加任务到批处理队列
   */
  public addTask(task: Omit<BatchTask, 'id' | 'createdAt'>): string {
    const batchTask: BatchTask = {
      ...task,
      id: this.generateTaskId(),
      createdAt: Date.now()
    };

    // 插入到合适的位置(按优先级排序)
    this.insertTaskByPriority(batchTask);

    this.stats.totalTasks++;
    this.stats.queueSize = this.taskQueue.length;

    log.debug('📝 Task added to batch queue', {
      taskId: batchTask.id,
      type: batchTask.type,
      symbol: batchTask.symbol,
      priority: batchTask.priority,
      queueSize: this.taskQueue.length
    });

    return batchTask.id;
  }

  /**
   * 批量添加任务
   */
  public addTasks(tasks: Array<Omit<BatchTask, 'id' | 'createdAt'>>): string[] {
    const taskIds = tasks.map(task => this.addTask(task));

    log.info('📋 Batch tasks added', {
      count: tasks.length,
      taskIds: taskIds.slice(0, 5), // 只显示前5个ID
      queueSize: this.taskQueue.length
    });

    return taskIds;
  }

  /**
   * 获取任务结果
   */
  public getResult(taskId: string): BatchResult | null {
    return this.completedResults.get(taskId) || null;
  }

  /**
   * 等待任务完成
   */
  public async waitForResult(taskId: string, timeoutMs: number = 10000): Promise<BatchResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = this.completedResults.get(taskId);
      if (result) {
        return result;
      }

      // 等待50ms再检查
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
  }

  /**
   * 批量等待结果
   */
  public async waitForResults(taskIds: string[], timeoutMs: number = 10000): Promise<BatchResult[]> {
    const results = await Promise.allSettled(
      taskIds.map(id => this.waitForResult(id, timeoutMs))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          taskId: taskIds[index],
          success: false,
          error: result.reason.message,
          executionTime: 0,
          cacheHit: false
        };
      }
    });
  }

  /**
   * 开始处理循环
   */
  private startProcessingLoop(): void {
    this.processingTimer = setInterval(() => {
      this.processBatches();
    }, 50); // 每50ms检查一次

    this.processingStartTime = Date.now();

    log.info('🚀 Batch processor started');
  }

  /**
   * 停止处理循环
   */
  public stop(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = undefined;
    }

    log.info('🛑 Batch processor stopped');
  }

  /**
   * 处理批次
   */
  private async processBatches(): Promise<void> {
    // 检查是否可以创建新批次
    if (this.processingBatches.size >= this.config.maxConcurrentBatches) {
      return;
    }

    // 检查是否有足够的任务或等待时间过长
    const shouldProcess = this.shouldCreateBatch();
    if (!shouldProcess || this.taskQueue.length === 0) {
      return;
    }

    // 创建批次
    const batch = this.createBatch();
    if (batch.length === 0) return;

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.processingBatches.add(batchId);

    // 异步处理批次
    this.executeBatch(batchId, batch).finally(() => {
      this.processingBatches.delete(batchId);
    });
  }

  /**
   * 检查是否应该创建批次
   */
  private shouldCreateBatch(): boolean {
    if (this.taskQueue.length === 0) return false;

    // 达到最大批次大小
    if (this.taskQueue.length >= this.config.maxBatchSize) {
      return true;
    }

    // 最老的任务等待时间过长
    const oldestTask = this.taskQueue[0];
    const waitTime = Date.now() - oldestTask.createdAt;
    if (waitTime >= this.config.maxWaitTime) {
      return true;
    }

    // 高优先级任务立即处理
    if (oldestTask.priority === 'high') {
      return true;
    }

    return false;
  }

  /**
   * 创建批次
   */
  private createBatch(): BatchTask[] {
    const batchSize = Math.min(this.config.maxBatchSize, this.taskQueue.length);
    const batch = this.taskQueue.splice(0, batchSize);

    this.stats.queueSize = this.taskQueue.length;

    log.debug('📦 Created batch', {
      batchSize: batch.length,
      remainingQueue: this.taskQueue.length
    });

    return batch;
  }

  /**
   * 执行批次
   */
  private async executeBatch(batchId: string, tasks: BatchTask[]): Promise<void> {
    const startTime = Date.now();

    log.debug('⚡ Executing batch', {
      batchId,
      taskCount: tasks.length,
      types: this.groupTasksByType(tasks)
    });

    try {
      // 按类型分组并行处理
      const groupedTasks = this.groupAndOptimizeTasks(tasks);
      const batchPromises: Promise<BatchResult[]>[] = [];

      // OHLCV数据任务 - 可以共享数据获取
      if (groupedTasks.ohlcv.length > 0) {
        batchPromises.push(this.processOHLCVTasks(groupedTasks.ohlcv));
      }

      // 指标计算任务 - 可以复用OHLCV数据
      if (groupedTasks.indicator.length > 0) {
        batchPromises.push(this.processIndicatorTasks(groupedTasks.indicator));
      }

      // 信号分析任务 - 可以复用指标结果
      if (groupedTasks.signal.length > 0) {
        batchPromises.push(this.processSignalTasks(groupedTasks.signal));
      }

      // 综合信号任务 - 需要多个信号结果
      if (groupedTasks.composite.length > 0) {
        batchPromises.push(this.processCompositeTasks(groupedTasks.composite));
      }

      // 等待所有任务完成
      const results = await Promise.allSettled(batchPromises);

      // 合并所有结果
      const allResults: BatchResult[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
        }
      });

      // 存储结果
      allResults.forEach(result => {
        this.completedResults.set(result.taskId, result);

        if (result.success) {
          this.stats.completedTasks++;
        } else {
          this.stats.failedTasks++;
        }
      });

      const executionTime = Date.now() - startTime;

      // 更新统计信息
      this.updateStats(allResults, executionTime);

      log.info('✅ Batch completed', {
        batchId,
        taskCount: tasks.length,
        executionTime,
        successCount: allResults.filter(r => r.success).length,
        failureCount: allResults.filter(r => !r.success).length
      });

    } catch (error) {
      log.error('❌ Batch execution failed', { batchId, error });

      // 标记所有任务为失败
      tasks.forEach(task => {
        this.completedResults.set(task.id, {
          taskId: task.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          executionTime: Date.now() - startTime,
          cacheHit: false
        });
        this.stats.failedTasks++;
      });
    }
  }

  /**
   * 分组和优化任务
   */
  private groupAndOptimizeTasks(tasks: BatchTask[]): {
    ohlcv: BatchTask[];
    indicator: BatchTask[];
    signal: BatchTask[];
    composite: BatchTask[];
  } {
    const groups = {
      ohlcv: [] as BatchTask[],
      indicator: [] as BatchTask[],
      signal: [] as BatchTask[],
      composite: [] as BatchTask[]
    };

    tasks.forEach(task => {
      switch (task.type) {
        case 'indicator':
          groups.indicator.push(task);
          break;
        case 'signal':
          groups.signal.push(task);
          break;
        case 'composite':
          groups.composite.push(task);
          break;
        default:
          groups.ohlcv.push(task);
      }
    });

    return groups;
  }

  /**
   * 处理OHLCV数据任务(模拟)
   */
  private async processOHLCVTasks(tasks: BatchTask[]): Promise<BatchResult[]> {
    // TODO: 实现实际的OHLCV数据获取批处理
    return tasks.map(task => ({
      taskId: task.id,
      success: true,
      // result will be added when actual implementation is done
      executionTime: 50 + Math.random() * 100,
      cacheHit: Math.random() > 0.3 // 70% 缓存命中率
    }));
  }

  /**
   * 处理指标计算任务(模拟)
   */
  private async processIndicatorTasks(tasks: BatchTask[]): Promise<BatchResult[]> {
    // TODO: 实现实际的指标计算批处理
    return tasks.map(task => ({
      taskId: task.id,
      success: Math.random() > 0.05, // 95% 成功率
      // result will be added when actual implementation is done
      executionTime: 30 + Math.random() * 80,
      cacheHit: Math.random() > 0.4 // 60% 缓存命中率
    }));
  }

  /**
   * 处理信号分析任务(模拟)
   */
  private async processSignalTasks(tasks: BatchTask[]): Promise<BatchResult[]> {
    // TODO: 实现实际的信号分析批处理
    return tasks.map(task => ({
      taskId: task.id,
      success: Math.random() > 0.03, // 97% 成功率
      // result will be added when actual implementation is done
      executionTime: 20 + Math.random() * 60,
      cacheHit: Math.random() > 0.5 // 50% 缓存命中率
    }));
  }

  /**
   * 处理综合信号任务(模拟)
   */
  private async processCompositeTasks(tasks: BatchTask[]): Promise<BatchResult[]> {
    // TODO: 实现实际的综合信号分析批处理
    return tasks.map(task => ({
      taskId: task.id,
      success: Math.random() > 0.02, // 98% 成功率
      // result will be added when actual implementation is done
      executionTime: 40 + Math.random() * 120,
      cacheHit: Math.random() > 0.6 // 40% 缓存命中率
    }));
  }

  /**
   * 按优先级插入任务
   */
  private insertTaskByPriority(task: BatchTask): void {
    const priority = this.config.priorityWeights[task.priority];

    let insertIndex = this.taskQueue.length;
    for (let i = 0; i < this.taskQueue.length; i++) {
      const existingPriority = this.config.priorityWeights[this.taskQueue[i].priority];
      if (priority > existingPriority) {
        insertIndex = i;
        break;
      }
    }

    this.taskQueue.splice(insertIndex, 0, task);
  }

  /**
   * 按类型分组任务
   */
  private groupTasksByType(tasks: BatchTask[]): { [type: string]: number } {
    const groups: { [type: string]: number } = {};
    tasks.forEach(task => {
      groups[task.type] = (groups[task.type] || 0) + 1;
    });
    return groups;
  }

  /**
   * 更新统计信息
   */
  private updateStats(results: BatchResult[], executionTime: number): void {
    // 更新平均执行时间
    const totalTime = this.stats.averageExecutionTime * this.stats.completedTasks + executionTime;
    this.stats.averageExecutionTime = totalTime / (this.stats.completedTasks + this.stats.failedTasks + 1);

    // 更新缓存命中率
    const cacheHits = results.filter(r => r.cacheHit).length;
    const newHitRate = results.length > 0 ? (cacheHits / results.length) * 100 : 0;

    if (this.stats.cacheHitRate === 0) {
      this.stats.cacheHitRate = newHitRate;
    } else {
      // 指数移动平均
      this.stats.cacheHitRate = 0.9 * this.stats.cacheHitRate + 0.1 * newHitRate;
    }

    // 计算吞吐量
    const runningTime = (Date.now() - this.processingStartTime) / 1000;
    this.stats.throughputPerSecond = (this.stats.completedTasks + this.stats.failedTasks) / runningTime;

    // 记录性能数据到优化器
    if (this.performanceOptimizer) {
      results.forEach(_result => {
        // 模拟记录缓存访问(实际实现中应该从具体任务中获取信息)
        // TODO: 从实际任务结果中提取缓存信息
      });
    }
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取统计信息
   */
  public getStats(): BatchStats {
    return { ...this.stats };
  }

  /**
   * 获取队列状态
   */
  public getQueueStatus(): {
    queueSize: number;
    processingBatches: number;
    completedResults: number;
    oldestTaskWaitTime: number;
  } {
    const oldestTask = this.taskQueue[0];
    const oldestTaskWaitTime = oldestTask ? Date.now() - oldestTask.createdAt : 0;

    return {
      queueSize: this.taskQueue.length,
      processingBatches: this.processingBatches.size,
      completedResults: this.completedResults.size,
      oldestTaskWaitTime
    };
  }

  /**
   * 清理已完成的结果
   */
  public cleanupCompletedResults(olderThanMs: number = 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    let cleanedCount = 0;

    for (const [taskId, _result] of this.completedResults) {
      // 假设结果有创建时间，实际实现中需要添加timestamp字段
      if (Date.now() - olderThanMs > cutoff) {
        this.completedResults.delete(taskId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.debug('🧹 Cleaned up completed results', { cleanedCount, remaining: this.completedResults.size });
    }
  }

  /**
   * 销毁批处理器
   */
  public destroy(): void {
    this.stop();
    this.taskQueue.length = 0;
    this.processingBatches.clear();
    this.completedResults.clear();

    log.info('🗑️ Batch Processor destroyed');
  }
}