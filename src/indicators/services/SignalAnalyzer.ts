import { injectable, inject } from 'inversify';
import {
  SignalResult,
  CompositeSignal,
  Signal,
  TimeFrame,
  OHLCV
} from '../types';
import { SERVICE_IDENTIFIERS } from '../../core/container/decorators';
import { ITechnicalIndicatorEngine } from './TechnicalIndicatorEngine';
import { IIndicatorCacheService } from './IndicatorCacheService';
import { ILifecycleAware } from '../../core/Application';
import { log } from '../../utils/logger';

/**
 * 信号权重配置
 */
interface SignalWeight {
  indicatorName: string;
  weight: number;
  reliability: number; // 可靠性系数 0-1
  timeframeSensitivity: number; // 时间框架敏感度
}

/**
 * 分析策略配置
 */
interface AnalysisStrategy {
  name: string;
  description: string;
  weights: SignalWeight[];
  minimumIndicators: number;
  confidenceThreshold: number;
  riskAdjustment: number;
}

/**
 * 市场情绪分析结果
 */
interface MarketSentiment {
  sentiment: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
  score: number; // -100 到 +100
  confidence: number;
  factors: {
    [indicatorName: string]: {
      signal: Signal;
      contribution: number;
    };
  };
}

/**
 * 风险评估结果
 */
interface RiskAssessment {
  riskLevel: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  score: number; // 0-100
  factors: {
    volatility: number;
    momentum: number;
    divergence: number;
    volume: number;
  };
  recommendations: string[];
}

/**
 * 信号分析器接口
 */
export interface ISignalAnalyzer {
  /**
   * 分析综合信号
   */
  analyzeCompositeSignal(
    signals: { [indicatorName: string]: SignalResult },
    symbolPair: string,
    timeframe: TimeFrame,
    strategy?: string
  ): Promise<CompositeSignal>;

  /**
   * 分析市场情绪
   */
  analyzeMarketSentiment(
    signals: { [indicatorName: string]: SignalResult },
    timeframe: TimeFrame
  ): Promise<MarketSentiment>;

  /**
   * 评估风险
   */
  assessRisk(
    signals: { [indicatorName: string]: SignalResult },
    ohlcvData: OHLCV[],
    timeframe: TimeFrame
  ): Promise<RiskAssessment>;

  /**
   * 获取信号强度
   */
  getSignalStrength(
    signals: { [indicatorName: string]: SignalResult }
  ): number;

  /**
   * 检测信号冲突
   */
  detectSignalConflicts(
    signals: { [indicatorName: string]: SignalResult }
  ): {
    hasConflicts: boolean;
    conflicts: Array<{
      indicator1: string;
      indicator2: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
    }>;
  };

  /**
   * 获取交易建议
   */
  getTradingRecommendation(
    composite: CompositeSignal,
    sentiment: MarketSentiment,
    risk: RiskAssessment
  ): {
    action: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    confidence: number;
    reasoning: string[];
    stopLoss?: number;
    takeProfit?: number;
  };

  /**
   * 注册分析策略
   */
  registerStrategy(strategy: AnalysisStrategy): void;

  /**
   * 获取可用策略
   */
  getAvailableStrategies(): string[];

  /**
   * 获取分析统计
   */
  getAnalysisStats(): {
    totalAnalyses: number;
    averageConfidence: number;
    strategyUsage: { [strategyName: string]: number };
    accuracyRate: number;
  };
}

/**
 * 信号分析器
 * 提供综合的技术信号分析和决策支持
 */
@injectable()
export class SignalAnalyzer implements ISignalAnalyzer, ILifecycleAware {
  private indicatorEngine: ITechnicalIndicatorEngine;
  private cacheService: IIndicatorCacheService;
  private isInitialized = false;

  private strategies = new Map<string, AnalysisStrategy>();
  private analysisStats = {
    totalAnalyses: 0,
    totalConfidence: 0,
    strategyUsage: new Map<string, number>(),
    correctPredictions: 0
  };

