/**
 * 技术指标框架核心类型定义
 * Technical Indicators Framework Core Types
 */

/**
 * OHLCV数据结构 - K线数据
 */
export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * 信号类型 - 交易信号强度分级
 */
export enum Signal {
  STRONG_SELL = 'STRONG_SELL',
  SELL = 'SELL',
  HOLD = 'HOLD',
  BUY = 'BUY',
  STRONG_BUY = 'STRONG_BUY'
}

/**
 * 趋势方向
 */
export enum Trend {
  UP = 'UP',
  DOWN = 'DOWN',
  SIDEWAYS = 'SIDEWAYS'
}

/**
 * 指标计算结果
 */
export interface IndicatorResult {
  values: number[];
  metadata: {
    period: number;
    type: string;
    lastValue: number;
    trend: Trend;
    timestamp: number;
    confidence: number; // 信号置信度 0-1
  };
}

/**
 * 指标参数配置
 */
export interface IndicatorParams {
  period?: number;
  fastPeriod?: number;
  slowPeriod?: number;
  signalPeriod?: number;
  multiplier?: number;
  [key: string]: any;
}

/**
 * 信号分析结果
 */
export interface SignalResult {
  signal: Signal;
  strength: number; // 信号强度 0-100
  confidence: number; // 置信度 0-1
  reason: string; // 信号原因说明
  metadata: {
    indicatorValue: number;
    threshold?: number;
    trend: Trend;
    timestamp: number;
  };
}

/**
 * 综合信号分析结果
 */
export interface CompositeSignal {
  overallSignal: Signal;
  score: number; // 综合评分 -100 到 +100
  grade: 'A' | 'B' | 'C' | 'D' | 'F'; // 信号等级
  signals: {
    [indicatorName: string]: SignalResult;
  };
  metadata: {
    timestamp: number;
    symbolPair: string;
    timeframe: string;
    analysisCount: number;
  };
}

/**
 * 技术指标接口
 */
export interface ITechnicalIndicator {
  readonly name: string;
  readonly description: string;
  readonly requiredPeriods: number;

  /**
   * 计算指标值
   */
  calculate(data: OHLCV[], params?: IndicatorParams): IndicatorResult;

  /**
   * 获取交易信号
   */
  getSignal(result: IndicatorResult, params?: IndicatorParams): SignalResult;

  /**
   * 验证参数有效性
   */
  validateParams(params: IndicatorParams): boolean;

  /**
   * 获取默认参数
   */
  getDefaultParams(): IndicatorParams;
}

/**
 * 指标类型分类
 */
export enum IndicatorType {
  TREND = 'TREND',           // 趋势指标
  MOMENTUM = 'MOMENTUM',     // 动量指标
  VOLATILITY = 'VOLATILITY', // 波动性指标
  VOLUME = 'VOLUME',         // 成交量指标
  OSCILLATOR = 'OSCILLATOR'  // 振荡器指标
}

/**
 * 时间框架
 */
export enum TimeFrame {
  M1 = '1m',
  M5 = '5m',
  M15 = '15m',
  M30 = '30m',
  H1 = '1h',
  H4 = '4h',
  D1 = '1d',
  W1 = '1w',
  MN1 = '1M'
}

/**
 * 指标计算错误类型
 */
export class IndicatorError extends Error {
  constructor(
    message: string,
    public indicatorName: string,
    public params?: IndicatorParams,
    public data?: OHLCV[]
  ) {
    super(message);
    this.name = 'IndicatorError';
  }
}

/**
 * 数据不足错误
 */
export class InsufficientDataError extends IndicatorError {
  constructor(
    indicatorName: string,
    required: number,
    available: number
  ) {
    super(
      `Insufficient data for ${indicatorName}: required ${required}, available ${available}`,
      indicatorName
    );
    this.name = 'InsufficientDataError';
  }
}

/**
 * 参数验证错误
 */
export class InvalidParamsError extends IndicatorError {
  constructor(
    indicatorName: string,
    message: string,
    params: IndicatorParams
  ) {
    super(`Invalid parameters for ${indicatorName}: ${message}`, indicatorName, params);
    this.name = 'InvalidParamsError';
  }
}