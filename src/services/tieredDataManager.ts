import { binanceClient } from './binance';
import { volumeClassifier } from '../utils/volumeClassifier';
import { rankingAnalyzer } from './rankingAnalyzer';
import { log } from '../utils/logger';
import { FuturesTicker24hr, OpenInterestStats, FundingRate } from '../types/binance';

export interface TieredDataEntry<T> {
  data: T;
  lastUpdated: number;
  symbol: string;
  tier: 'high' | 'medium' | 'low';
  nextUpdateTime: number;
}

export interface DataRefreshStats {
  high: { requested: number; updated: number; skipped: number };
  medium: { requested: number; updated: number; skipped: number };
  low: { requested: number; updated: number; skipped: number };
  totalApiCalls: number;
  totalProcessingTime: number;
}

/**
 * Tiered data management system that optimizes API calls based on trading volume
 */
export class TieredDataManager {
  // Data storage with tier-based update tracking
  private tickerData = new Map<string, TieredDataEntry<FuturesTicker24hr>>();
  private fundingData = new Map<string, TieredDataEntry<FundingRate>>();
  private openInterestData = new Map<string, TieredDataEntry<OpenInterestStats[]>>();
  
  // Update frequency tracking
  private lastSymbolClassification = 0;
  private readonly classificationRefreshInterval = 30 * 60 * 1000; // 30 minutes
  
  // Stats tracking
  private refreshStats: DataRefreshStats = {
    high: { requested: 0, updated: 0, skipped: 0 },
    medium: { requested: 0, updated: 0, skipped: 0 },
    low: { requested: 0, updated: 0, skipped: 0 },
    totalApiCalls: 0,
    totalProcessingTime: 0
  };

  constructor() {
    log.info('TieredDataManager initialized');
    
    // Start periodic classification refresh
    this.startClassificationRefresh();
    
    // Start background data refresh
    this.startBackgroundRefresh();
    
    // Start ranking analyzer for hot symbols tracking
    rankingAnalyzer.start();
  }

  /**
   * Get 24hr ticker data with tier-based caching
   */
  async getTicker24hr(symbol: string): Promise<FuturesTicker24hr | null> {
    const upperSymbol = symbol.toUpperCase();
    const entry = this.tickerData.get(upperSymbol);
    
    // Check if we have fresh data
    if (entry && Date.now() < entry.nextUpdateTime) {
      log.debug(`Ticker data from tier cache: ${symbol} (tier: ${entry.tier})`);
      return entry.data;
    }
    
    // Need to fetch new data
    return await this.refreshTickerData(upperSymbol);
  }

  /**
   * Get funding rate data with tier-based caching
   */
  async getFundingRate(symbol: string): Promise<FundingRate | null> {
    const upperSymbol = symbol.toUpperCase();
    const entry = this.fundingData.get(upperSymbol);
    
    // Check if we have fresh data
    if (entry && Date.now() < entry.nextUpdateTime) {
      log.debug(`Funding data from tier cache: ${symbol} (tier: ${entry.tier})`);
      return entry.data;
    }
    
    // Need to fetch new data
    return await this.refreshFundingData(upperSymbol);
  }

  /**
   * Get open interest data with tier-based caching
   */
  async getOpenInterest(symbol: string, period: '1h' = '1h', limit: number = 30): Promise<OpenInterestStats[] | null> {
    const upperSymbol = symbol.toUpperCase();
    const cacheKey = `${upperSymbol}:${period}:${limit}`;
    const entry = this.openInterestData.get(cacheKey);
    
    // Check if we have fresh data
    if (entry && Date.now() < entry.nextUpdateTime) {
      log.debug(`OI data from tier cache: ${symbol} (tier: ${entry.tier})`);
      return entry.data;
    }
    
    // Need to fetch new data
    return await this.refreshOpenInterestData(upperSymbol, period, limit);
  }

  /**
   * Batch get ticker data for multiple symbols with intelligent tier handling
   */
  async getBatchTickers(symbols: string[]): Promise<Map<string, FuturesTicker24hr>> {
    const results = new Map<string, FuturesTicker24hr>();
    const symbolsToFetch: string[] = [];
    const now = Date.now();
    
    // Check which symbols need updates
    for (const symbol of symbols) {
      const upperSymbol = symbol.toUpperCase();
      const entry = this.tickerData.get(upperSymbol);
      
      if (entry && now < entry.nextUpdateTime) {
        // Use cached data
        results.set(upperSymbol, entry.data);
      } else {
        // Need fresh data
        symbolsToFetch.push(upperSymbol);
      }
    }
    
    if (symbolsToFetch.length > 0) {
      log.info(`Batch fetching ticker data for ${symbolsToFetch.length} symbols`);
      
      try {
        // Fetch all needed data in one API call
        const freshData = await binanceClient.getFutures24hrStatsMultiple();
        const symbolSet = new Set(symbolsToFetch);
        
        for (const ticker of freshData) {
          if (symbolSet.has(ticker.symbol)) {
            // Store in tier cache
            await this.storeTickerData(ticker.symbol, ticker);
            results.set(ticker.symbol, ticker);
          }
        }
        
        this.refreshStats.totalApiCalls++;
      } catch (error) {
        log.error('Failed to batch fetch ticker data', error);
      }
    }
    
    log.debug(`Batch ticker results: ${results.size} symbols (${symbols.length - symbolsToFetch.length} from cache, ${symbolsToFetch.length} fresh)`);
    return results;
  }

