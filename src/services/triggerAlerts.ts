import { BinanceClient } from './binance';
import { TriggerAlertModel, GainersRanking, FundingRanking, OIRanking, RankingChange } from '../models/TriggerAlert';
import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { getTokenRiskLevel, getRiskIcon, filterTradingPairs, isRiskyToken } from '../config/tokenLists';
import { formatPriceWithSeparators, formatPriceChange } from '../utils/priceFormatter';

export interface TriggerAlertStats {
  gainersEnabled: boolean;
  fundingEnabled: boolean;
  oi1hEnabled: boolean;
  oi4hEnabled: boolean;
  oi24hEnabled: boolean;
  gainersLastCheck: Date | null;
  fundingLastCheck: Date | null;
  oi1hLastCheck: Date | null;
  oi4hLastCheck: Date | null;
  oi24hLastCheck: Date | null;
  gainersInterval: NodeJS.Timeout | null;
  fundingInterval: NodeJS.Timeout | null;
  oi1hInterval: NodeJS.Timeout | null;
  oi4hInterval: NodeJS.Timeout | null;
  oi24hInterval: NodeJS.Timeout | null;
}

export class TriggerAlertService {
  private binance: BinanceClient;
  private telegramBot: TelegramBot | null = null;
  
  private gainersInterval: NodeJS.Timeout | null = null;
  private fundingInterval: NodeJS.Timeout | null = null;
  private oi1hInterval: NodeJS.Timeout | null = null;
  private oi4hInterval: NodeJS.Timeout | null = null;
  private oi24hInterval: NodeJS.Timeout | null = null;
  
  private gainersEnabled: boolean = false;
  private fundingEnabled: boolean = false;
  private oi1hEnabled: boolean = false;
  private oi4hEnabled: boolean = false;
  private oi24hEnabled: boolean = false;
  
  // Concurrency control flags to prevent race conditions
  private gainersCheckInProgress: boolean = false;
  private fundingCheckInProgress: boolean = false;
  private oi1hCheckInProgress: boolean = false;
  private oi4hCheckInProgress: boolean = false;
  private oi24hCheckInProgress: boolean = false;
  
  private readonly GAINERS_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly FUNDING_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private readonly OI1H_CHECK_INTERVAL = 3 * 60 * 1000; // 3 minutes
  private readonly OI4H_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes
  private readonly OI24H_CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes
  
  private gainersLastCheck: Date | null = null;
  private fundingLastCheck: Date | null = null;
  private oi1hLastCheck: Date | null = null;
  private oi4hLastCheck: Date | null = null;
  private oi24hLastCheck: Date | null = null;

  /**
   * Get OI check in progress flag accessor for a period
   */
  private getOICheckInProgress(period: '1h' | '4h' | '1d'): { get: () => boolean; set: (value: boolean) => void } {
    switch (period) {
      case '1h':
        return {
          get: () => this.oi1hCheckInProgress,
          set: (value: boolean) => { this.oi1hCheckInProgress = value; }
        };
      case '4h':
        return {
          get: () => this.oi4hCheckInProgress,
          set: (value: boolean) => { this.oi4hCheckInProgress = value; }
        };
      case '1d':
        return {
          get: () => this.oi24hCheckInProgress,
          set: (value: boolean) => { this.oi24hCheckInProgress = value; }
        };
    }
  }

  /**
   * 检查推送是否应该被触发（排除风险代币引起的推送）
   * @param significantChanges 重要变化列表
   * @param majorMoveThreshold 主要变动阈值
   * @returns 是否应该触发推送
   */
  private shouldTriggerPush(significantChanges: RankingChange[], majorMoveThreshold: number): boolean {
    // 找出所有触发推送的变化（新进入 + 主要变动）
    const triggeringChanges = significantChanges.filter(change => 
      change.change === 'new' || 
      (change.changeValue && Math.abs(change.changeValue) >= majorMoveThreshold)
    );
    
    if (triggeringChanges.length === 0) return false;
    
    // 检查触发变化中有多少来自风险代币
    const riskyTriggers = triggeringChanges.filter(change => isRiskyToken(change.symbol));
    
    // 如果所有触发都来自风险代币，则不推送
    if (riskyTriggers.length === triggeringChanges.length) {
      log.debug(`Push blocked: all ${triggeringChanges.length} triggers are from risky tokens: ${riskyTriggers.map(c => c.symbol).join(', ')}`);
      return false;
    }
    
    // 有非风险代币触发，正常推送
    const safeTriggers = triggeringChanges.filter(change => !isRiskyToken(change.symbol));
    log.debug(`Push allowed: ${safeTriggers.length} safe triggers, ${riskyTriggers.length} risky triggers`);
    return true;
  }