  // 默认策略配置
  private readonly DEFAULT_STRATEGIES: AnalysisStrategy[] = [
    {
      name: 'balanced',
      description: '平衡策略 - 均等权重所有指标',
      weights: [
        { indicatorName: 'RSI', weight: 1.0, reliability: 0.8, timeframeSensitivity: 0.7 },
        { indicatorName: 'MACD', weight: 1.0, reliability: 0.85, timeframeSensitivity: 0.8 },
        { indicatorName: 'MA', weight: 0.8, reliability: 0.7, timeframeSensitivity: 0.9 },
        { indicatorName: 'BB', weight: 0.9, reliability: 0.75, timeframeSensitivity: 0.6 },
        { indicatorName: 'KDJ', weight: 0.9, reliability: 0.7, timeframeSensitivity: 0.7 },
        { indicatorName: 'WR', weight: 0.8, reliability: 0.65, timeframeSensitivity: 0.6 }
      ],
      minimumIndicators: 3,
      confidenceThreshold: 0.6,
      riskAdjustment: 1.0
    },
    {
      name: 'momentum',
      description: '动量策略 - 重视动量指标',
      weights: [
        { indicatorName: 'RSI', weight: 1.5, reliability: 0.8, timeframeSensitivity: 0.7 },
        { indicatorName: 'MACD', weight: 1.8, reliability: 0.85, timeframeSensitivity: 0.8 },
        { indicatorName: 'MA', weight: 0.6, reliability: 0.7, timeframeSensitivity: 0.9 },
        { indicatorName: 'BB', weight: 0.7, reliability: 0.75, timeframeSensitivity: 0.6 },
        { indicatorName: 'KDJ', weight: 1.3, reliability: 0.7, timeframeSensitivity: 0.7 },
        { indicatorName: 'WR', weight: 1.2, reliability: 0.65, timeframeSensitivity: 0.6 }
      ],
      minimumIndicators: 2,
      confidenceThreshold: 0.7,
      riskAdjustment: 1.2
    },
    {
      name: 'trend',
      description: '趋势策略 - 重视趋势指标',
      weights: [
        { indicatorName: 'RSI', weight: 0.8, reliability: 0.8, timeframeSensitivity: 0.7 },
        { indicatorName: 'MACD', weight: 1.2, reliability: 0.85, timeframeSensitivity: 0.8 },
        { indicatorName: 'MA', weight: 1.5, reliability: 0.7, timeframeSensitivity: 0.9 },
        { indicatorName: 'BB', weight: 1.0, reliability: 0.75, timeframeSensitivity: 0.6 },
        { indicatorName: 'KDJ', weight: 0.7, reliability: 0.7, timeframeSensitivity: 0.7 },
        { indicatorName: 'WR', weight: 0.6, reliability: 0.65, timeframeSensitivity: 0.6 }
      ],
      minimumIndicators: 3,
      confidenceThreshold: 0.65,
      riskAdjustment: 0.9
    },
    {
      name: 'conservative',
      description: '保守策略 - 高置信度要求',
      weights: [
        { indicatorName: 'RSI', weight: 1.0, reliability: 0.9, timeframeSensitivity: 0.7 },
        { indicatorName: 'MACD', weight: 1.1, reliability: 0.95, timeframeSensitivity: 0.8 },
        { indicatorName: 'MA', weight: 1.0, reliability: 0.8, timeframeSensitivity: 0.9 },
        { indicatorName: 'BB', weight: 0.9, reliability: 0.85, timeframeSensitivity: 0.6 },
        { indicatorName: 'KDJ', weight: 0.8, reliability: 0.8, timeframeSensitivity: 0.7 },
        { indicatorName: 'WR', weight: 0.7, reliability: 0.75, timeframeSensitivity: 0.6 }
      ],
      minimumIndicators: 4,
      confidenceThreshold: 0.8,
      riskAdjustment: 0.7
    },
    {
      name: 'aggressive',
      description: '激进策略 - 快速响应',
      weights: [
        { indicatorName: 'RSI', weight: 1.2, reliability: 0.7, timeframeSensitivity: 0.9 },
        { indicatorName: 'MACD', weight: 1.4, reliability: 0.8, timeframeSensitivity: 0.9 },
        { indicatorName: 'MA', weight: 0.8, reliability: 0.6, timeframeSensitivity: 0.8 },
        { indicatorName: 'BB', weight: 1.1, reliability: 0.7, timeframeSensitivity: 0.8 },
        { indicatorName: 'KDJ', weight: 1.3, reliability: 0.65, timeframeSensitivity: 0.9 },
        { indicatorName: 'WR', weight: 1.2, reliability: 0.6, timeframeSensitivity: 0.8 }
      ],
      minimumIndicators: 2,
      confidenceThreshold: 0.5,
      riskAdjustment: 1.5
    }
  ];