  /**
   * Get refresh statistics
   */
  getRefreshStats(): DataRefreshStats {
    return { ...this.refreshStats };
  }

  /**
   * Get cache status summary
   */
  getCacheStatus(): {
    tickers: { total: number; byTier: Record<string, number> };
    funding: { total: number; byTier: Record<string, number> };
    openInterest: { total: number; byTier: Record<string, number> };
    hotRankingSymbols: { count: number; symbols: string[] };
  } {
    const countByTier = (map: Map<string, TieredDataEntry<any>>) => {
      const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
      for (const entry of map.values()) {
        counts[entry.tier]++;
      }
      return counts;
    };
    
    const hotSymbols = volumeClassifier.getHotRankingSymbols();
    
    return {
      tickers: {
        total: this.tickerData.size,
        byTier: countByTier(this.tickerData)
      },
      funding: {
        total: this.fundingData.size,
        byTier: countByTier(this.fundingData)
      },
      openInterest: {
        total: this.openInterestData.size,
        byTier: countByTier(this.openInterestData)
      },
      hotRankingSymbols: {
        count: hotSymbols.length,
        symbols: hotSymbols.slice(0, 10) // Show first 10 for brevity
      }
    };
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.tickerData.clear();
    this.fundingData.clear();
    this.openInterestData.clear();
    
    // Reset stats
    this.refreshStats = {
      high: { requested: 0, updated: 0, skipped: 0 },
      medium: { requested: 0, updated: 0, skipped: 0 },
      low: { requested: 0, updated: 0, skipped: 0 },
      totalApiCalls: 0,
      totalProcessingTime: 0
    };
    
    log.info('Tiered data cache cleared');
  }

  // Private methods

  private async refreshTickerData(symbol: string): Promise<FuturesTicker24hr | null> {
    try {
      const ticker = await binanceClient.getFutures24hrStats(symbol);
      await this.storeTickerData(symbol, ticker);
      this.refreshStats.totalApiCalls++;
      
      return ticker;
    } catch (error) {
      log.error(`Failed to refresh ticker data for ${symbol}`, error);
      return null;
    }
  }

  private async refreshFundingData(symbol: string): Promise<FundingRate | null> {
    try {
      const funding = await binanceClient.getFundingRate(symbol);
      await this.storeFundingData(symbol, funding);
      this.refreshStats.totalApiCalls++;
      
      return funding;
    } catch (error) {
      log.error(`Failed to refresh funding data for ${symbol}`, error);
      return null;
    }
  }

  private async refreshOpenInterestData(symbol: string, period: '1h', limit: number): Promise<OpenInterestStats[] | null> {
    try {
      const oiData = await binanceClient.getOpenInterestStats(symbol, period, limit);
      const cacheKey = `${symbol}:${period}:${limit}`;
      await this.storeOpenInterestData(cacheKey, symbol, oiData);
      this.refreshStats.totalApiCalls++;
      
      return oiData;
    } catch (error) {
      log.error(`Failed to refresh OI data for ${symbol}`, error);
      return null;
    }
  }

  private async storeTickerData(symbol: string, data: FuturesTicker24hr): Promise<void> {
    const classification = volumeClassifier.getSymbolClassification(symbol);
    const tier = classification?.tier || 'low';
    const updateInterval = volumeClassifier.getUpdateInterval(symbol);
    
    const entry: TieredDataEntry<FuturesTicker24hr> = {
      data,
      lastUpdated: Date.now(),
      symbol,
      tier,
      nextUpdateTime: Date.now() + updateInterval
    };
    
    this.tickerData.set(symbol, entry);
    this.refreshStats[tier].updated++;
  }

  private async storeFundingData(symbol: string, data: FundingRate): Promise<void> {
    const classification = volumeClassifier.getSymbolClassification(symbol);
    const tier = classification?.tier || 'low';
    const updateInterval = volumeClassifier.getUpdateInterval(symbol);
    
    const entry: TieredDataEntry<FundingRate> = {
      data,
      lastUpdated: Date.now(),
      symbol,
      tier,
      nextUpdateTime: Date.now() + updateInterval
    };
    
    this.fundingData.set(symbol, entry);
    this.refreshStats[tier].updated++;
  }