  constructor(binanceClient?: BinanceClient, telegramBot?: TelegramBot) {
    this.binance = binanceClient || new BinanceClient();
    this.telegramBot = telegramBot || null;
    
    log.info('TriggerAlertService initialized', {
      gainersInterval: this.GAINERS_CHECK_INTERVAL / 1000,
      fundingInterval: this.FUNDING_CHECK_INTERVAL / 1000,
      oi1hInterval: this.OI1H_CHECK_INTERVAL / 1000,
      oi4hInterval: this.OI4H_CHECK_INTERVAL / 1000,
      oi24hInterval: this.OI24H_CHECK_INTERVAL / 1000
    });
  }

  /**
   * Set Telegram bot instance
   */
  setTelegramBot(telegramBot: TelegramBot): void {
    this.telegramBot = telegramBot;
    log.info('TelegramBot instance set in TriggerAlertService');
  }

  /**
   * Initialize database tables
   */
  async initialize(): Promise<void> {
    try {
      await TriggerAlertModel.initializeTables();
      log.info('TriggerAlertService initialized successfully');
    } catch (error) {
      log.error('Failed to initialize TriggerAlertService', error);
      throw error;
    }
  }

  /**
   * Start gainers monitoring
   */
  async startGainersMonitoring(): Promise<void> {
    if (this.gainersEnabled) {
      log.warn('Gainers monitoring is already enabled');
      return;
    }

    log.info('Starting gainers trigger monitoring');
    this.gainersEnabled = true;
    
    // Perform initial check
    await this.checkGainers();
    
    // Set up interval
    this.gainersInterval = setInterval(async () => {
      await this.checkGainers();
    }, this.GAINERS_CHECK_INTERVAL);

    log.info(`Gainers monitoring started with ${this.GAINERS_CHECK_INTERVAL / 60000}min interval`);
  }

  /**
   * Stop gainers monitoring
   */
  stopGainersMonitoring(): void {
    if (!this.gainersEnabled) {
      log.warn('Gainers monitoring is not enabled');
      return;
    }

    log.info('Stopping gainers trigger monitoring');
    
    if (this.gainersInterval) {
      clearInterval(this.gainersInterval);
      this.gainersInterval = null;
    }
    
    this.gainersEnabled = false;
    log.info('Gainers monitoring stopped');
  }

  /**
   * Start funding rates monitoring
   */
  async startFundingMonitoring(): Promise<void> {
    if (this.fundingEnabled) {
      log.warn('Funding monitoring is already enabled');
      return;
    }

    log.info('Starting funding rates trigger monitoring');
    this.fundingEnabled = true;
    
    // Perform initial check
    await this.checkFunding();
    
    // Set up interval
    this.fundingInterval = setInterval(async () => {
      await this.checkFunding();
    }, this.FUNDING_CHECK_INTERVAL);

    log.info(`Funding rates monitoring started with ${this.FUNDING_CHECK_INTERVAL / 60000}min interval`);
  }

  /**
   * Stop funding rates monitoring
   */
  stopFundingMonitoring(): void {
    if (!this.fundingEnabled) {
      log.warn('Funding monitoring is not enabled');
      return;
    }

    log.info('Stopping funding rates trigger monitoring');
    
    if (this.fundingInterval) {
      clearInterval(this.fundingInterval);
      this.fundingInterval = null;
    }
    
    this.fundingEnabled = false;
    log.info('Funding rates monitoring stopped');
  }

  /**
   * Start OI 1h monitoring
   */
  async startOI1hMonitoring(): Promise<void> {
    if (this.oi1hEnabled) {
      log.warn('OI 1h monitoring is already enabled');
      return;
    }

    log.info('Starting OI 1h trigger monitoring');
    this.oi1hEnabled = true;
    
    // Perform initial check
    await this.checkOI('1h');
    
    // Set up interval
    this.oi1hInterval = setInterval(async () => {
      await this.checkOI('1h');
    }, this.OI1H_CHECK_INTERVAL);

    log.info(`OI 1h monitoring started with ${this.OI1H_CHECK_INTERVAL / 60000}min interval`);
  }

  /**
   * Stop OI 1h monitoring
   */
  stopOI1hMonitoring(): void {
    if (!this.oi1hEnabled) {
      log.warn('OI 1h monitoring is not enabled');
      return;
    }

    log.info('Stopping OI 1h trigger monitoring');
    
    if (this.oi1hInterval) {
      clearInterval(this.oi1hInterval);
      this.oi1hInterval = null;
    }
    
    this.oi1hEnabled = false;
    log.info('OI 1h monitoring stopped');
  }

  /**
   * Start OI 4h monitoring
   */
  async startOI4hMonitoring(): Promise<void> {
    if (this.oi4hEnabled) {
      log.warn('OI 4h monitoring is already enabled');
      return;
    }

    log.info('Starting OI 4h trigger monitoring');
    this.oi4hEnabled = true;
    
    // Perform initial check
    await this.checkOI('4h');
    
    // Set up interval
    this.oi4hInterval = setInterval(async () => {
      await this.checkOI('4h');
    }, this.OI4H_CHECK_INTERVAL);

    log.info(`OI 4h monitoring started with ${this.OI4H_CHECK_INTERVAL / 60000}min interval`);
  }

