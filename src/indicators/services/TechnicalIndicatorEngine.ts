import { injectable } from 'inversify';
import {
  ITechnicalIndicator,
  OHLCV,
  IndicatorResult,
  SignalResult,
  CompositeSignal,
  IndicatorParams,
  Signal,
  TimeFrame,
  IndicatorError,
  InsufficientDataError
} from '../types';
import { ILifecycleAware } from '../../core/Application';
import { log } from '../../utils/logger';

/**
 * 技术指标引擎接口
 */
export interface ITechnicalIndicatorEngine {
  /**
   * 注册技术指标
   */
  registerIndicator(indicator: ITechnicalIndicator): void;

  /**
   * 获取已注册的指标
   */
  getIndicator(name: string): ITechnicalIndicator | undefined;

  /**
   * 获取所有已注册的指标名称
   */
  getIndicatorNames(): string[];

  /**
   * 计算单个指标
   */
  calculateIndicator(
    indicatorName: string,
    data: OHLCV[],
    params?: IndicatorParams
  ): Promise<IndicatorResult>;

  /**
   * 获取单个指标信号
   */
  getIndicatorSignal(
    indicatorName: string,
    data: OHLCV[],
    params?: IndicatorParams
  ): Promise<SignalResult>;

  /**
   * 计算多个指标
   */
  calculateMultipleIndicators(
    indicatorNames: string[],
    data: OHLCV[],
    params?: { [indicatorName: string]: IndicatorParams }
  ): Promise<{ [indicatorName: string]: IndicatorResult }>;

  /**
   * 获取综合信号分析
   */
  getCompositeSignal(
    indicatorNames: string[],
    data: OHLCV[],
    symbolPair: string,
    timeframe: TimeFrame,
    params?: { [indicatorName: string]: IndicatorParams }
  ): Promise<CompositeSignal>;

  /**
   * 验证数据有效性
   */
  validateData(data: OHLCV[]): boolean;

  /**
   * 获取引擎统计信息
   */
  getEngineStats(): {
    registeredIndicators: number;
    calculationsPerformed: number;
    averageCalculationTime: number;
    errorCount: number;
  };
}

/**
 * 计算性能统计
 */
interface CalculationStats {
  totalCalculations: number;
  totalTime: number;
  errorCount: number;
  lastCalculationTime: number;
}

/**
 * 技术指标引擎核心服务
 * 管理所有技术指标的注册、计算和信号分析
 */
@injectable()
export class TechnicalIndicatorEngine implements ITechnicalIndicatorEngine, ILifecycleAware {
  private indicators = new Map<string, ITechnicalIndicator>();
  private stats: CalculationStats = {
    totalCalculations: 0,
    totalTime: 0,
    errorCount: 0,
    lastCalculationTime: 0
  };

  private isInitialized = false;

  /**
   * 初始化引擎
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      log.info('🔧 Initializing Technical Indicator Engine');

      // 初始化统计信息
      this.resetStats();

      this.isInitialized = true;
      log.info('✅ Technical Indicator Engine initialized successfully');

    } catch (error) {
      log.error('❌ Failed to initialize Technical Indicator Engine', error);
      throw error;
    }
  }

  /**
   * 启动引擎
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    log.info('🚀 Technical Indicator Engine started');
  }

  /**
   * 停止引擎
   */
  async stop(): Promise<void> {
    log.info('🛑 Stopping Technical Indicator Engine');

    // 清理资源
    this.indicators.clear();

    log.info('✅ Technical Indicator Engine stopped');
  }

  /**
   * 销毁引擎
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.resetStats();
    this.isInitialized = false;

    log.info('🗑️ Technical Indicator Engine destroyed');
  }

  /**
   * 注册技术指标
   */
  registerIndicator(indicator: ITechnicalIndicator): void {
    if (!indicator) {
      throw new Error('Indicator cannot be null or undefined');
    }

    if (!indicator.name) {
      throw new Error('Indicator must have a name');
    }

    if (this.indicators.has(indicator.name)) {
      log.warn(`⚠️ Indicator '${indicator.name}' is already registered, overwriting`);
    }

    this.indicators.set(indicator.name, indicator);
    log.debug(`📈 Registered indicator: ${indicator.name}`);
  }

  /**
   * 获取已注册的指标
   */
  getIndicator(name: string): ITechnicalIndicator | undefined {
    return this.indicators.get(name);
  }