  private async storeOpenInterestData(cacheKey: string, symbol: string, data: OpenInterestStats[]): Promise<void> {
    const classification = volumeClassifier.getSymbolClassification(symbol);
    const tier = classification?.tier || 'low';
    const updateInterval = volumeClassifier.getUpdateInterval(symbol);
    
    const entry: TieredDataEntry<OpenInterestStats[]> = {
      data,
      lastUpdated: Date.now(),
      symbol,
      tier,
      nextUpdateTime: Date.now() + updateInterval
    };
    
    this.openInterestData.set(cacheKey, entry);
    this.refreshStats[tier].updated++;
  }

  private startClassificationRefresh(): void {
    const refreshClassification = async () => {
      try {
        if (Date.now() - this.lastSymbolClassification > this.classificationRefreshInterval) {
          log.info('Refreshing volume classifications...');
          await volumeClassifier.classifyAllSymbols();
          this.lastSymbolClassification = Date.now();
          
          const stats = volumeClassifier.getVolumeStats();
          log.info('Volume classification refreshed', stats);
        }
      } catch (error) {
        log.error('Failed to refresh volume classifications', error);
      }
    };
    
    // Initial classification
    refreshClassification();
    
    // Periodic refresh every 30 minutes
    setInterval(refreshClassification, this.classificationRefreshInterval);
  }

  private startBackgroundRefresh(): void {
    const backgroundRefresh = async () => {
      try {
        const startTime = Date.now();
        
        // Get symbols that need updating by tier
        const lastUpdateTimes = new Map<string, number>();
        
        // Collect last update times from all data stores
        for (const [symbol, entry] of this.tickerData) {
          lastUpdateTimes.set(symbol, entry.lastUpdated);
        }
        
        const symbolsNeedingUpdate = volumeClassifier.getSymbolsNeedingUpdate(lastUpdateTimes);
        
        // Process high-volume symbols first (most important)
        if (symbolsNeedingUpdate.high.length > 0) {
          log.debug(`Background refresh: ${symbolsNeedingUpdate.high.length} high-volume symbols`);
          await this.refreshSymbolBatch(symbolsNeedingUpdate.high, 'high');
        }
        
        // Then medium-volume symbols
        if (symbolsNeedingUpdate.medium.length > 0) {
          log.debug(`Background refresh: ${symbolsNeedingUpdate.medium.length} medium-volume symbols`);
          await this.refreshSymbolBatch(symbolsNeedingUpdate.medium, 'medium');
        }
        
        // Finally low-volume symbols (least frequent)
        if (symbolsNeedingUpdate.low.length > 0) {
          log.debug(`Background refresh: ${symbolsNeedingUpdate.low.length} low-volume symbols`);
          await this.refreshSymbolBatch(symbolsNeedingUpdate.low, 'low');
        }
        
        const processingTime = Date.now() - startTime;
        this.refreshStats.totalProcessingTime += processingTime;
        
        if (symbolsNeedingUpdate.high.length + symbolsNeedingUpdate.medium.length + symbolsNeedingUpdate.low.length > 0) {
          log.info('Background refresh completed', {
            processingTime: `${processingTime}ms`,
            updated: {
              high: symbolsNeedingUpdate.high.length,
              medium: symbolsNeedingUpdate.medium.length,
              low: symbolsNeedingUpdate.low.length
            }
          });
        }
        
      } catch (error) {
        log.error('Background refresh failed', error);
      }
    };
    
    // Run background refresh every 30 seconds
    setInterval(backgroundRefresh, 30 * 1000);
  }

  private async refreshSymbolBatch(symbols: string[], tier: 'high' | 'medium' | 'low'): Promise<void> {
    if (symbols.length === 0) return;
    
    this.refreshStats[tier].requested += symbols.length;
    
    try {
      // Use batch API call for efficiency
      const freshData = await binanceClient.getFutures24hrStatsMultiple();
      const symbolSet = new Set(symbols);
      
      let updated = 0;
      for (const ticker of freshData) {
        if (symbolSet.has(ticker.symbol)) {
          await this.storeTickerData(ticker.symbol, ticker);
          updated++;
        }
      }
      
      this.refreshStats[tier].updated += updated;
      this.refreshStats[tier].skipped += symbols.length - updated;
      this.refreshStats.totalApiCalls++;
      
    } catch (error) {
      log.error(`Failed to refresh ${tier}-tier symbols`, error);
      this.refreshStats[tier].skipped += symbols.length;
    }
  }
}

// Export singleton instance
export const tieredDataManager = new TieredDataManager();