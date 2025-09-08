import { BinanceClient } from './binance';
import { PriceAlertModel } from '../models/PriceAlert';
import { PriceAlert } from '../database/schema';
import { log } from '../utils/logger';
import { TelegramBot } from '../bot';
import { getTokenRiskLevel, getRiskIcon } from '../config/tokenLists';

export interface AlertCheckResult {
  alertId: number;
  symbol: string;
  condition: string;
  triggerPrice: number;
  currentPrice: number;
  triggered: boolean;
}

export interface MonitoringStats {
  activeAlerts: number;
  monitoredSymbols: number;
  lastCheck: Date;
  checksPerformed: number;
  alertsTriggered: number;
}

export class PriceMonitorService {
  private binance: BinanceClient;
  private telegramBot: TelegramBot | null = null;
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;
  private checkInterval: number = 30000; // 30 seconds default
  private stats: MonitoringStats = {
    activeAlerts: 0,
    monitoredSymbols: 0,
    lastCheck: new Date(),
    checksPerformed: 0,
    alertsTriggered: 0
  };

  constructor(binanceClient?: BinanceClient, checkIntervalMs?: number, telegramBot?: TelegramBot) {
    this.binance = binanceClient || new BinanceClient();
    this.telegramBot = telegramBot || null;
    if (checkIntervalMs) {
      this.checkInterval = checkIntervalMs;
    }
    
    log.info('PriceMonitorService initialized', {
      checkInterval: this.checkInterval,
      telegramIntegration: !!this.telegramBot
    });
  }