  /**
   * 获取所有已注册的指标名称
   */
  getIndicatorNames(): string[] {
    return Array.from(this.indicators.keys());
  }

  /**
   * 计算单个指标
   */
  async calculateIndicator(
    indicatorName: string,
    data: OHLCV[],
    params?: IndicatorParams
  ): Promise<IndicatorResult> {
    const startTime = Date.now();

    try {
      // 验证输入
      this.validateInputs(indicatorName, data);

      const indicator = this.getIndicator(indicatorName);
      if (!indicator) {
        throw new IndicatorError(`Indicator '${indicatorName}' not found`, indicatorName);
      }

      // 验证参数
      if (params && !indicator.validateParams(params)) {
        throw new IndicatorError(`Invalid parameters for ${indicatorName}`, indicatorName, params);
      }

      // 执行计算
      const result = indicator.calculate(data, params);

      // 更新统计信息
      this.updateStats(startTime, false);

      log.debug(`📊 Calculated indicator: ${indicatorName}`, {
        dataPoints: data.length,
        resultValues: result.values.length,
        lastValue: result.metadata.lastValue
      });

      return result;

    } catch (error) {
      this.updateStats(startTime, true);

      if (error instanceof IndicatorError) {
        log.error(`❌ Indicator calculation failed: ${indicatorName}`, error);
        throw error;
      }

      log.error(`❌ Unexpected error calculating indicator: ${indicatorName}`, error);
      throw new IndicatorError(
        `Calculation failed: ${error instanceof Error ? error.message : String(error)}`,
        indicatorName,
        params,
        data
      );
    }
  }

  /**
   * 获取单个指标信号
   */
  async getIndicatorSignal(
    indicatorName: string,
    data: OHLCV[],
    params?: IndicatorParams
  ): Promise<SignalResult> {
    try {
      // 先计算指标值
      const result = await this.calculateIndicator(indicatorName, data, params);

      const indicator = this.getIndicator(indicatorName)!;

      // 获取交易信号
      const signal = indicator.getSignal(result, params);

      log.debug(`🚦 Generated signal for ${indicatorName}:`, {
        signal: signal.signal,
        strength: signal.strength,
        confidence: signal.confidence
      });

      return signal;

    } catch (error) {
      log.error(`❌ Failed to get signal for ${indicatorName}`, error);
      throw error;
    }
  }

  /**
   * 计算多个指标
   */
  async calculateMultipleIndicators(
    indicatorNames: string[],
    data: OHLCV[],
    params?: { [indicatorName: string]: IndicatorParams }
  ): Promise<{ [indicatorName: string]: IndicatorResult }> {
    const results: { [indicatorName: string]: IndicatorResult } = {};
    const errors: { [indicatorName: string]: Error } = {};

    // 并行计算所有指标
    const calculations = indicatorNames.map(async (name) => {
      try {
        const indicatorParams = params?.[name];
        const result = await this.calculateIndicator(name, data, indicatorParams);
        results[name] = result;
      } catch (error) {
        errors[name] = error instanceof Error ? error : new Error(String(error));
        log.warn(`⚠️ Failed to calculate indicator ${name}:`, error);
      }
    });

    await Promise.all(calculations);

    // 如果有错误但也有成功的计算，记录警告
    const errorCount = Object.keys(errors).length;
    const successCount = Object.keys(results).length;

    if (errorCount > 0 && successCount > 0) {
      log.warn(`📊 Multiple indicator calculation completed with errors`, {
        successful: successCount,
        failed: errorCount,
        failedIndicators: Object.keys(errors)
      });
    } else if (errorCount > 0 && successCount === 0) {
      throw new Error(`All indicator calculations failed: ${Object.keys(errors).join(', ')}`);
    }

    return results;
  }

  /**
   * 获取综合信号分析
   */
  async getCompositeSignal(
    indicatorNames: string[],
    data: OHLCV[],
    symbolPair: string,
    timeframe: TimeFrame,
    params?: { [indicatorName: string]: IndicatorParams }
  ): Promise<CompositeSignal> {
    try {
      const signals: { [indicatorName: string]: SignalResult } = {};
      const errors: string[] = [];

      // 获取所有指标的信号
      for (const name of indicatorNames) {
        try {
          const indicatorParams = params?.[name];
          const signal = await this.getIndicatorSignal(name, data, indicatorParams);
          signals[name] = signal;
        } catch (error) {
          errors.push(name);
          log.warn(`⚠️ Failed to get signal for ${name}:`, error);
        }
      }

      if (Object.keys(signals).length === 0) {
        throw new Error('No valid signals could be generated');
      }

      // 计算综合信号
      const composite = this.calculateCompositeSignal(signals, symbolPair, timeframe);

      log.info(`🎯 Generated composite signal for ${symbolPair}:`, {
        overallSignal: composite.overallSignal,
        score: composite.score,
        grade: composite.grade,
        indicatorCount: Object.keys(signals).length
      });

      return composite;

    } catch (error) {
      log.error(`❌ Failed to generate composite signal`, error);
      throw error;
    }
  }

