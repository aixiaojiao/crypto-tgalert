import { binanceClient } from './binance';
import { filterTradingPairs } from '../config/tokenLists';
import { log } from '../utils/logger';

/**
 * Ranking analyzer that identifies hot symbols from various rankings
 * and updates the volume classifier to ensure real-time updates for ranking symbols
 */
export class RankingAnalyzer {
  private refreshInterval = 5 * 60 * 1000; // 5 minutes
  private isRunning = false;
  
  constructor() {
    log.info('RankingAnalyzer initialized');
  }

  /**
   * Start periodic ranking analysis
   */
  start(): void {
    if (this.isRunning) {
      log.warn('RankingAnalyzer is already running');
      return;
    }
    
    this.isRunning = true;
    log.info('Starting RankingAnalyzer periodic refresh');
    
    // Initial analysis
    this.analyzeRankings();
    
    // Periodic analysis
    setInterval(() => {
      this.analyzeRankings();
    }, this.refreshInterval);
  }

  /**
   * Stop the analyzer
   */
  stop(): void {
    this.isRunning = false;
    log.info('RankingAnalyzer stopped');
  }

  /**
   * Analyze current rankings and update hot symbols
   * Called both by background refresh and on-demand by ranking queries
   */
  async analyzeRankings(triggeredBy: 'background' | 'user-query' = 'background'): Promise<void> {
    try {
      log.debug('Starting ranking analysis...');
      const startTime = Date.now();
      
      // Get all necessary data
      const [gainersSymbols, losersSymbols, fundingSymbols] = await Promise.all([
        this.getTopGainers(),
        this.getTopLosers(), 
        this.getTopNegativeFunding()
      ]);

      const analysisTime = Date.now() - startTime;
      log.info('Ranking analysis completed', {
        triggeredBy,
        gainers: gainersSymbols.length,
        losers: losersSymbols.length,
        funding: fundingSymbols.length,
        totalHotSymbols: gainersSymbols.length + losersSymbols.length + fundingSymbols.length,
        analysisTime: `${analysisTime}ms`
      });
      
    } catch (error) {
      log.error('Failed to analyze rankings', error);
    }
  }

  /**
   * Get top gainers symbols (TOP 10)
   */
  private async getTopGainers(): Promise<string[]> {
    try {
      const allStats = await binanceClient.getFutures24hrStatsMultiple();
      const validSymbols = filterTradingPairs(allStats.map(s => s.symbol));
      
      const gainers = allStats
        .filter(stat => {
          return parseFloat(stat.priceChangePercent) > 0 && 
                 validSymbols.includes(stat.symbol) &&
                 parseFloat(stat.volume) > 10000; // Filter low volume tokens
        })
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
        .slice(0, 10)
        .map(stat => stat.symbol);
      
      log.debug('Top gainers identified', { count: gainers.length, symbols: gainers.slice(0, 5) });
      return gainers;
      
    } catch (error) {
      log.error('Failed to get top gainers', error);
      return [];
    }
  }

  /**
   * Get top losers symbols (TOP 10)
   */
  private async getTopLosers(): Promise<string[]> {
    try {
      const allStats = await binanceClient.getFutures24hrStatsMultiple();
      const validSymbols = filterTradingPairs(allStats.map(s => s.symbol));
      
      const losers = allStats
        .filter(stat => {
          return parseFloat(stat.priceChangePercent) < 0 && 
                 validSymbols.includes(stat.symbol) &&
                 parseFloat(stat.volume) > 10000; // Filter low volume tokens
        })
        .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
        .slice(0, 10)
        .map(stat => stat.symbol);
      
      log.debug('Top losers identified', { count: losers.length, symbols: losers.slice(0, 5) });
      return losers;
      
    } catch (error) {
      log.error('Failed to get top losers', error);
      return [];
    }
  }

  /**
   * Get top negative funding rate symbols (TOP 15)
   */
  private async getTopNegativeFunding(): Promise<string[]> {
    try {
      const fundingRates = await binanceClient.getAllFundingRates();
      const validSymbols = filterTradingPairs(fundingRates.map(r => r.symbol));
      
      // Filter and deduplicate funding rates
      const filteredRates = fundingRates
        .filter(rate => validSymbols.includes(rate.symbol))
        .reduce((acc, rate) => {
          const key = rate.symbol;
          if (!acc.has(key)) {
            acc.set(key, rate);
          }
          return acc;
        }, new Map());

      // Get top negative funding rates
      const negativeRates = Array.from(filteredRates.values())
        .filter(rate => parseFloat(rate.fundingRate) < 0)
        .sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate))
        .slice(0, 15)
        .map(rate => rate.symbol);
      
      log.debug('Top negative funding identified', { count: negativeRates.length, symbols: negativeRates.slice(0, 5) });
      return negativeRates;
      
    } catch (error) {
      log.error('Failed to get top negative funding', error);
      return [];
    }
  }

  /**
   * Force refresh rankings (for manual trigger)
   */
  async forceRefresh(): Promise<void> {
    log.info('Force refreshing rankings...');
    await this.analyzeRankings();
  }

  /**
   * Get current analysis status
   */
  getStatus(): {
    isRunning: boolean;
    refreshInterval: number;
    lastUpdate: number;
  } {
    return {
      isRunning: this.isRunning,
      refreshInterval: this.refreshInterval,
      lastUpdate: 0 // Would need to track this separately if needed
    };
  }
}

// Export singleton instance
export const rankingAnalyzer = new RankingAnalyzer();