  constructor(
    @inject(SERVICE_IDENTIFIERS.TECHNICAL_INDICATOR_ENGINE) indicatorEngine: ITechnicalIndicatorEngine,
    @inject(SERVICE_IDENTIFIERS.INDICATOR_CACHE_SERVICE) cacheService: IIndicatorCacheService
  ) {
    this.indicatorEngine = indicatorEngine;
    this.cacheService = cacheService;
  }

  /**
   * 初始化信号分析器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      log.info('🔧 Initializing Signal Analyzer');

      // 注册默认策略
      this.DEFAULT_STRATEGIES.forEach(strategy => {
        this.strategies.set(strategy.name, strategy);
      });

      // 重置统计
      this.resetStats();

      // Initialize injected services (placeholder)
      if (this.indicatorEngine && this.cacheService) {
        log.info('Dependencies injected successfully');
      }

      this.isInitialized = true;
      log.info('✅ Signal Analyzer initialized successfully', {
        strategiesCount: this.strategies.size
      });

    } catch (error) {
      log.error('❌ Failed to initialize Signal Analyzer', error);
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

    log.info('🚀 Signal Analyzer started');
  }

  /**
   * 停止服务
   */
  async stop(): Promise<void> {
    log.info('🛑 Stopping Signal Analyzer');
    log.info('✅ Signal Analyzer stopped');
  }

  /**
   * 销毁服务
   */
  async destroy(): Promise<void> {
    await this.stop();
    this.strategies.clear();
    this.resetStats();
    this.isInitialized = false;

    log.info('🗑️ Signal Analyzer destroyed');
  }

  /**
   * 分析综合信号
   */
  async analyzeCompositeSignal(
    signals: { [indicatorName: string]: SignalResult },
    symbolPair: string,
    timeframe: TimeFrame,
    strategyName: string = 'balanced'
  ): Promise<CompositeSignal> {
    try {
      this.analysisStats.totalAnalyses++;

      const strategy = this.strategies.get(strategyName) || this.strategies.get('balanced')!;

      // 更新策略使用统计
      const currentUsage = this.analysisStats.strategyUsage.get(strategyName) || 0;
      this.analysisStats.strategyUsage.set(strategyName, currentUsage + 1);

      // 检查最小指标数量
      const availableIndicators = Object.keys(signals).length;
      if (availableIndicators < strategy.minimumIndicators) {
        log.warn(`Insufficient indicators for strategy ${strategyName}`, {
          available: availableIndicators,
          required: strategy.minimumIndicators
        });
      }

      // 计算加权信号分数
      const weightedScore = this.calculateWeightedScore(signals, strategy, timeframe);

      // 确定综合信号
      const overallSignal = this.determineOverallSignal(weightedScore.score);

      // 计算信号等级
      const grade = this.calculateSignalGrade(Math.abs(weightedScore.score), weightedScore.confidence);

      // 创建综合信号结果
      const composite: CompositeSignal = {
        overallSignal,
        score: Math.round(weightedScore.score),
        grade,
        signals,
        metadata: {
          timestamp: Date.now(),
          symbolPair,
          timeframe,
          analysisCount: availableIndicators
        }
      };

      // 更新置信度统计
      this.analysisStats.totalConfidence += weightedScore.confidence;

      log.debug('Composite signal analyzed', {
        symbol: symbolPair,
        timeframe,
        strategy: strategyName,
        signal: overallSignal,
        score: composite.score,
        grade,
        confidence: weightedScore.confidence
      });

      return composite;

    } catch (error) {
      log.error('Failed to analyze composite signal', error);
      throw error;
    }
  }