  /**
   * 验证数据有效性
   */
  validateData(data: OHLCV[]): boolean {
    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }

    // 检查数据结构完整性
    return data.every(candle => {
      return (
        typeof candle.timestamp === 'number' &&
        typeof candle.open === 'number' &&
        typeof candle.high === 'number' &&
        typeof candle.low === 'number' &&
        typeof candle.close === 'number' &&
        typeof candle.volume === 'number' &&
        candle.high >= candle.low &&
        candle.high >= candle.open &&
        candle.high >= candle.close &&
        candle.low <= candle.open &&
        candle.low <= candle.close &&
        candle.volume >= 0
      );
    });
  }

  /**
   * 获取引擎统计信息
   */
  getEngineStats() {
    const avgTime = this.stats.totalCalculations > 0
      ? this.stats.totalTime / this.stats.totalCalculations
      : 0;

    return {
      registeredIndicators: this.indicators.size,
      calculationsPerformed: this.stats.totalCalculations,
      averageCalculationTime: Math.round(avgTime * 100) / 100,
      errorCount: this.stats.errorCount
    };
  }

  // Private methods

  private validateInputs(indicatorName: string, data: OHLCV[]): void {
    if (!indicatorName || typeof indicatorName !== 'string') {
      throw new IndicatorError('Indicator name must be a non-empty string', indicatorName);
    }

    if (!this.validateData(data)) {
      throw new InsufficientDataError(indicatorName, 1, 0);
    }
  }

  private updateStats(startTime: number, hasError: boolean): void {
    const duration = Date.now() - startTime;

    this.stats.totalCalculations++;
    this.stats.totalTime += duration;
    this.stats.lastCalculationTime = duration;

    if (hasError) {
      this.stats.errorCount++;
    }
  }

  private resetStats(): void {
    this.stats = {
      totalCalculations: 0,
      totalTime: 0,
      errorCount: 0,
      lastCalculationTime: 0
    };
  }

  private calculateCompositeSignal(
    signals: { [indicatorName: string]: SignalResult },
    symbolPair: string,
    timeframe: TimeFrame
  ): CompositeSignal {
    const signalValues = Object.values(signals);

    // 计算加权评分
    let totalScore = 0;
    let totalWeight = 0;

    for (const signal of signalValues) {
      const weight = signal.confidence * (signal.strength / 100);
      let signalScore = 0;

      switch (signal.signal) {
        case Signal.STRONG_BUY:
          signalScore = 100;
          break;
        case Signal.BUY:
          signalScore = 50;
          break;
        case Signal.HOLD:
          signalScore = 0;
          break;
        case Signal.SELL:
          signalScore = -50;
          break;
        case Signal.STRONG_SELL:
          signalScore = -100;
          break;
      }

      totalScore += signalScore * weight;
      totalWeight += weight;
    }

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

    // 确定综合信号
    let overallSignal: Signal;
    if (finalScore >= 60) {
      overallSignal = Signal.STRONG_BUY;
    } else if (finalScore >= 20) {
      overallSignal = Signal.BUY;
    } else if (finalScore <= -60) {
      overallSignal = Signal.STRONG_SELL;
    } else if (finalScore <= -20) {
      overallSignal = Signal.SELL;
    } else {
      overallSignal = Signal.HOLD;
    }

    // 计算等级
    const absScore = Math.abs(finalScore);
    let grade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (absScore >= 80) grade = 'A';
    else if (absScore >= 60) grade = 'B';
    else if (absScore >= 40) grade = 'C';
    else if (absScore >= 20) grade = 'D';
    else grade = 'F';

    return {
      overallSignal,
      score: Math.round(finalScore),
      grade,
      signals,
      metadata: {
        timestamp: Date.now(),
        symbolPair,
        timeframe,
        analysisCount: signalValues.length
      }
    };
  }
}