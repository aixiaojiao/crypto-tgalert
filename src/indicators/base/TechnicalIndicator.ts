import {
  ITechnicalIndicator,
  OHLCV,
  IndicatorResult,
  SignalResult,
  IndicatorParams,
  Signal,
  Trend,
  IndicatorType,
  InsufficientDataError,
  InvalidParamsError
} from '../types';

/**
 * 技术指标基类
 * 提供通用的计算方法和工具函数
 */
export abstract class TechnicalIndicator implements ITechnicalIndicator {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly requiredPeriods: number;
  public abstract readonly type: IndicatorType;

  /**
   * 抽象方法：计算指标值
   */
  public abstract calculate(data: OHLCV[], params?: IndicatorParams): IndicatorResult;

  /**
   * 抽象方法：获取交易信号
   */
  public abstract getSignal(result: IndicatorResult, params?: IndicatorParams): SignalResult;

  /**
   * 抽象方法：获取默认参数
   */
  public abstract getDefaultParams(): IndicatorParams;

  /**
   * 验证数据充足性
   */
  protected validateDataSufficiency(data: OHLCV[], requiredPeriods?: number): void {
    const required = requiredPeriods || this.requiredPeriods;
    if (data.length < required) {
      throw new InsufficientDataError(this.name, required, data.length);
    }
  }

  /**
   * 验证参数有效性 - 基础验证
   */
  public validateParams(params: IndicatorParams): boolean {
    if (!params) return true; // 允许空参数，使用默认值

    // 基础验证：period 必须为正整数
    if (params.period !== undefined) {
      if (!Number.isInteger(params.period) || params.period <= 0) {
        throw new InvalidParamsError(this.name, 'period must be a positive integer', params);
      }
    }

    // 子类可以重写此方法进行更具体的验证
    return this.doValidateParams(params);
  }

  /**
   * 子类可重写的具体参数验证
   */
  protected doValidateParams(_params: IndicatorParams): boolean {
    return true;
  }

  /**
   * 合并参数：用户参数 + 默认参数
   */
  protected mergeParams(userParams?: IndicatorParams): IndicatorParams {
    const defaultParams = this.getDefaultParams();
    return { ...defaultParams, ...userParams };
  }

  /**
   * 计算简单移动平均线 (SMA)
   */
  protected calculateSMA(values: number[], period: number): number[] {
    const result: number[] = [];

    for (let i = period - 1; i < values.length; i++) {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }

    return result;
  }

  /**
   * 计算指数移动平均线 (EMA)
   */
  protected calculateEMA(values: number[], period: number): number[] {
    const result: number[] = [];
    const multiplier = 2 / (period + 1);

    // 第一个值使用SMA
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(ema);

    // 后续值使用EMA公式
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
      result.push(ema);
    }

