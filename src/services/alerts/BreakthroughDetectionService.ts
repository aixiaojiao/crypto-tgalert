import { AlertConfig, AlertType, BreakthroughCheckResult, BreakthroughAlertMetadata, MarketData } from './IAlertService';
import { historicalHighService } from '../historicalHighService';
import { HighTimeframe } from '../../models/historicalHighModel';
import { log } from '../../utils/logger';

/**
 * 兼容旧警报 metadata 里保存的时间框架（1w/1m/6m/1y/all），
 * 映射到 v3 的 5 档（7d/30d/180d/52w/ATH）。
 * 新警报也可直接使用 v3 的 key。
 */
function mapToV3Timeframe(tf: string): HighTimeframe | null {
  switch (tf) {
    case '1w': case '7d': return '7d';
    case '1m': case '30d': return '30d';
    case '6m': case '180d': return '180d';
    case '1y': case '52w': return '52w';
    case 'all': case 'ATH': return 'ATH';
    default: return null;
  }
}

/**
 * Breakthrough Detection Service - 突破检测服务
 * 负责检测价格突破历史高点的逻辑
 */
export class BreakthroughDetectionService {

  /**
   * 检测单个币种的突破情况
   */
  async checkBreakthrough(
    symbol: string,
    currentPrice: number,
    timeframe: string,
    lastCheckPrice?: number
  ): Promise<BreakthroughCheckResult | null> {
    try {
      // 确保symbol以USDT结尾
      const normalizedSymbol = symbol.endsWith('USDT') ? symbol : symbol + 'USDT';

      // 映射 timeframe 到 v3
      const v3tf = mapToV3Timeframe(timeframe);
      if (!v3tf) {
        log.warn(`Unsupported timeframe ${timeframe} for breakthrough check`);
        return null;
      }

      // 从 v3 缓存读取
      const rec = historicalHighService.queryHigh(normalizedSymbol, v3tf);
      if (!rec) {
        log.debug(`No historical data found for ${normalizedSymbol} ${timeframe}`);
        return null;
      }

      const highPrice = rec.highPrice;
      const highTimestamp = rec.highAt;

      // 检查是否为突破
      const isBreakthrough = this.isBreakthroughConditionMet(
        currentPrice,
        highPrice,
        lastCheckPrice
      );

      if (!isBreakthrough) {
        return null;
      }

      // 计算突破幅度
      const breakAmount = currentPrice - highPrice;
      const breakPercentage = ((currentPrice - highPrice) / highPrice) * 100;

      return {
        symbol: normalizedSymbol,
        currentPrice,
        timeframeHigh: highPrice,
        highTimestamp,
        isBreakthrough: true,
        breakAmount,
        breakPercentage
      };

    } catch (error) {
      log.error(`Failed to check breakthrough for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * 检测多个币种的突破情况（全币种监控）
   */
  async checkMultiBreakthrough(
    timeframe: string,
    minBreakPercentage: number = 0.1 // 最小突破幅度0.1%
  ): Promise<BreakthroughCheckResult[]> {
    try {
      const breakthroughs: BreakthroughCheckResult[] = [];

      // 映射 timeframe 到 v3
      const v3tf = mapToV3Timeframe(timeframe);
      if (!v3tf) {
        log.warn(`Unsupported timeframe ${timeframe} for multi-breakthrough`);
        return [];
      }

      // v3 排名：当前价已超过高点的 symbol 会是 distancePercent < 0
      const rankings = await historicalHighService.getRankingByProximityToHigh(v3tf, 500);

      for (const r of rankings) {
        if (r.currentPrice <= r.highPrice) continue;
        const breakAmount = r.currentPrice - r.highPrice;
        const breakPercentage = ((r.currentPrice - r.highPrice) / r.highPrice) * 100;
        if (breakPercentage >= minBreakPercentage) {
          breakthroughs.push({
            symbol: r.symbol,
            currentPrice: r.currentPrice,
            timeframeHigh: r.highPrice,
            highTimestamp: r.highAt,
            isBreakthrough: true,
            breakAmount,
            breakPercentage,
          });
        }
      }

      // 按突破幅度排序（从大到小）
      breakthroughs.sort((a, b) => b.breakPercentage - a.breakPercentage);

      log.info(`Found ${breakthroughs.length} breakthroughs for ${timeframe} timeframe`);
      return breakthroughs;

    } catch (error) {
      log.error(`Failed to check multi-breakthrough for ${timeframe}:`, error);
      return [];
    }
  }

  /**
   * 检查AlertConfig对应的突破情况
   */
  async checkAlertBreakthrough(
    alert: AlertConfig,
    marketData: MarketData
  ): Promise<BreakthroughCheckResult | null> {
    const metadata = alert.metadata as BreakthroughAlertMetadata & Record<string, any>;

    if (!metadata?.timeframe) {
      log.warn('Breakthrough alert missing timeframe metadata', { alertId: alert.id });
      return null;
    }

    if (alert.type === AlertType.BREAKTHROUGH) {
      // 单币种突破检测
      return await this.checkBreakthrough(
        alert.symbol,
        marketData.price,
        metadata.timeframe,
        metadata.lastCheckPrice
      );
    } else if (alert.type === AlertType.MULTI_BREAKTHROUGH) {
      // 全币种突破检测 - 返回第一个突破的结果作为触发
      const breakthroughs = await this.checkMultiBreakthrough(metadata.timeframe);
      return breakthroughs.length > 0 ? breakthroughs[0] : null;
    }

    return null;
  }

  /**
   * 判断是否满足突破条件
   * 避免重复触发：当前价格超过高点，但上次检查价格低于高点
   */
  private isBreakthroughConditionMet(
    currentPrice: number,
    highPrice: number,
    lastCheckPrice?: number
  ): boolean {
    // 当前价格必须超过历史高点
    if (currentPrice <= highPrice) {
      return false;
    }

    // 如果有上次检查价格，需要确保上次没有超过高点（避免重复触发）
    if (lastCheckPrice !== undefined && lastCheckPrice > highPrice) {
      return false;
    }

    return true;
  }

  /**
   * 更新警报的最后检查价格（用于去重）
   */
  updateLastCheckPrice(alert: AlertConfig, currentPrice: number): AlertConfig {
    const updatedMetadata = {
      ...alert.metadata,
      lastCheckPrice: currentPrice,
      lastTriggeredTime: new Date().toISOString()
    };

    return {
      ...alert,
      metadata: updatedMetadata
    };
  }

  /**
   * 检查是否需要跳过检测（基于冷却时间）
   */
  shouldSkipCheck(alert: AlertConfig): boolean {
    const metadata = alert.metadata as BreakthroughAlertMetadata & Record<string, any>;

    if (!metadata?.lastTriggeredTime) {
      return false;
    }

    const lastTriggered = new Date(metadata.lastTriggeredTime);
    const cooldownMs = alert.cooldownMs || 24 * 60 * 60 * 1000; // 默认24小时
    const timeSinceLastTrigger = Date.now() - lastTriggered.getTime();

    return timeSinceLastTrigger < cooldownMs;
  }

  /**
   * 生成突破警报消息
   */
  generateBreakthroughMessage(
    result: BreakthroughCheckResult,
    timeframe: string,
    isMultiBreakthrough: boolean = false
  ): string {
    const symbol = result.symbol.replace('USDT', '');
    const timeframeNames: Record<string, string> = {
      '1w': '7天', '7d': '7天',
      '1m': '30天', '30d': '30天',
      '6m': '180天', '180d': '180天',
      '1y': '52周', '52w': '52周',
      'all': '历史', 'ATH': '历史',
    };

    const timeframeName = timeframeNames[timeframe] || timeframe;
    const highDate = new Date(result.highTimestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    if (isMultiBreakthrough) {
      return `🚀🚀🚀 **市场突破警报** 🚀🚀🚀\n\n` +
        `⚡ **${symbol} 突破${timeframeName}历史高点！** ⚡\n\n` +
        `🎯 **突破详情:**\n` +
        `💰 当前价格: $${result.currentPrice.toFixed(6)}\n` +
        `📈 突破价格: $${result.timeframeHigh.toFixed(6)}\n` +
        `🚀 突破幅度: +${result.breakPercentage.toFixed(2)}%\n` +
        `⏰ 历史高点时间: ${highDate}\n\n` +
        `🔥🔥🔥 **重要市场信号！** 🔥🔥🔥\n` +
        `💡 建议立即关注市场动向`;
    } else {
      return `🚀🚀🚀 **历史突破警报** 🚀🚀🚀\n\n` +
        `⚡ **${symbol} 突破${timeframeName}历史最高价！** ⚡\n\n` +
        `🎯 **突破详情:**\n` +
        `💰 当前价格: $${result.currentPrice.toFixed(6)}\n` +
        `📈 突破价格: $${result.timeframeHigh.toFixed(6)}\n` +
        `🚀 突破幅度: +${result.breakPercentage.toFixed(2)}%\n` +
        `⏰ 历史高点时间: ${highDate}\n\n` +
        `🔥🔥🔥 **重要市场信号！** 🔥🔥🔥\n` +
        `💡 建议立即关注市场动向\n\n` +
        `🕒 检测时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`;
    }
  }
}

export const breakthroughDetectionService = new BreakthroughDetectionService();