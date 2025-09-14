import { binanceClient } from '../services/binance';
import { log } from './logger';
import { marketDataCache } from './cache';

export interface VolumeClassification {
  symbol: string;
  volume24h: number;
  volumeUSDT: number;
  tier: 'high' | 'medium' | 'low';
  lastUpdated: number;
}

export interface VolumeTierConfig {
  high: {
    minVolumeUSDT: number;
    updateIntervalMs: number;
  };
  medium: {
    minVolumeUSDT: number;
    updateIntervalMs: number;
  };
  low: {
    maxVolumeUSDT: number;
    updateIntervalMs: number;
  };
}

/**
 * Volume-based contract classification system
 * Categorizes futures contracts by trading volume and assigns update frequencies
 */
export class VolumeClassifier {
  private volumeData = new Map<string, VolumeClassification>();
  private lastClassificationUpdate = 0;
  
  // Volume thresholds in USDT (24h volume)
  private readonly config: VolumeTierConfig = {
    high: {
      minVolumeUSDT: 50_000_000, // 50M USDT+
      updateIntervalMs: 30 * 1000 // 30 seconds
    },
    medium: {
      minVolumeUSDT: 10_000_000, // 10M-50M USDT
      updateIntervalMs: 5 * 60 * 1000 // 5 minutes
    },
    low: {
      maxVolumeUSDT: 10_000_000, // <10M USDT
      updateIntervalMs: 4 * 60 * 60 * 1000 // 4 hours
    }
  };

  constructor() {
    log.info('VolumeClassifier initialized', {
      highVolumeThreshold: `${this.config.high.minVolumeUSDT / 1_000_000}M USDT`,
      mediumVolumeThreshold: `${this.config.medium.minVolumeUSDT / 1_000_000}M USDT`,
      updateIntervals: {
        high: `${this.config.high.updateIntervalMs / 1000}s`,
        medium: `${this.config.medium.updateIntervalMs / 60000}min`,
        low: `${this.config.low.updateIntervalMs / 3600000}h`
      }
    });
  }

  /**
   * Classify all futures symbols by trading volume
   */
  async classifyAllSymbols(): Promise<Map<string, VolumeClassification>> {
    const cacheKey = 'volume:classifications';
    const cacheTTL = 30 * 60 * 1000; // 30 minutes
    
    // Check cache first
    const cached = await marketDataCache.get(cacheKey);
    if (cached && Date.now() - this.lastClassificationUpdate < cacheTTL) {
      log.debug('Using cached volume classifications');
      this.volumeData = new Map(Object.entries(cached));
      return this.volumeData;
    }

    try {
      log.info('Starting volume classification for all futures symbols...');
      
      // Get all futures 24hr stats
      const stats = await binanceClient.getFutures24hrStatsMultiple();
      const classifications = new Map<string, VolumeClassification>();
      
      let highVolume = 0, mediumVolume = 0, lowVolume = 0;
      
      for (const stat of stats) {
        const symbol = stat.symbol;
        const volume24h = parseFloat(stat.volume);
        const lastPrice = parseFloat(stat.lastPrice);
        const volumeUSDT = volume24h * lastPrice;
        
        let tier: VolumeClassification['tier'];
        if (volumeUSDT >= this.config.high.minVolumeUSDT) {
          tier = 'high';
          highVolume++;
        } else if (volumeUSDT >= this.config.medium.minVolumeUSDT) {
          tier = 'medium';
          mediumVolume++;
        } else {
          tier = 'low';
          lowVolume++;
        }
        
        const classification: VolumeClassification = {
          symbol,
          volume24h,
          volumeUSDT,
          tier,
          lastUpdated: Date.now()
        };
        
        classifications.set(symbol, classification);
      }
      
      this.volumeData = classifications;
      this.lastClassificationUpdate = Date.now();
      
      // Cache the result
      const cacheData = Object.fromEntries(classifications);
      await marketDataCache.set(cacheKey, cacheData, cacheTTL);
      
      log.info('Volume classification complete', {
        total: stats.length,
        high: highVolume,
        medium: mediumVolume,
        low: lowVolume,
        highVolumeExamples: this.getTopVolumeSymbols('high', 5),
        lowVolumeExamples: this.getTopVolumeSymbols('low', 5)
      });
      
      return classifications;
      
    } catch (error) {
      log.error('Failed to classify symbols by volume', error);
      throw error;
    }
  }