  /**
   * Start monitoring all active price alerts
   */
  async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      log.warn('Price monitoring is already running');
      return;
    }

    log.info('Starting price monitoring service');
    this.isRunning = true;

    try {
      // Get all active alerts from database
      const alerts = await PriceAlertModel.getAllActiveAlerts();
      log.info(`Found ${alerts.length} active alerts to monitor`);

      if (alerts.length === 0) {
        log.info('No active alerts found, monitoring will check periodically for new alerts');
      }

      // Group alerts by symbol to optimize API calls
      const symbolGroups = this.groupAlertsBySymbol(alerts);
      log.info(`Monitoring ${Object.keys(symbolGroups).length} unique symbols`);

      // Start monitoring intervals for each symbol
      this.setupSymbolMonitoring(symbolGroups);

      // Update stats
      this.stats.activeAlerts = alerts.length;
      this.stats.monitoredSymbols = Object.keys(symbolGroups).length;

      log.info('Price monitoring service started successfully', {
        activeAlerts: this.stats.activeAlerts,
        monitoredSymbols: this.stats.monitoredSymbols
      });

    } catch (error) {
      log.error('Failed to start price monitoring', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop monitoring all price alerts
   */
  async stopMonitoring(): Promise<void> {
    if (!this.isRunning) {
      log.warn('Price monitoring is not running');
      return;
    }

    log.info('Stopping price monitoring service');

    // Clear all intervals with validation
    for (const [symbol, interval] of this.intervals.entries()) {
      if (interval) {
        clearInterval(interval);
        log.debug(`Stopped monitoring for ${symbol}`);
      }
    }

    this.intervals.clear();
    this.isRunning = false;

    log.info('Price monitoring service stopped');
  }

  /**
   * Restart monitoring (useful when alerts are updated)
   */
  async restartMonitoring(): Promise<void> {
    log.info('Restarting price monitoring service');
    await this.stopMonitoring();
    await this.startMonitoring();
  }

  /**
   * Add a new symbol to monitoring
   */
  async addSymbolMonitoring(symbol: string): Promise<void> {
    if (this.intervals.has(symbol)) {
      log.debug(`Already monitoring ${symbol}`);
      return;
    }

    log.info(`Adding ${symbol} to monitoring`);

    const interval = setInterval(async () => {
      await this.checkAlertsForSymbol(symbol);
    }, this.checkInterval);

    this.intervals.set(symbol, interval);
    this.stats.monitoredSymbols = this.intervals.size;

    // Perform initial check
    await this.checkAlertsForSymbol(symbol);
  }

  /**
   * Remove a symbol from monitoring
   */
  removeSymbolMonitoring(symbol: string): void {
    const interval = this.intervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(symbol);
      this.stats.monitoredSymbols = this.intervals.size;
      log.info(`Stopped monitoring ${symbol}`);
    } else {
      log.debug(`No active monitoring found for ${symbol}`);
    }
  }

  /**
   * Get monitoring statistics
   */
  getStats(): MonitoringStats {
    return { ...this.stats };
  }

  /**
   * Check if monitoring is running
   */
  isMonitoringActive(): boolean {
    return this.isRunning;
  }

  /**
   * Manually trigger alert checks for all symbols
   */
  async checkAllAlerts(): Promise<AlertCheckResult[]> {
    const results: AlertCheckResult[] = [];

    for (const symbol of this.intervals.keys()) {
      const symbolResults = await this.checkAlertsForSymbol(symbol);
      results.push(...symbolResults);
    }

    return results;
  }

  /**
   * Group alerts by symbol for efficient monitoring
   */
  private groupAlertsBySymbol(alerts: PriceAlert[]): Record<string, PriceAlert[]> {
    const groups: Record<string, PriceAlert[]> = {};

    for (const alert of alerts) {
      if (!groups[alert.symbol]) {
        groups[alert.symbol] = [];
      }
      groups[alert.symbol].push(alert);
    }

    return groups;
  }

  /**
   * Setup monitoring intervals for grouped symbols
   */
  private setupSymbolMonitoring(symbolGroups: Record<string, PriceAlert[]>): void {
    for (const symbol of Object.keys(symbolGroups)) {
      const interval = setInterval(async () => {
        await this.checkAlertsForSymbol(symbol);
      }, this.checkInterval);

      this.intervals.set(symbol, interval);

      // Perform initial check with slight delay to avoid rate limits
      setTimeout(async () => {
        await this.checkAlertsForSymbol(symbol);
      }, Math.random() * 5000); // Random delay up to 5 seconds
    }
  }

  /**
   * Check alerts for a specific symbol
   */
  private async checkAlertsForSymbol(symbol: string): Promise<AlertCheckResult[]> {
    const results: AlertCheckResult[] = [];

    try {
      // Get current price from Binance
      const currentPrice = await this.binance.getPrice(symbol);
      log.debug(`Current price for ${symbol}: ${currentPrice}`);

      // Get all active alerts for this symbol
      const allAlerts = await PriceAlertModel.getAllActiveAlerts();
      const symbolAlerts = allAlerts.filter(alert => alert.symbol === symbol);

      if (symbolAlerts.length === 0) {
        // No alerts for this symbol, remove from monitoring
        this.removeSymbolMonitoring(symbol);
        return results;
      }

      // Check each alert
      for (const alert of symbolAlerts) {
        const result = await this.checkIndividualAlert(alert, currentPrice);
        results.push(result);

        if (result.triggered) {
          await this.handleTriggeredAlert(alert, currentPrice);
        }
      }

      // Update stats
      this.stats.lastCheck = new Date();
      this.stats.checksPerformed++;

    } catch (error) {
      log.error(`Failed to check alerts for ${symbol}`, error);
    }

    return results;
  }

  /**
   * Check if an individual alert should trigger
   */
  private async checkIndividualAlert(alert: PriceAlert, currentPrice: number): Promise<AlertCheckResult> {
    const result: AlertCheckResult = {
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      triggerPrice: alert.value,
      currentPrice,
      triggered: false
    };

    switch (alert.condition) {
      case 'above':
        result.triggered = currentPrice >= alert.value;
        break;
      case 'below':
        result.triggered = currentPrice <= alert.value;
        break;
      case 'change':
        // For change alerts, we need to implement percentage change logic
        // This would require storing the initial price when the alert was created
        // For now, we'll skip change alerts or implement a simple version
        log.debug(`Change alerts not fully implemented yet for alert ${alert.id}`);
        break;
      default:
        log.warn(`Unknown alert condition: ${alert.condition}`, { alertId: alert.id });
    }

    log.debug(`Alert check result`, {
      alertId: alert.id,
      symbol: alert.symbol,
      condition: alert.condition,
      triggerPrice: alert.value,
      currentPrice,
      triggered: result.triggered
    });

    return result;
  }

  /**
   * Handle a triggered alert
   */
  private async handleTriggeredAlert(alert: PriceAlert, currentPrice: number): Promise<void> {
    try {
      log.info(`Alert triggered!`, {
        alertId: alert.id,
        symbol: alert.symbol,
        condition: alert.condition,
        triggerPrice: alert.value,
        currentPrice
      });

      // Deactivate the alert
      await PriceAlertModel.deactivateAlert(alert.id);

      // Update stats
      this.stats.alertsTriggered++;
      this.stats.activeAlerts--;

      // Here you would typically send a notification to the user
      // For now, we'll just log it
      await this.sendAlertNotification(alert, currentPrice);

    } catch (error) {
      log.error(`Failed to handle triggered alert ${alert.id}`, error);
    }
  }

  /**
   * Send notification for triggered alert
   */
  private async sendAlertNotification(alert: PriceAlert, currentPrice: number): Promise<void> {
    const message = this.formatAlertMessage(alert, currentPrice);
    
    log.info(`Alert notification being sent`, {
      alertId: alert.id,
      userId: alert.user_id,
      symbol: alert.symbol
    });

    try {
      if (this.telegramBot) {
        await this.telegramBot.sendToAuthorizedUser(message, {
          parse_mode: 'Markdown'
        });
        log.info(`Telegram notification sent successfully`, {
          alertId: alert.id,
          userId: alert.user_id
        });
      } else {
        log.warn(`No Telegram bot instance available for notification`, {
          alertId: alert.id
        });
      }
    } catch (error) {
      log.error(`Failed to send Telegram notification`, {
        alertId: alert.id,
        userId: alert.user_id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw error - continue monitoring even if notification fails
    }
  }

  /**
   * Format alert message for notification with rich information
   */
  private formatAlertMessage(alert: PriceAlert, currentPrice: number): string {
    const symbol = alert.symbol.replace('USDT', '');
    const riskLevel = getTokenRiskLevel(alert.symbol);
    const riskIcon = getRiskIcon(riskLevel);
    const emoji = alert.condition === 'above' ? '📈' : '📉';
    const conditionText = alert.condition === 'above' ? 'risen above' : 'fallen below';
    
    // Calculate percentage change
    const changePercent = ((currentPrice - alert.value) / alert.value * 100);
    const changeText = changePercent >= 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;
    
    return `🚨 *PRICE ALERT TRIGGERED*\n\n` +
      `${riskIcon}${emoji} **${symbol}** has ${conditionText} your target!\n\n` +
      `🎯 *Target Price*: $${alert.value.toLocaleString()}\n` +
      `💰 *Current Price*: $${currentPrice.toLocaleString()}\n` +
      `📊 *Change*: ${changeText}\n` +
      `🔔 *Alert ID*: #${alert.id}\n` +
      `⏰ *Time*: ${new Date().toLocaleString('zh-CN')}\n\n` +
      `_This alert has been automatically deactivated._`;
  }

  /**
   * Set or update the TelegramBot instance for notifications
   */
  setTelegramBot(telegramBot: TelegramBot): void {
    this.telegramBot = telegramBot;
    log.info('TelegramBot instance updated in PriceMonitorService');
  }

  /**
   * Get alerts that are about to trigger (within a threshold)
   */
  async getNearTriggerAlerts(thresholdPercent: number = 5): Promise<{alert: PriceAlert, currentPrice: number, distance: number}[]> {
    const results: {alert: PriceAlert, currentPrice: number, distance: number}[] = [];

    try {
      const alerts = await PriceAlertModel.getAllActiveAlerts();
      const symbolPrices: Record<string, number> = {};

      // Get current prices for all symbols
      const uniqueSymbols = [...new Set(alerts.map(alert => alert.symbol))];
      for (const symbol of uniqueSymbols) {
        try {
          symbolPrices[symbol] = await this.binance.getPrice(symbol);
        } catch (error) {
          log.warn(`Failed to get price for ${symbol}`, error);
        }
      }

      // Check which alerts are near triggering
      for (const alert of alerts) {
        const currentPrice = symbolPrices[alert.symbol];
        if (!currentPrice) continue;

        let distance: number;
        if (alert.condition === 'above') {
          distance = ((alert.value - currentPrice) / currentPrice) * 100;
        } else if (alert.condition === 'below') {
          distance = ((currentPrice - alert.value) / currentPrice) * 100;
        } else {
          continue; // Skip change alerts for now
        }

        if (distance >= 0 && distance <= thresholdPercent) {
          results.push({ alert, currentPrice, distance });
        }
      }

    } catch (error) {
      log.error('Failed to get near-trigger alerts', error);
    }

    return results.sort((a, b) => a.distance - b.distance);
  }
}

// Export singleton instance (without TelegramBot integration - use for standalone monitoring only)
export const priceMonitor = new PriceMonitorService();