  /**
   * Stop OI 4h monitoring
   */
  stopOI4hMonitoring(): void {
    if (!this.oi4hEnabled) {
      log.warn('OI 4h monitoring is not enabled');
      return;
    }

    log.info('Stopping OI 4h trigger monitoring');
    
    if (this.oi4hInterval) {
      clearInterval(this.oi4hInterval);
      this.oi4hInterval = null;
    }
    
    this.oi4hEnabled = false;
    log.info('OI 4h monitoring stopped');
  }

  /**
   * Start OI 24h monitoring
   */
  async startOI24hMonitoring(): Promise<void> {
    if (this.oi24hEnabled) {
      log.warn('OI 24h monitoring is already enabled');
      return;
    }

    log.info('Starting OI 24h trigger monitoring');
    this.oi24hEnabled = true;
    
    // Perform initial check
    await this.checkOI('1d');
    
    // Set up interval
    this.oi24hInterval = setInterval(async () => {
      await this.checkOI('1d');
    }, this.OI24H_CHECK_INTERVAL);

    log.info(`OI 24h monitoring started with ${this.OI24H_CHECK_INTERVAL / 60000}min interval`);
  }

  /**
   * Stop OI 24h monitoring
   */
  stopOI24hMonitoring(): void {
    if (!this.oi24hEnabled) {
      log.warn('OI 24h monitoring is not enabled');
      return;
    }

    log.info('Stopping OI 24h trigger monitoring');
    
    if (this.oi24hInterval) {
      clearInterval(this.oi24hInterval);
      this.oi24hInterval = null;
    }
    
    this.oi24hEnabled = false;
    log.info('OI 24h monitoring stopped');
  }

  /**
   * Stop all monitoring
   */
  stopAllMonitoring(): void {
    this.stopGainersMonitoring();
    this.stopFundingMonitoring();
    this.stopOI1hMonitoring();
    this.stopOI4hMonitoring();
    this.stopOI24hMonitoring();
    
    // Reset all check-in-progress flags to prevent stuck states
    this.gainersCheckInProgress = false;
    this.fundingCheckInProgress = false;
    this.oi1hCheckInProgress = false;
    this.oi4hCheckInProgress = false;
    this.oi24hCheckInProgress = false;
    
    log.info('All monitoring stopped and state reset');
  }

  /**
   * Check gainers and send notifications if needed
   */
  private async checkGainers(): Promise<void> {
    // Prevent concurrent execution to avoid race conditions
    if (this.gainersCheckInProgress) {
      log.debug('Gainers check already in progress, skipping...');
      return;
    }
    
    this.gainersCheckInProgress = true;
    
    try {
      log.debug('Checking gainers for changes...');
      
      // Get current 24hr stats
      const stats = await this.binance.getFutures24hrStatsMultiple();
      const validSymbols = filterTradingPairs(stats.map(s => s.symbol));
      const filteredStats = stats.filter(s => validSymbols.includes(s.symbol));
      
      // Sort by price change percentage (top gainers)
      const sortedStats = filteredStats
        .filter(s => parseFloat(s.priceChangePercent) > 0)
        .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
        .slice(0, 10);

      // Convert to rankings format
      const currentRankings: GainersRanking[] = sortedStats.map((stat, index) => ({
        symbol: stat.symbol,
        position: index + 1,
        price_change_percent: parseFloat(stat.priceChangePercent)
      }));

      // Get previous rankings for comparison
      const previousRankings = await TriggerAlertModel.getPreviousGainersRankings();

      // Compare and detect changes
      const changes = TriggerAlertModel.compareRankings(currentRankings, previousRankings);
      
      // Debug logging
      log.debug(`Gainers comparison - Current: ${currentRankings.length}, Previous: ${previousRankings.length}`);
      log.debug(`Current symbols: ${currentRankings.map(r => r.symbol).join(',')}`);
      log.debug(`Previous symbols: ${previousRankings.map(r => r.symbol).join(',')}`);
      log.debug(`Changes: ${changes.map(c => `${c.symbol}:${c.change}`).join(', ')}`);
      
      // Check if there are significant changes (new entries or major moves)
      const significantChanges = changes.filter(change => 
        change.change === 'new' || 
        (change.change === 'up' && (change.changeValue || 0) >= 3) ||
        (change.change === 'down' && (change.changeValue || 0) >= 3)
      );

      this.gainersLastCheck = new Date();

      // Send notifications if there are significant changes
      if (significantChanges.length > 0 && previousRankings.length > 0) {
        // Additional filter: only send if there are truly new symbols or major ranking changes
        const hasMajorMoves = significantChanges.some(change => 
          (change.change === 'up' && (change.changeValue || 0) >= 5) ||
          (change.change === 'down' && (change.changeValue || 0) >= 5)
        );
        
        // Extra validation: ensure "new" symbols are truly not in previous rankings
        const newSymbolChanges = significantChanges.filter(change => change.change === 'new');
        log.debug(`Found ${newSymbolChanges.length} symbols marked as "new": ${newSymbolChanges.map(c => c.symbol).join(',')}`);
        
        const validNewSymbols = significantChanges.filter(change => {
          if (change.change !== 'new') return true;
          const isActuallyNew = !previousRankings.some(prev => prev.symbol === change.symbol);
          log.debug(`Validating ${change.symbol}: actually new? ${isActuallyNew}`);
          if (!isActuallyNew) {
            log.warn(`False "new" symbol detected: ${change.symbol} exists in previous rankings, skipping notification`);
          }
          return isActuallyNew;
        });
        
        const hasActualNewSymbols = validNewSymbols.some(change => change.change === 'new');
        
        // 检查是否应该触发推送（排除风险代币触发的推送）
        const shouldPush = (hasActualNewSymbols || hasMajorMoves) && 
                          this.shouldTriggerPush(validNewSymbols, 5); // 主要变动阈值为5
        
        if (shouldPush) {
          await this.sendGainersNotification(currentRankings, validNewSymbols);
          log.info(`Gainers notification sent: ${hasActualNewSymbols ? 'new symbols' : ''} ${hasMajorMoves ? 'major moves' : ''}`);
        } else {
          if (hasActualNewSymbols || hasMajorMoves) {
            log.info('Gainers push blocked: all triggers from risky tokens');
          } else {
            log.debug('Gainers changes detected but not significant enough for notification');
          }
        }
      }

      // Save current rankings AFTER notification processing is complete
      await TriggerAlertModel.saveGainersRankings(currentRankings);

      log.debug(`Gainers check completed: ${significantChanges.length} significant changes detected`);
      
    } catch (error) {
      log.error('Failed to check gainers', error);
    } finally {
      this.gainersCheckInProgress = false;
    }
  }