  /**
   * Get volume classification for a specific symbol
   */
  getSymbolClassification(symbol: string): VolumeClassification | null {
    return this.volumeData.get(symbol.toUpperCase()) || null;
  }

  /**
   * Get all symbols in a specific volume tier
   */
  getSymbolsByTier(tier: 'high' | 'medium' | 'low'): string[] {
    return Array.from(this.volumeData.values())
      .filter(classification => classification.tier === tier)
      .map(classification => classification.symbol);
  }

  /**
   * Get update interval for a symbol based on its volume tier
   */
  getUpdateInterval(symbol: string): number {
    const classification = this.getSymbolClassification(symbol);
    if (!classification) {
      // Default to low volume interval for unknown symbols
      return this.config.low.updateIntervalMs;
    }

    switch (classification.tier) {
      case 'high':
        return this.config.high.updateIntervalMs;
      case 'medium':
        return this.config.medium.updateIntervalMs;
      case 'low':
        return this.config.low.updateIntervalMs;
      default:
        return this.config.low.updateIntervalMs;
    }
  }

  /**
   * Check if a symbol needs data update based on its tier and last update time
   */
  needsUpdate(symbol: string, lastUpdateTime: number): boolean {
    const updateInterval = this.getUpdateInterval(symbol);
    return Date.now() - lastUpdateTime >= updateInterval;
  }

  /**
   * Get symbols that need updating right now
   */
  getSymbolsNeedingUpdate(lastUpdateTimes: Map<string, number>): {
    high: string[];
    medium: string[];
    low: string[];
  } {
    const result = { high: [] as string[], medium: [] as string[], low: [] as string[] };
    
    for (const [symbol, classification] of this.volumeData) {
      const lastUpdate = lastUpdateTimes.get(symbol) || 0;
      if (this.needsUpdate(symbol, lastUpdate)) {
        result[classification.tier].push(symbol);
      }
    }
    
    return result;
  }

  /**
   * Get top volume symbols for a tier (for logging/debugging)
   */
  private getTopVolumeSymbols(tier: 'high' | 'medium' | 'low', limit: number = 10): string[] {
    return Array.from(this.volumeData.values())
      .filter(classification => classification.tier === tier)
      .sort((a, b) => b.volumeUSDT - a.volumeUSDT)
      .slice(0, limit)
      .map(classification => `${classification.symbol}(${(classification.volumeUSDT / 1_000_000).toFixed(1)}M)`);
  }

  /**
   * Get volume statistics summary
   */
  getVolumeStats(): {
    totalSymbols: number;
    high: { count: number; totalVolume: number };
    medium: { count: number; totalVolume: number };
    low: { count: number; totalVolume: number };
  } {
    const stats = {
      totalSymbols: this.volumeData.size,
      high: { count: 0, totalVolume: 0 },
      medium: { count: 0, totalVolume: 0 },
      low: { count: 0, totalVolume: 0 }
    };
    
    for (const classification of this.volumeData.values()) {
      stats[classification.tier].count++;
      stats[classification.tier].totalVolume += classification.volumeUSDT;
    }
    
    return stats;
  }

  /**
   * Update classification config (for testing or fine-tuning)
   */
  updateConfig(newConfig: Partial<VolumeTierConfig>): void {
    if (newConfig.high) {
      Object.assign(this.config.high, newConfig.high);
    }
    if (newConfig.medium) {
      Object.assign(this.config.medium, newConfig.medium);
    }
    if (newConfig.low) {
      Object.assign(this.config.low, newConfig.low);
    }
    
    log.info('Volume classifier config updated', this.config);
  }

}

// Export singleton instance
export const volumeClassifier = new VolumeClassifier();