    return result;
  }

  /**
   * 计算标准差
   */
  protected calculateStdDev(values: number[], period: number): number[] {
    const result: number[] = [];

    for (let i = period - 1; i < values.length; i++) {
      const subset = values.slice(i - period + 1, i + 1);
      const mean = subset.reduce((a, b) => a + b, 0) / period;
      const variance = subset.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      result.push(Math.sqrt(variance));
    }

    return result;
  }

  /**
   * 计算最高价序列
   */
  protected getHighPrices(data: OHLCV[]): number[] {
    return data.map(candle => candle.high);
  }

  /**
   * 计算最低价序列
   */
  protected getLowPrices(data: OHLCV[]): number[] {
    return data.map(candle => candle.low);
  }

  /**
   * 计算收盘价序列
   */
  protected getClosePrices(data: OHLCV[]): number[] {
    return data.map(candle => candle.close);
  }

  /**
   * 计算开盘价序列
   */
  protected getOpenPrices(data: OHLCV[]): number[] {
    return data.map(candle => candle.open);
  }

  /**
   * 计算成交量序列
   */
  protected getVolumes(data: OHLCV[]): number[] {
    return data.map(candle => candle.volume);
  }

  /**
   * 计算典型价格 (TP) = (High + Low + Close) / 3
   */
  protected getTypicalPrices(data: OHLCV[]): number[] {
    return data.map(candle => (candle.high + candle.low + candle.close) / 3);
  }

  /**
   * 计算真实波幅 (TR)
   */
  protected getTrueRanges(data: OHLCV[]): number[] {
    const result: number[] = [];

    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        // 第一根K线的TR就是高低价差
        result.push(data[i].high - data[i].low);
      } else {
        const tr1 = data[i].high - data[i].low;
        const tr2 = Math.abs(data[i].high - data[i - 1].close);
        const tr3 = Math.abs(data[i].low - data[i - 1].close);
        result.push(Math.max(tr1, tr2, tr3));
      }
    }

    return result;
  }

  /**
   * 计算价格变化
   */
  protected getPriceChanges(prices: number[]): number[] {
    const result: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      result.push(prices[i] - prices[i - 1]);
    }

    return result;
  }

  /**
   * 计算价格变化百分比
   */
  protected getPriceChangePercents(prices: number[]): number[] {
    const result: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const change = (prices[i] - prices[i - 1]) / prices[i - 1] * 100;
      result.push(change);
    }

    return result;
  }

  /**
   * 判断趋势方向
   */
  protected determineTrend(values: number[], lookback: number = 3): Trend {
    if (values.length < lookback + 1) return Trend.SIDEWAYS;

    const recent = values.slice(-lookback - 1);
    const increases = recent.slice(1).filter((val, i) => val > recent[i]).length;
    const decreases = recent.slice(1).filter((val, i) => val < recent[i]).length;

    if (increases > decreases) return Trend.UP;
    if (decreases > increases) return Trend.DOWN;
    return Trend.SIDEWAYS;
  }

  /**
   * 计算信号强度 (0-100)
   */
  protected calculateSignalStrength(
    value: number,
    threshold: number,
    maxThreshold: number
  ): number {
    const distance = Math.abs(value - threshold);
    const maxDistance = Math.abs(maxThreshold - threshold);

    if (maxDistance === 0) return 100;

    const strength = Math.min(100, (distance / maxDistance) * 100);
    return Math.round(strength);
  }

  /**
   * 计算置信度基于数据质量
   */
  protected calculateConfidence(
    dataLength: number,
    requiredPeriods: number,
    volatility?: number
  ): number {
    // 基础置信度基于数据充足性
    const dataRatio = Math.min(1, dataLength / (requiredPeriods * 2));
    let confidence = dataRatio;

    // 如果提供了波动性，调整置信度
    if (volatility !== undefined) {
      // 波动性越高，置信度越低
      const volatilityFactor = Math.max(0.5, 1 - volatility / 100);
      confidence *= volatilityFactor;
    }

    return Math.round(confidence * 100) / 100;
  }

  /**
   * 创建标准指标结果
   */
  protected createResult(
    values: number[],
    period: number,
    type: string,
    trend: Trend,
    confidence?: number
  ): IndicatorResult {
    return {
      values,
      metadata: {
        period,
        type,
        lastValue: values[values.length - 1] || 0,
        trend,
        timestamp: Date.now(),
        confidence: confidence || this.calculateConfidence(values.length, this.requiredPeriods)
      }
    };
  }

  /**
   * 创建标准信号结果
   */
  protected createSignalResult(
    signal: Signal,
    strength: number,
    confidence: number,
    reason: string,
    indicatorValue: number,
    threshold?: number,
    trend: Trend = Trend.SIDEWAYS
  ): SignalResult {
    const metadata: any = {
      indicatorValue,
      trend,
      timestamp: Date.now()
    };

    if (threshold !== undefined) {
      metadata.threshold = threshold;
    }

    return {
      signal,
      strength: Math.max(0, Math.min(100, strength)),
      confidence: Math.max(0, Math.min(1, confidence)),
      reason,
      metadata
    };
  }
}