  /**
   * Check OI and send notifications if needed
   */
  private async checkOI(period: '1h' | '4h' | '1d'): Promise<void> {
    // Prevent concurrent execution to avoid race conditions
    const checkInProgress = this.getOICheckInProgress(period);
    
    if (checkInProgress.get()) {
      log.debug(`OI ${period} check already in progress, skipping...`);
      return;
    }
    
    checkInProgress.set(true);
    
    try {
      log.debug(`Checking OI ${period} for changes...`);
      
      // Get current OI stats for all symbols
      const allOIStats = await this.binance.getAllOpenInterestStats(period);
      const validSymbols = filterTradingPairs(allOIStats.map(s => s.symbol));
      const filteredStats = allOIStats.filter(s => validSymbols.includes(s.symbol));
      
      // For proper OI change calculation, we need historical data
      // Since we're getting current stats, we'll use a different approach:
      // Get individual symbol OI histories for the top volume symbols to calculate actual changes
      const topVolumeSymbols = filteredStats
        .sort((a, b) => parseFloat(b.sumOpenInterestValue) - parseFloat(a.sumOpenInterestValue))
        .slice(0, 50) // Focus on top 50 by volume for performance
        .map(s => s.symbol);

      const oiWithChanges = [];
      
      for (const symbol of topVolumeSymbols) {
        try {
          // Get historical OI data for this symbol
          const oiHistory = await this.binance.getOpenInterestStats(symbol, period, 10);
          
          if (oiHistory.length >= 2) {
            const latest = oiHistory[oiHistory.length - 1];
            const previous = oiHistory[oiHistory.length - 2];
            
            const latestValue = parseFloat(latest.sumOpenInterestValue);
            const previousValue = parseFloat(previous.sumOpenInterestValue);
            
            if (previousValue > 0) {
              const changePercent = ((latestValue - previousValue) / previousValue) * 100;
              
              oiWithChanges.push({
                symbol: symbol,
                oiValue: latestValue,
                oiChangePercent: changePercent
              });
            }
          }
        } catch (error) {
          log.debug(`Failed to get OI history for ${symbol}`, error);
        }
      }
      
      // Sort by absolute change percentage to get top movers (for display)
      const allOIChanges = oiWithChanges
        .sort((a, b) => Math.abs(b.oiChangePercent) - Math.abs(a.oiChangePercent))
        .slice(0, 10);

      // Also keep track of significant changes (for push decision)
      const significantOIChanges = oiWithChanges
        .filter(stat => Math.abs(stat.oiChangePercent) > 5) // Only significant changes
        .sort((a, b) => Math.abs(b.oiChangePercent) - Math.abs(a.oiChangePercent))
        .slice(0, 10);

      // Convert to rankings format using ALL top 10, not just significant changes
      const currentRankings: OIRanking[] = allOIChanges.map((stat, index) => ({
        symbol: stat.symbol,
        position: index + 1,
        oi_change_percent: stat.oiChangePercent,
        oi_value: stat.oiValue,
        period
      }));

      // Get previous rankings for comparison
      const previousRankings = await TriggerAlertModel.getPreviousOIRankings(period);

      // Additional safety check: if we just saved data recently, ensure we have valid comparison data
      if (previousRankings.length > 0) {
        // Verify the previous rankings are actually from a different time period
        const timeSinceLastCheck = period === '1h' ? this.oi1hLastCheck :
                                  period === '4h' ? this.oi4hLastCheck : this.oi24hLastCheck;
        
        if (timeSinceLastCheck && (Date.now() - timeSinceLastCheck.getTime()) < 60000) {
          // If less than 1 minute since last check, wait a bit to ensure DB consistency
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Compare and detect changes
      const changes = TriggerAlertModel.compareRankings(currentRankings, previousRankings);
      
      // Debug logging
      log.debug(`OI ${period} comparison - Current: ${currentRankings.length}, Previous: ${previousRankings.length}`);
      log.debug(`Current symbols: ${currentRankings.map(r => r.symbol).join(',')}`);
      log.debug(`Previous symbols: ${previousRankings.map(r => r.symbol).join(',')}`);
      log.debug(`Changes: ${changes.map(c => `${c.symbol}:${c.change}`).join(', ')}`);
      log.debug(`Significant OI movements (>5%): ${significantOIChanges.length} symbols`);
      
      // Check if there are significant changes (ranking changes OR significant OI movements)
      const significantChanges = changes.filter(change => 
        change.change === 'new' || 
        (change.change === 'up' && (change.changeValue || 0) >= 2) ||
        (change.change === 'down' && (change.changeValue || 0) >= 2)
      );
      
      // Additional check: ensure we have symbols with significant OI changes (>5%)
      const hasSignificantOIMovements = significantOIChanges.length > 0;

      // Update last check time
      if (period === '1h') this.oi1hLastCheck = new Date();
      else if (period === '4h') this.oi4hLastCheck = new Date();
      else if (period === '1d') this.oi24hLastCheck = new Date();

      // Send notifications if there are significant changes AND significant OI movements
      if (significantChanges.length > 0 && previousRankings.length > 0 && hasSignificantOIMovements) {
        // Additional filter: only send if there are truly new symbols or major ranking changes
        const hasMajorMoves = significantChanges.some(change => 
          (change.change === 'up' && (change.changeValue || 0) >= 3) ||
          (change.change === 'down' && (change.changeValue || 0) >= 3)
        );
        
        // Extra validation: ensure "new" symbols are truly not in previous rankings
        const newSymbolChanges = significantChanges.filter(change => change.change === 'new');
        log.debug(`OI ${period} - Found ${newSymbolChanges.length} symbols marked as "new": ${newSymbolChanges.map(c => c.symbol).join(',')}`);
        
        // Enhanced validation with detailed logging
        const validNewSymbols = significantChanges.filter(change => {
          if (change.change !== 'new') return true;
          
          // Primary check: not in previous rankings
          const isActuallyNew = !previousRankings.some(prev => prev.symbol === change.symbol);
          
          if (isActuallyNew) {
            log.debug(`OI ${period} - Symbol ${change.symbol} validated as new - not in previous ${previousRankings.length} rankings`);
          } else {
            const existingPosition = previousRankings.find(p => p.symbol === change.symbol)?.position;
            log.warn(`OI ${period} - False "new" symbol detected: ${change.symbol} exists in previous rankings at position ${existingPosition}, removing from new category`);
          }
          
          return isActuallyNew;
        });
        
        const hasActualNewSymbols = validNewSymbols.some(change => change.change === 'new');
        
        // 检查是否应该触发推送（排除风险代币触发的推送）
        const shouldPush = (hasActualNewSymbols || hasMajorMoves) && 
                          this.shouldTriggerPush(validNewSymbols, 3); // 主要变动阈值为3
        
        if (shouldPush) {
          await this.sendOINotification(currentRankings, validNewSymbols, period);
          log.info(`OI ${period} notification sent: ${hasActualNewSymbols ? 'new symbols' : ''} ${hasMajorMoves ? 'major moves' : ''}`);
        } else {
          if (hasActualNewSymbols || hasMajorMoves) {
            log.info(`OI ${period} push blocked: all triggers from risky tokens`);
          } else {
            log.debug(`OI ${period} changes detected but not significant enough for notification`);
          }
        }
      }

      // Save current rankings AFTER notification processing is complete
      // Add small delay to ensure proper sequencing and prevent race conditions
      if (significantChanges.length > 0 && previousRankings.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await TriggerAlertModel.saveOIRankings(currentRankings);

      log.debug(`OI ${period} check completed: ${significantChanges.length} significant changes detected`);
      
    } catch (error) {
      log.error(`Failed to check OI ${period}`, error);
    } finally {
      checkInProgress.set(false);
    }
  }

  /**
   * Check funding rates and send notifications if needed
   */
  private async checkFunding(): Promise<void> {
    // Prevent concurrent execution to avoid race conditions
    if (this.fundingCheckInProgress) {
      log.debug('Funding check already in progress, skipping...');
      return;
    }
    
    this.fundingCheckInProgress = true;
    
    try {
      log.debug('Checking funding rates for changes...');
      
      // Get current funding rates
      const fundingRates = await this.binance.getAllFundingRates();
      const validSymbols = filterTradingPairs(fundingRates.map(r => r.symbol));
      
      // Process and normalize funding rates
      const processedRates = fundingRates
        .filter(rate => validSymbols.includes(rate.symbol))
        .map(rate => {
          // Assume 8-hour funding intervals (standard for most pairs)
          const fundingRate = parseFloat(rate.fundingRate);
          
          return {
            symbol: rate.symbol,
            fundingRate: fundingRate,
            fundingRate8h: fundingRate // Already normalized for 8h
          };
        })
        .filter(rate => rate.fundingRate8h < 0) // Only negative rates
        .sort((a, b) => a.fundingRate8h - b.fundingRate8h) // Most negative first
        .slice(0, 10);

      // Convert to rankings format
      const currentRankings: FundingRanking[] = processedRates.map((rate, index) => ({
        symbol: rate.symbol,
        position: index + 1,
        funding_rate: rate.fundingRate,
        funding_rate_8h: rate.fundingRate8h
      }));

      // Get previous rankings for comparison
      const previousRankings = await TriggerAlertModel.getPreviousFundingRankings();

      // Compare and detect changes
      const changes = TriggerAlertModel.compareRankings(currentRankings, previousRankings);
      
      // Debug logging
      log.debug(`Funding comparison - Current: ${currentRankings.length}, Previous: ${previousRankings.length}`);
      log.debug(`Current symbols: ${currentRankings.map(r => r.symbol).join(',')}`);
      log.debug(`Previous symbols: ${previousRankings.map(r => r.symbol).join(',')}`);
      log.debug(`Changes: ${changes.map(c => `${c.symbol}:${c.change}`).join(', ')}`);
      
      // Check if there are significant changes
      const significantChanges = changes.filter(change => 
        change.change === 'new' || 
        (change.change === 'up' && (change.changeValue || 0) >= 2) ||
        (change.change === 'down' && (change.changeValue || 0) >= 2)
      );

      this.fundingLastCheck = new Date();

      // Send notifications if there are significant changes
      if (significantChanges.length > 0 && previousRankings.length > 0) {
        // Additional filter: only send if there are truly new symbols or major ranking changes
        const hasMajorMoves = significantChanges.some(change => 
          (change.change === 'up' && (change.changeValue || 0) >= 4) ||
          (change.change === 'down' && (change.changeValue || 0) >= 4)
        );
        
        // Extra validation: ensure "new" symbols are truly not in previous rankings
        const newSymbolChanges = significantChanges.filter(change => change.change === 'new');
        log.debug(`Found ${newSymbolChanges.length} symbols marked as "new": ${newSymbolChanges.map(c => c.symbol).join(',')}`);
        
        const validNewSymbols = significantChanges.filter(change => {
          if (change.change !== 'new') return true;
          const isActuallyNew = !previousRankings.some(prev => prev.symbol === change.symbol);
          log.debug(`Validating ${change.symbol}: actually new? ${isActuallyNew}`);
          if (!isActuallyNew) {
            log.warn(`False "new" symbol detected: ${change.symbol} exists in previous rankings, skipping notification`);
          }
          return isActuallyNew;
        });
        
        const hasActualNewSymbols = validNewSymbols.some(change => change.change === 'new');
        
        // 检查是否应该触发推送（排除风险代币触发的推送）
        const shouldPush = (hasActualNewSymbols || hasMajorMoves) && 
                          this.shouldTriggerPush(validNewSymbols, 4); // 主要变动阈值为4
        
        if (shouldPush) {
          await this.sendFundingNotification(currentRankings, validNewSymbols);
          log.info(`Funding notification sent: ${hasActualNewSymbols ? 'new symbols' : ''} ${hasMajorMoves ? 'major moves' : ''}`);
        } else {
          if (hasActualNewSymbols || hasMajorMoves) {
            log.info('Funding push blocked: all triggers from risky tokens');
          } else {
            log.debug('Funding changes detected but not significant enough for notification');
          }
        }
      }

      // Save current rankings AFTER notification processing is complete
      await TriggerAlertModel.saveFundingRankings(currentRankings);

      log.debug(`Funding rates check completed: ${significantChanges.length} significant changes detected`);
      
    } catch (error) {
      log.error('Failed to check funding rates', error);
    } finally {
      this.fundingCheckInProgress = false;
    }
  }

  /**
   * Send gainers notification
   */
  private async sendGainersNotification(rankings: GainersRanking[], changes: RankingChange[]): Promise<void> {
    try {
      const enabledUsers = await TriggerAlertModel.getEnabledUsers('gainers');
      if (enabledUsers.length === 0) return;

      const message = await this.formatGainersMessage(rankings, changes);
      
      for (const userId of enabledUsers) {
        if (this.telegramBot) {
          try {
            await this.telegramBot.sendMessage(parseInt(userId), message, { parse_mode: 'Markdown' });
            log.info(`Gainers notification sent to user ${userId}`);
          } catch (error) {
            log.error(`Failed to send gainers notification to user ${userId}`, error);
          }
        }
      }
    } catch (error) {
      log.error('Failed to send gainers notifications', error);
    }
  }

  /**
   * Send OI notification
   */
  private async sendOINotification(rankings: OIRanking[], changes: RankingChange[], period: '1h' | '4h' | '1d'): Promise<void> {
    try {
      const alertType = period === '1d' ? 'oi24h' : `oi${period}` as 'oi1h' | 'oi4h' | 'oi24h';
      const enabledUsers = await TriggerAlertModel.getEnabledUsers(alertType);
      if (enabledUsers.length === 0) return;

      const message = await this.formatOIMessage(rankings, changes, period);
      
      for (const userId of enabledUsers) {
        if (this.telegramBot) {
          try {
            await this.telegramBot.sendMessage(parseInt(userId), message, { parse_mode: 'Markdown' });
            log.info(`OI ${period} notification sent to user ${userId}`);
          } catch (error) {
            log.error(`Failed to send OI ${period} notification to user ${userId}`, error);
          }
        }
      }
    } catch (error) {
      log.error(`Failed to send OI ${period} notifications`, error);
    }
  }

  /**
   * Send funding notification
   */
  private async sendFundingNotification(rankings: FundingRanking[], changes: RankingChange[]): Promise<void> {
    try {
      const enabledUsers = await TriggerAlertModel.getEnabledUsers('funding');
      if (enabledUsers.length === 0) return;

      const message = await this.formatFundingMessage(rankings, changes);
      
      for (const userId of enabledUsers) {
        if (this.telegramBot) {
          try {
            await this.telegramBot.sendMessage(parseInt(userId), message, { parse_mode: 'Markdown' });
            log.info(`Funding notification sent to user ${userId}`);
          } catch (error) {
            log.error(`Failed to send funding notification to user ${userId}`, error);
          }
        }
      }
    } catch (error) {
      log.error('Failed to send funding notifications', error);
    }
  }

  /**
   * Format gainers message with changes highlighted
   */
  private async formatGainersMessage(rankings: GainersRanking[], changes: RankingChange[]): Promise<string> {
    const changesMap = new Map(changes.map(c => [c.symbol, c]));
    
    let message = '📈 *涨幅榜更新提醒*\n\n';
    
    const newEntries = changes.filter(c => c.change === 'new');
    if (newEntries.length > 0) {
      message += `🆕 *新进入前10:* ${newEntries.map(c => c.symbol.replace('USDT', '')).join(', ')}\n\n`;
    }

    // Get current prices for all symbols
    const pricePromises = rankings.map(async (ranking, index) => {
      const symbol = ranking.symbol.replace('USDT', '');
      const riskLevel = getTokenRiskLevel(ranking.symbol);
      const riskIcon = getRiskIcon(riskLevel);
      const change = changesMap.get(ranking.symbol);
      
      let changeIcon = '';
      let changeText = '';
      
      if (change) {
        switch (change.change) {
          case 'new':
            changeIcon = '🆕';
            changeText = ' (新进入)';
            break;
          case 'up':
            changeIcon = '⬆️';
            changeText = ` (↑${change.changeValue})`;
            break;
          case 'down':
            changeIcon = '⬇️';
            changeText = ` (↓${change.changeValue})`;
            break;
        }
      }

      // Get current price
      let priceText = '';
      try {
        const currentPrice = await this.binance.getFuturesPrice(ranking.symbol);
        const formattedPrice = await formatPriceWithSeparators(currentPrice, ranking.symbol);
        priceText = ` ($${formattedPrice})`;
      } catch (error) {
        log.debug(`Failed to get price for ${ranking.symbol}`, error);
        priceText = '';
      }

      const formattedChange = formatPriceChange(ranking.price_change_percent);
      return `${index + 1}. ${riskIcon}${symbol} +${formattedChange}%${priceText}${changeText} ${changeIcon}\n`;
    });

    const formattedEntries = await Promise.all(pricePromises);
    formattedEntries.forEach(entry => {
      message += entry;
    });

    message += `\n⏰ 检查时间: ${new Date().toLocaleString('zh-CN')}`;
    
    return message;
  }

  /**
   * Format OI message with changes highlighted
   */
  private async formatOIMessage(rankings: OIRanking[], changes: RankingChange[], period: '1h' | '4h' | '1d'): Promise<string> {
    const changesMap = new Map(changes.map(c => [c.symbol, c]));
    
    const displayPeriod = period === '1d' ? '24h' : period;
    let message = `📊 *持仓量${displayPeriod}变动榜更新提醒*\n\n`;
    
    const newEntries = changes.filter(c => c.change === 'new');
    if (newEntries.length > 0) {
      message += `🆕 *新进入前10:* ${newEntries.map(c => c.symbol.replace('USDT', '')).join(', ')}\n\n`;
    }

    // Get current prices for all symbols
    const pricePromises = rankings.map(async (ranking, index) => {
      const symbol = ranking.symbol.replace('USDT', '');
      const riskLevel = getTokenRiskLevel(ranking.symbol);
      const riskIcon = getRiskIcon(riskLevel);
      const change = changesMap.get(ranking.symbol);
      
      let changeIcon = '';
      let changeText = '';
      
      if (change) {
        switch (change.change) {
          case 'new':
            changeIcon = '🆕';
            changeText = ' (新进入)';
            break;
          case 'up':
            changeIcon = '⬆️';
            changeText = ` (↑${change.changeValue})`;
            break;
          case 'down':
            changeIcon = '⬇️';
            changeText = ` (↓${change.changeValue})`;
            break;
        }
      }

      // Get current price
      let priceText = '';
      try {
        const currentPrice = await this.binance.getFuturesPrice(ranking.symbol);
        const formattedPrice = await formatPriceWithSeparators(currentPrice, ranking.symbol);
        priceText = ` ($${formattedPrice})`;
      } catch (error) {
        log.debug(`Failed to get price for ${ranking.symbol}`, error);
        priceText = '';
      }

      const oiChange = ranking.oi_change_percent >= 0 ? `+${ranking.oi_change_percent.toFixed(2)}` : ranking.oi_change_percent.toFixed(2);
      const oiValue = (ranking.oi_value / 1_000_000).toFixed(1); // Convert to millions
      return `${index + 1}. ${riskIcon}${symbol} ${oiChange}% (${oiValue}M)${priceText}${changeText} ${changeIcon}\n`;
    });

    const formattedEntries = await Promise.all(pricePromises);
    formattedEntries.forEach(entry => {
      message += entry;
    });

    message += `\n⏰ 检查时间: ${new Date().toLocaleString('zh-CN')}`;
    
    return message;
  }

  /**
   * Format funding message with changes highlighted
   */
  private async formatFundingMessage(rankings: FundingRanking[], changes: RankingChange[]): Promise<string> {
    const changesMap = new Map(changes.map(c => [c.symbol, c]));
    
    let message = '💰 *负费率榜更新提醒*\n\n';
    
    const newEntries = changes.filter(c => c.change === 'new');
    if (newEntries.length > 0) {
      message += `🆕 *新进入前10:* ${newEntries.map(c => c.symbol.replace('USDT', '')).join(', ')}\n\n`;
    }

    // Get current prices for all symbols
    const pricePromises = rankings.map(async (ranking, index) => {
      const symbol = ranking.symbol.replace('USDT', '');
      const riskLevel = getTokenRiskLevel(ranking.symbol);
      const riskIcon = getRiskIcon(riskLevel);
      const change = changesMap.get(ranking.symbol);
      
      let changeIcon = '';
      let changeText = '';
      
      if (change) {
        switch (change.change) {
          case 'new':
            changeIcon = '🆕';
            changeText = ' (新进入)';
            break;
          case 'up':
            changeIcon = '⬆️';
            changeText = ` (↑${change.changeValue})`;
            break;
          case 'down':
            changeIcon = '⬇️';
            changeText = ` (↓${change.changeValue})`;
            break;
        }
      }

      // Get current price
      let priceText = '';
      try {
        const currentPrice = await this.binance.getFuturesPrice(ranking.symbol);
        const formattedPrice = await formatPriceWithSeparators(currentPrice, ranking.symbol);
        priceText = ` ($${formattedPrice})`;
      } catch (error) {
        log.debug(`Failed to get price for ${ranking.symbol}`, error);
        priceText = '';
      }

      const rate8h = (ranking.funding_rate_8h * 100).toFixed(4);
      return `${index + 1}. ${riskIcon}${symbol} ${rate8h}%${priceText}${changeText} ${changeIcon}\n`;
    });

    const formattedEntries = await Promise.all(pricePromises);
    formattedEntries.forEach(entry => {
      message += entry;
    });

    message += `\n⏰ 检查时间: ${new Date().toLocaleString('zh-CN')}`;
    
    return message;
  }

  /**
   * Get service statistics
   */
  getStats(): TriggerAlertStats {
    return {
      gainersEnabled: this.gainersEnabled,
      fundingEnabled: this.fundingEnabled,
      oi1hEnabled: this.oi1hEnabled,
      oi4hEnabled: this.oi4hEnabled,
      oi24hEnabled: this.oi24hEnabled,
      gainersLastCheck: this.gainersLastCheck,
      fundingLastCheck: this.fundingLastCheck,
      oi1hLastCheck: this.oi1hLastCheck,
      oi4hLastCheck: this.oi4hLastCheck,
      oi24hLastCheck: this.oi24hLastCheck,
      gainersInterval: this.gainersInterval,
      fundingInterval: this.fundingInterval,
      oi1hInterval: this.oi1hInterval,
      oi4hInterval: this.oi4hInterval,
      oi24hInterval: this.oi24hInterval
    };
  }

  /**
   * Clean old data periodically
   */
  async cleanOldData(): Promise<void> {
    try {
      await TriggerAlertModel.cleanOldData();
    } catch (error) {
      log.error('Failed to clean old trigger alert data', error);
    }
  }
}

// Export singleton instance
export const triggerAlertService = new TriggerAlertService();