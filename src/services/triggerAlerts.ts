import { BinanceClient } from './binance';
import { TriggerAlertModel, GainersRanking, FundingRanking, RankingChange } from '../models/TriggerAlert';
import { TelegramBot } from '../bot';
import { log } from '../utils/logger';
import { getTokenRiskLevel, getRiskIcon, filterTradingPairs } from '../config/tokenLists';
import { formatPriceWithSeparators, formatPriceChange } from '../utils/priceFormatter';

export interface TriggerAlertStats {
  gainersEnabled: boolean;
  fundingEnabled: boolean;
  gainersLastCheck: Date | null;
  fundingLastCheck: Date | null;
  gainersInterval: NodeJS.Timeout | null;
  fundingInterval: NodeJS.Timeout | null;
}

export class TriggerAlertService {
  private binance: BinanceClient;
  private telegramBot: TelegramBot | null = null;
  
  private gainersInterval: NodeJS.Timeout | null = null;
  private fundingInterval: NodeJS.Timeout | null = null;
  
  private gainersEnabled: boolean = false;
  private fundingEnabled: boolean = false;
  
  private readonly GAINERS_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes (production)
  private readonly FUNDING_CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes (production)
  
  private gainersLastCheck: Date | null = null;
  private fundingLastCheck: Date | null = null;

  constructor(binanceClient?: BinanceClient, telegramBot?: TelegramBot) {
    this.binance = binanceClient || new BinanceClient();
    this.telegramBot = telegramBot || null;
    
    log.info('TriggerAlertService initialized', {
      gainersInterval: this.GAINERS_CHECK_INTERVAL / 1000,
      fundingInterval: this.FUNDING_CHECK_INTERVAL / 1000
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
   * Stop all monitoring
   */
  stopAllMonitoring(): void {
    this.stopGainersMonitoring();
    this.stopFundingMonitoring();
  }

  /**
   * Check gainers and send notifications if needed
   */
  private async checkGainers(): Promise<void> {
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
        
        if (hasActualNewSymbols || hasMajorMoves) {
          await this.sendGainersNotification(currentRankings, validNewSymbols);
          log.info(`Gainers notification sent: ${hasActualNewSymbols ? 'new symbols' : ''} ${hasMajorMoves ? 'major moves' : ''}`);
        } else {
          log.debug('Gainers changes detected but not significant enough for notification');
        }
      }

      // Save current rankings AFTER notification processing is complete
      await TriggerAlertModel.saveGainersRankings(currentRankings);

      log.debug(`Gainers check completed: ${significantChanges.length} significant changes detected`);
      
    } catch (error) {
      log.error('Failed to check gainers', error);
    }
  }

  /**
   * Check funding rates and send notifications if needed
   */
  private async checkFunding(): Promise<void> {
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
        
        if (hasActualNewSymbols || hasMajorMoves) {
          await this.sendFundingNotification(currentRankings, validNewSymbols);
          log.info(`Funding notification sent: ${hasActualNewSymbols ? 'new symbols' : ''} ${hasMajorMoves ? 'major moves' : ''}`);
        } else {
          log.debug('Funding changes detected but not significant enough for notification');
        }
      }

      // Save current rankings AFTER notification processing is complete
      await TriggerAlertModel.saveFundingRankings(currentRankings);

      log.debug(`Funding rates check completed: ${significantChanges.length} significant changes detected`);
      
    } catch (error) {
      log.error('Failed to check funding rates', error);
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
      gainersLastCheck: this.gainersLastCheck,
      fundingLastCheck: this.fundingLastCheck,
      gainersInterval: this.gainersInterval,
      fundingInterval: this.fundingInterval
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