  /**
   * 分析市场情绪
   */
  async analyzeMarketSentiment(
    signals: { [indicatorName: string]: SignalResult },
    _timeframe: TimeFrame
  ): Promise<MarketSentiment> {
    try {
      const factors: { [indicatorName: string]: { signal: Signal; contribution: number } } = {};
      let totalScore = 0;
      let totalWeight = 0;

      // 计算每个指标的贡献
      for (const [indicatorName, signalResult] of Object.entries(signals)) {
        const signalScore = this.signalToScore(signalResult.signal);
        const weight = signalResult.confidence * (signalResult.strength / 100);

        factors[indicatorName] = {
          signal: signalResult.signal,
          contribution: signalScore * weight
        };

        totalScore += signalScore * weight;
        totalWeight += weight;
      }

      const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;

      // 确定情绪类型
      let sentiment: MarketSentiment['sentiment'];
      if (finalScore >= 70) {
        sentiment = 'EXTREME_GREED';
      } else if (finalScore >= 30) {
        sentiment = 'GREED';
      } else if (finalScore <= -70) {
        sentiment = 'EXTREME_FEAR';
      } else if (finalScore <= -30) {
        sentiment = 'FEAR';
      } else {
        sentiment = 'NEUTRAL';
      }

      const confidence = this.calculateSentimentConfidence(signals, totalWeight);

      return {
        sentiment,
        score: Math.round(finalScore),
        confidence,
        factors
      };

    } catch (error) {
      log.error('Failed to analyze market sentiment', error);
      throw error;
    }
  }

  /**
   * 评估风险
   */
  async assessRisk(
    signals: { [indicatorName: string]: SignalResult },
    ohlcvData: OHLCV[],
    _timeframe: TimeFrame
  ): Promise<RiskAssessment> {
    try {
      // 计算风险因子
      const volatility = this.calculateVolatilityRisk(ohlcvData);
      const momentum = this.calculateMomentumRisk(signals);
      const divergence = this.calculateDivergenceRisk(signals);
      const volume = this.calculateVolumeRisk(ohlcvData);

      // 计算综合风险分数
      const totalRisk = (volatility * 0.3 + momentum * 0.25 + divergence * 0.25 + volume * 0.2);

      // 确定风险等级
      let riskLevel: RiskAssessment['riskLevel'];
      if (totalRisk >= 80) {
        riskLevel = 'VERY_HIGH';
      } else if (totalRisk >= 60) {
        riskLevel = 'HIGH';
      } else if (totalRisk >= 40) {
        riskLevel = 'MEDIUM';
      } else if (totalRisk >= 20) {
        riskLevel = 'LOW';
      } else {
        riskLevel = 'VERY_LOW';
      }

      // 生成建议
      const recommendations = this.generateRiskRecommendations(riskLevel, {
        volatility,
        momentum,
        divergence,
        volume
      });

      return {
        riskLevel,
        score: Math.round(totalRisk),
        factors: {
          volatility: Math.round(volatility),
          momentum: Math.round(momentum),
          divergence: Math.round(divergence),
          volume: Math.round(volume)
        },
        recommendations
      };

    } catch (error) {
      log.error('Failed to assess risk', error);
      throw error;
    }
  }

  /**
   * 获取信号强度
   */
  getSignalStrength(signals: { [indicatorName: string]: SignalResult }): number {
    if (Object.keys(signals).length === 0) return 0;

    const strengths = Object.values(signals).map(signal => signal.strength);
    return Math.round(strengths.reduce((sum, strength) => sum + strength, 0) / strengths.length);
  }

