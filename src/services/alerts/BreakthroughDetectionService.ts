import { AlertConfig, AlertType, BreakthroughCheckResult, BreakthroughAlertMetadata, MarketData } from './IAlertService';
import { historicalHighCache } from '../historicalHighCacheV2';
import { log } from '../../utils/logger';

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

      // 从历史高价缓存获取数据
      const historyData = historicalHighCache.queryHistoricalHigh(normalizedSymbol, timeframe);

      if (!historyData) {
        log.debug(`No historical data found for ${normalizedSymbol} ${timeframe}`);
        return null;
      }

      const { highPrice, highTimestamp } = historyData;

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

      // 获取所有币种的排名数据（这包含了当前价格和历史高点）
      const rankings = historicalHighCache.getRankingByProximityToHigh(timeframe, 500);

      for (const ranking of rankings) {
        if (!ranking || !ranking.symbol || !ranking.currentPrice || !ranking.highPrice) {
          continue;
        }

        // 检查是否突破（当前价格超过历史高点）
        if (ranking.currentPrice > ranking.highPrice) {
          const breakAmount = ranking.currentPrice - ranking.highPrice;
          const breakPercentage = ((ranking.currentPrice - ranking.highPrice) / ranking.highPrice) * 100;

          // 只有突破幅度超过最小阈值才算有效突破
          if (breakPercentage >= minBreakPercentage) {
            breakthroughs.push({
              symbol: ranking.symbol,
              currentPrice: ranking.currentPrice,
              timeframeHigh: ranking.highPrice,
              highTimestamp: ranking.highTimestamp,
              isBreakthrough: true,
              breakAmount,
              breakPercentage
            });
          }
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
      '1w': '1周',
      '1m': '1个月',
      '6m': '6个月',
      '1y': '1年',
      'all': '历史'
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