  /**
   * 检测信号冲突
   */
  detectSignalConflicts(signals: { [indicatorName: string]: SignalResult }) {
    const conflicts: Array<{
      indicator1: string;
      indicator2: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH';
    }> = [];

    const indicatorNames = Object.keys(signals);

    for (let i = 0; i < indicatorNames.length; i++) {
      for (let j = i + 1; j < indicatorNames.length; j++) {
        const indicator1 = indicatorNames[i];
        const indicator2 = indicatorNames[j];
        const signal1 = signals[indicator1];
        const signal2 = signals[indicator2];

        const conflict = this.detectConflictBetweenSignals(signal1, signal2);
        if (conflict) {
          conflicts.push({
            indicator1,
            indicator2,
            severity: conflict
          });
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts
    };
  }

  /**
   * 获取交易建议
   */
  getTradingRecommendation(
    composite: CompositeSignal,
    sentiment: MarketSentiment,
    risk: RiskAssessment
  ) {
    const reasoning: string[] = [];
    let confidence = composite.metadata.analysisCount / 6; // 基于指标数量的基础置信度

    // 基于综合信号的建议
    let action: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' = composite.overallSignal as any;

    // 根据市场情绪调整
    if (sentiment.sentiment === 'EXTREME_FEAR' && composite.overallSignal === Signal.BUY) {
      action = 'STRONG_BUY';
      reasoning.push('极度恐慌情绪下的买入机会');
      confidence += 0.1;
    } else if (sentiment.sentiment === 'EXTREME_GREED' && composite.overallSignal === Signal.SELL) {
      action = 'STRONG_SELL';
      reasoning.push('极度贪婪情绪下的卖出信号');
      confidence += 0.1;
    }

    // 根据风险调整
    if (risk.riskLevel === 'VERY_HIGH' || risk.riskLevel === 'HIGH') {
      if (action === 'STRONG_BUY') action = 'BUY';
      if (action === 'BUY') action = 'HOLD';
      reasoning.push(`高风险环境，降低操作强度`);
      confidence -= 0.15;
    }

    // 根据信号等级调整置信度
    switch (composite.grade) {
      case 'A':
        confidence += 0.2;
        reasoning.push('A级信号质量');
        break;
      case 'B':
        confidence += 0.1;
        reasoning.push('B级信号质量');
        break;
      case 'C':
        reasoning.push('C级信号质量，谨慎操作');
        break;
      case 'D':
        confidence -= 0.1;
        reasoning.push('D级信号质量，信号较弱');
        break;
      case 'F':
        action = 'HOLD';
        confidence -= 0.2;
        reasoning.push('F级信号质量，建议观望');
        break;
    }

    // 生成止损和止盈建议
    let stopLoss: number | undefined;
    let takeProfit: number | undefined;

    if (action !== 'HOLD') {
      const riskMultiplier = risk.score / 100;

      if (action === 'BUY' || action === 'STRONG_BUY') {
        stopLoss = 0.95 - (riskMultiplier * 0.05); // 基础5%止损，根据风险调整
        takeProfit = 1.05 + (composite.score / 100 * 0.1); // 基于信号强度的止盈
      } else if (action === 'SELL' || action === 'STRONG_SELL') {
        stopLoss = 1.05 + (riskMultiplier * 0.05);
        takeProfit = 0.95 - (Math.abs(composite.score) / 100 * 0.1);
      }
    }

    confidence = Math.max(0, Math.min(1, confidence));

    const result: any = {
      action,
      confidence: Math.round(confidence * 100) / 100,
      reasoning
    };

    if (stopLoss !== undefined) {
      result.stopLoss = stopLoss;
    }
    if (takeProfit !== undefined) {
      result.takeProfit = takeProfit;
    }

    return result;
  }

  /**
   * 注册分析策略
   */
  registerStrategy(strategy: AnalysisStrategy): void {
    this.strategies.set(strategy.name, strategy);
    log.debug(`Registered analysis strategy: ${strategy.name}`);
  }

  /**
   * 获取可用策略
   */
  getAvailableStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * 获取分析统计
   */
  getAnalysisStats() {
    const averageConfidence = this.analysisStats.totalAnalyses > 0
      ? this.analysisStats.totalConfidence / this.analysisStats.totalAnalyses
      : 0;

    const strategyUsage: { [strategyName: string]: number } = {};
    for (const [name, count] of this.analysisStats.strategyUsage.entries()) {
      strategyUsage[name] = count;
    }

    const accuracyRate = this.analysisStats.totalAnalyses > 0
      ? (this.analysisStats.correctPredictions / this.analysisStats.totalAnalyses) * 100
      : 0;

    return {
      totalAnalyses: this.analysisStats.totalAnalyses,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      strategyUsage,
      accuracyRate: Math.round(accuracyRate * 100) / 100
    };
  }

  // Private methods

  private calculateWeightedScore(
    signals: { [indicatorName: string]: SignalResult },
    strategy: AnalysisStrategy,
    timeframe: TimeFrame
  ): { score: number; confidence: number } {
    let totalScore = 0;
    let totalWeight = 0;
    let totalConfidence = 0;

    for (const [indicatorName, signalResult] of Object.entries(signals)) {
      const strategyWeight = strategy.weights.find(w => w.indicatorName === indicatorName);
      if (!strategyWeight) continue;

      // 计算信号分数 (-100 到 +100)
      const signalScore = this.signalToScore(signalResult.signal);

      // 计算权重 (考虑策略权重、可靠性、时间框架敏感度)
      const timeframeMultiplier = this.getTimeframeMultiplier(timeframe, strategyWeight.timeframeSensitivity);
      const weight = strategyWeight.weight * strategyWeight.reliability * timeframeMultiplier;

      // 应用信号强度和置信度
      const adjustedScore = signalScore * (signalResult.strength / 100) * signalResult.confidence;

      totalScore += adjustedScore * weight;
      totalWeight += weight;
      totalConfidence += signalResult.confidence * weight;
    }

    const finalScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const finalConfidence = totalWeight > 0 ? totalConfidence / totalWeight : 0;

    // 应用风险调整
    const adjustedScore = finalScore * strategy.riskAdjustment;

    return {
      score: Math.max(-100, Math.min(100, adjustedScore)),
      confidence: Math.max(0, Math.min(1, finalConfidence))
    };
  }

  private signalToScore(signal: Signal): number {
    switch (signal) {
      case Signal.STRONG_BUY:
        return 100;
      case Signal.BUY:
        return 50;
      case Signal.HOLD:
        return 0;
      case Signal.SELL:
        return -50;
      case Signal.STRONG_SELL:
        return -100;
      default:
        return 0;
    }
  }

  private determineOverallSignal(score: number): Signal {
    if (score >= 60) {
      return Signal.STRONG_BUY;
    } else if (score >= 20) {
      return Signal.BUY;
    } else if (score <= -60) {
      return Signal.STRONG_SELL;
    } else if (score <= -20) {
      return Signal.SELL;
    } else {
      return Signal.HOLD;
    }
  }

  private calculateSignalGrade(
    absScore: number,
    confidence: number
  ): 'A' | 'B' | 'C' | 'D' | 'F' {
    const combinedScore = absScore * confidence;

    if (combinedScore >= 70) return 'A';
    if (combinedScore >= 55) return 'B';
    if (combinedScore >= 40) return 'C';
    if (combinedScore >= 25) return 'D';
    return 'F';
  }

  private getTimeframeMultiplier(timeframe: TimeFrame, sensitivity: number): number {
    // 根据时间框架调整权重
    const timeframeWeights = {
      [TimeFrame.M1]: 0.6,
      [TimeFrame.M5]: 0.7,
      [TimeFrame.M15]: 0.8,
      [TimeFrame.M30]: 0.9,
      [TimeFrame.H1]: 1.0,
      [TimeFrame.H4]: 1.1,
      [TimeFrame.D1]: 1.2,
      [TimeFrame.W1]: 1.1,
      [TimeFrame.MN1]: 1.0
    };

    const baseWeight = timeframeWeights[timeframe] || 1.0;
    return baseWeight * sensitivity;
  }

  private calculateSentimentConfidence(
    signals: { [indicatorName: string]: SignalResult },
    totalWeight: number
  ): number {
    const signalCount = Object.keys(signals).length;
    const weightNormalized = Math.min(1, totalWeight / signalCount);
    const countBonus = Math.min(0.2, signalCount * 0.05);

    return Math.min(1, weightNormalized + countBonus);
  }

  private calculateVolatilityRisk(ohlcvData: OHLCV[]): number {
    if (ohlcvData.length < 2) return 50;

    // 计算价格波动率
    const priceChanges = [];
    for (let i = 1; i < ohlcvData.length; i++) {
      const change = Math.abs(ohlcvData[i].close - ohlcvData[i - 1].close) / ohlcvData[i - 1].close;
      priceChanges.push(change);
    }

    const avgVolatility = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
    return Math.min(100, avgVolatility * 1000); // 将小数转换为百分比
  }

  private calculateMomentumRisk(signals: { [indicatorName: string]: SignalResult }): number {
    // 基于动量指标的分歧程度计算风险
    const momentumIndicators = ['RSI', 'MACD', 'KDJ'];
    const momentumSignals = Object.entries(signals)
      .filter(([name]) => momentumIndicators.includes(name))
      .map(([, signal]) => this.signalToScore(signal.signal));

    if (momentumSignals.length < 2) return 50;

    const variance = this.calculateVariance(momentumSignals);
    return Math.min(100, variance * 2);
  }

  private calculateDivergenceRisk(signals: { [indicatorName: string]: SignalResult }): number {
    // 检测信号之间的分歧
    const signalScores = Object.values(signals).map(signal => this.signalToScore(signal.signal));

    if (signalScores.length < 2) return 50;

    const variance = this.calculateVariance(signalScores);
    return Math.min(100, variance / 100);
  }

  private calculateVolumeRisk(ohlcvData: OHLCV[]): number {
    if (ohlcvData.length < 10) return 50;

    // 计算成交量异常
    const volumes = ohlcvData.slice(-10).map(candle => candle.volume);
    const avgVolume = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    const latestVolume = volumes[volumes.length - 1];

    const volumeRatio = latestVolume / avgVolume;

    // 成交量过高或过低都是风险
    if (volumeRatio > 3 || volumeRatio < 0.3) {
      return 80;
    } else if (volumeRatio > 2 || volumeRatio < 0.5) {
      return 60;
    } else {
      return 30;
    }
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;

    return variance;
  }

  private detectConflictBetweenSignals(
    signal1: SignalResult,
    signal2: SignalResult
  ): 'LOW' | 'MEDIUM' | 'HIGH' | null {
    const score1 = this.signalToScore(signal1.signal);
    const score2 = this.signalToScore(signal2.signal);

    // 同方向信号不算冲突
    if ((score1 > 0 && score2 > 0) || (score1 < 0 && score2 < 0) || (score1 === 0 || score2 === 0)) {
      return null;
    }

    const difference = Math.abs(score1 - score2);
    const avgStrength = (signal1.strength + signal2.strength) / 2;

    // 考虑信号强度的影响
    const weightedDifference = difference * (avgStrength / 100);

    if (weightedDifference >= 120) {
      return 'HIGH';
    } else if (weightedDifference >= 80) {
      return 'MEDIUM';
    } else if (weightedDifference >= 40) {
      return 'LOW';
    }

    return null;
  }

  private generateRiskRecommendations(
    riskLevel: RiskAssessment['riskLevel'],
    factors: { volatility: number; momentum: number; divergence: number; volume: number }
  ): string[] {
    const recommendations: string[] = [];

    switch (riskLevel) {
      case 'VERY_HIGH':
        recommendations.push('建议暂停交易，等待市场稳定');
        recommendations.push('如必须交易，请大幅减少仓位');
        break;
      case 'HIGH':
        recommendations.push('谨慎交易，减少仓位至平常的30-50%');
        recommendations.push('设置更严格的止损');
        break;
      case 'MEDIUM':
        recommendations.push('适度谨慎，仓位控制在平常的70%');
        break;
      case 'LOW':
        recommendations.push('正常交易，保持常规风险管理');
        break;
      case 'VERY_LOW':
        recommendations.push('可以考虑适当增加仓位');
        break;
    }

    // 基于具体风险因子的建议
    if (factors.volatility > 70) {
      recommendations.push('价格波动剧烈，注意风险控制');
    }
    if (factors.momentum > 70) {
      recommendations.push('动量指标存在分歧，等待明确方向');
    }
    if (factors.divergence > 70) {
      recommendations.push('技术指标信号冲突，建议观望');
    }
    if (factors.volume > 70) {
      recommendations.push('成交量异常，留意市场变化');
    }

    return recommendations;
  }

  private resetStats(): void {
    this.analysisStats = {
      totalAnalyses: 0,
      totalConfidence: 0,
      strategyUsage: new Map(),
      correctPredictions: 0
    };
  }
}