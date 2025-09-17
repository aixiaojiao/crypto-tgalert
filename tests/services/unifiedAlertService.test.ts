import { UnifiedAlertService } from '../../src/services/alerts/UnifiedAlertService';
import {
  INotificationService,
  NotificationContext,
  NotificationTemplate,
  NotificationConfig,
  NotificationHistoryItem
} from '../../src/services/alerts/INotificationService';
import {
  AlertConfig,
  AlertType,
  AlertCondition,
  AlertPriority,
  NotificationChannel,
  MarketData,
  NotificationResult
} from '../../src/services/alerts/IAlertService';

// Mock notification service
class MockNotificationService implements INotificationService {
  private notifications: Array<{ channel: NotificationChannel; context: NotificationContext }> = [];

  async sendNotification(channel: NotificationChannel, context: NotificationContext): Promise<NotificationResult> {
    this.notifications.push({ channel, context });
    return {
      success: true,
      channel,
      messageId: `mock-${Date.now()}`
    };
  }

  async sendBulkNotifications(channels: NotificationChannel[], context: NotificationContext): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    for (const channel of channels) {
      const result = await this.sendNotification(channel, context);
      results.push(result);
    }
    return results;
  }

  async registerTemplate(_template: NotificationTemplate): Promise<void> {
    // Mock implementation
  }

  async updateConfig(_channel: NotificationChannel, _config: NotificationConfig): Promise<void> {
    // Mock implementation
  }

  async getConfig(channel: NotificationChannel): Promise<NotificationConfig | null> {
    return {
      channel,
      enabled: true,
      rateLimitMs: 1000,
      maxRetries: 3,
      retryDelayMs: 1000,
      settings: {}
    };
  }

  async testChannel(channel: NotificationChannel, _testMessage: string): Promise<NotificationResult> {
    return {
      success: true,
      channel,
      messageId: `test-${Date.now()}`
    };
  }

  async getNotificationHistory(_limit?: number): Promise<NotificationHistoryItem[]> {
    return [];
  }

  async formatMessage(context: NotificationContext): Promise<string> {
    return `Mock message for ${context.event.symbol}`;
  }

  async checkRateLimit(_channel: NotificationChannel): Promise<boolean> {
    return true;
  }

  getNotifications() {
    return this.notifications;
  }

  clearNotifications() {
    this.notifications = [];
  }
}

// Mock logger
const mockLogger = {
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  http: jest.fn()
};

describe('UnifiedAlertService', () => {
  let alertService: UnifiedAlertService;
  let mockNotificationService: MockNotificationService;

  beforeEach(() => {
    mockNotificationService = new MockNotificationService();
    alertService = new UnifiedAlertService(mockLogger, mockNotificationService);
    jest.clearAllMocks();
  });

  const createTestAlertConfig = (overrides: Partial<AlertConfig> = {}): AlertConfig => ({
    id: 'test-alert-123',
    symbol: 'BTC',
    type: AlertType.PRICE_ABOVE,
    condition: AlertCondition.GREATER_THAN,
    thresholds: {
      value: 50000
    },
    enabled: true,
    notificationChannels: [NotificationChannel.TELEGRAM],
    cooldownMs: 300000, // 5 minutes
    maxRetries: 3,
    priority: AlertPriority.MEDIUM,
    metadata: {
      userId: 'test-user',
      chatId: 123456789
    },
    ...overrides
  });

  const createTestMarketData = (overrides: Partial<MarketData> = {}): MarketData => ({
    symbol: 'BTC',
    price: 51000,
    volume24h: 1000000,
    priceChange24h: 1000,
    priceChangePercent24h: 2.0,
    high24h: 52000,
    low24h: 49000,
    timestamp: Date.now(),
    ...overrides
  });

  describe('Alert Registration', () => {
    it('should register alert successfully', async () => {
      const config = createTestAlertConfig();

      await alertService.registerAlert(config);

      const alerts = await alertService.getAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe(config.id);
      expect(mockLogger.info).toHaveBeenCalledWith('Alert registered', expect.objectContaining({
        id: config.id,
        symbol: config.symbol,
        type: config.type,
        enabled: config.enabled
      }));
    });

    it('should validate alert configuration during registration', async () => {
      const invalidConfig = createTestAlertConfig({
        id: '', // Invalid empty ID
        symbol: 'BTC'
      });

      await expect(alertService.registerAlert(invalidConfig)).rejects.toThrow('Alert ID is required and must be a string');
    });

    it('should validate symbol is required', async () => {
      const invalidConfig = createTestAlertConfig({
        symbol: '' // Invalid empty symbol
      });

      await expect(alertService.registerAlert(invalidConfig)).rejects.toThrow('Symbol is required and must be a string');
    });

    it('should validate alert type is valid', async () => {
      const invalidConfig = createTestAlertConfig({
        type: 'invalid_type' as AlertType
      });

      await expect(alertService.registerAlert(invalidConfig)).rejects.toThrow('Invalid alert type: invalid_type');
    });

    it('should validate cooldown is at least 1000ms', async () => {
      const invalidConfig = createTestAlertConfig({
        cooldownMs: 500 // Too short
      });

      await expect(alertService.registerAlert(invalidConfig)).rejects.toThrow('Cooldown must be at least 1000ms');
    });

    it('should validate notification channels exist', async () => {
      const invalidConfig = createTestAlertConfig({
        notificationChannels: []
      });

      await expect(alertService.registerAlert(invalidConfig)).rejects.toThrow('At least one notification channel is required');
    });
  });

  describe('Alert Management', () => {
    beforeEach(async () => {
      const config = createTestAlertConfig();
      await alertService.registerAlert(config);
    });

    it('should update alert successfully', async () => {
      const updates = {
        enabled: false,
        thresholds: { value: 60000 }
      };

      await alertService.updateAlert('test-alert-123', updates);

      const alert = await alertService.getAlert('test-alert-123');
      expect(alert?.enabled).toBe(false);
      expect(alert?.thresholds.value).toBe(60000);
      expect(mockLogger.info).toHaveBeenCalledWith('Alert updated', {
        alertId: 'test-alert-123',
        updates
      });
    });

    it('should throw error when updating non-existent alert', async () => {
      await expect(alertService.updateAlert('non-existent', { enabled: false }))
        .rejects.toThrow('Alert not found: non-existent');
    });

    it('should remove alert successfully', async () => {
      await alertService.removeAlert('test-alert-123');

      const alerts = await alertService.getAlerts();
      expect(alerts).toHaveLength(0);

      const removedAlert = await alertService.getAlert('test-alert-123');
      expect(removedAlert).toBeNull();
      expect(mockLogger.info).toHaveBeenCalledWith('Alert removed', { alertId: 'test-alert-123' });
    });

    it('should throw error when removing non-existent alert', async () => {
      await expect(alertService.removeAlert('non-existent'))
        .rejects.toThrow('Alert not found: non-existent');
    });

    it('should toggle alert status successfully', async () => {
      await alertService.toggleAlert('test-alert-123', false);

      const alert = await alertService.getAlert('test-alert-123');
      expect(alert?.enabled).toBe(false);
      expect(mockLogger.info).toHaveBeenCalledWith('Alert toggled', {
        alertId: 'test-alert-123',
        enabled: false
      });
    });

    it('should throw error when toggling non-existent alert', async () => {
      await expect(alertService.toggleAlert('non-existent', false))
        .rejects.toThrow('Alert not found: non-existent');
    });
  });

  describe('Alert Checking and Triggering', () => {
    beforeEach(async () => {
      // Register multiple test alerts
      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-price-above-50k',
        symbol: 'BTC',
        type: AlertType.PRICE_ABOVE,
        condition: AlertCondition.GREATER_THAN,
        thresholds: { value: 50000 }
      }));

      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-price-below-48k',
        symbol: 'BTC',
        type: AlertType.PRICE_BELOW,
        condition: AlertCondition.LESS_THAN,
        thresholds: { value: 48000 }
      }));

      await alertService.registerAlert(createTestAlertConfig({
        id: 'eth-price-above-3k',
        symbol: 'ETH',
        type: AlertType.PRICE_ABOVE,
        condition: AlertCondition.GREATER_THAN,
        thresholds: { value: 3000 }
      }));
    });

    it('should trigger alerts when conditions are met', async () => {
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000 // Above 50k threshold
      });

      const results = await alertService.checkAlerts(marketData);

      // Should trigger the price above alert
      const triggeredResults = results.filter(r => r.triggered);
      expect(triggeredResults).toHaveLength(1);
      expect(triggeredResults[0].event?.alertId).toBe('btc-price-above-50k');
      expect(triggeredResults[0].event?.currentValue).toBe(51000);
      expect(triggeredResults[0].event?.thresholdValue).toBe(50000);

      // Should send notification
      const notifications = mockNotificationService.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].context.event.symbol).toBe('BTC');
    });

    it('should not trigger alerts when conditions are not met', async () => {
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 49000 // Between 48k and 50k, no alerts should trigger
      });

      const results = await alertService.checkAlerts(marketData);

      const triggeredResults = results.filter(r => r.triggered);
      expect(triggeredResults).toHaveLength(0);

      const notifications = mockNotificationService.getNotifications();
      expect(notifications).toHaveLength(0);
    });

    it('should only check alerts for matching symbol', async () => {
      const marketData = createTestMarketData({
        symbol: 'ETH',
        price: 3500 // Should only trigger ETH alert, not BTC alerts
      });

      const results = await alertService.checkAlerts(marketData);

      const triggeredResults = results.filter(r => r.triggered);
      expect(triggeredResults).toHaveLength(1);
      expect(triggeredResults[0].event?.alertId).toBe('eth-price-above-3k');
    });

    it('should respect cooldown periods', async () => {
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      // First trigger
      await alertService.checkAlerts(marketData);
      mockNotificationService.clearNotifications();

      // Immediate second check should be in cooldown
      const results = await alertService.checkAlerts(marketData);
      const triggeredResults = results.filter(r => r.triggered);
      expect(triggeredResults).toHaveLength(0);

      // Should have cooldown reason
      const cooldownResults = results.filter(r => r.reason === 'Still in cooldown period');
      expect(cooldownResults.length).toBeGreaterThan(0);
    });

    it('should not check disabled alerts', async () => {
      // Disable the alert
      await alertService.toggleAlert('btc-price-above-50k', false);

      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      const results = await alertService.checkAlerts(marketData);
      const triggeredResults = results.filter(r => r.triggered);
      expect(triggeredResults).toHaveLength(0);
    });

    it('should prevent concurrent alert processing', async () => {
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      // Start two concurrent checks
      const [results1, results2] = await Promise.all([
        alertService.checkAlerts(marketData),
        alertService.checkAlerts(marketData)
      ]);

      // One should complete normally, other should return empty due to processing lock
      const totalTriggered = results1.filter(r => r.triggered).length + results2.filter(r => r.triggered).length;
      expect(totalTriggered).toBeLessThanOrEqual(1);
    });
  });

  describe('Alert Testing', () => {
    beforeEach(async () => {
      await alertService.registerAlert(createTestAlertConfig());
    });

    it('should send test notification successfully', async () => {
      const results = await alertService.testAlert('test-alert-123');

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].channel).toBe(NotificationChannel.TELEGRAM);

      const notifications = mockNotificationService.getNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0].context.event.message).toContain('Test notification');
    });

    it('should throw error when testing non-existent alert', async () => {
      await expect(alertService.testAlert('non-existent'))
        .rejects.toThrow('Alert not found: non-existent');
    });
  });

  describe('Alert History', () => {
    beforeEach(async () => {
      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-alert',
        cooldownMs: 1000 // Short cooldown for testing
      }));
    });

    it('should record alert events in history', async () => {
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      await alertService.checkAlerts(marketData);

      const history = await alertService.getAlertHistory();
      expect(history).toHaveLength(1);
      expect(history[0].alertId).toBe('btc-alert');
      expect(history[0].symbol).toBe('BTC');
      expect(history[0].currentValue).toBe(51000);
    });

    it('should filter history by alert ID', async () => {
      // Register second alert and trigger both
      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-alert-2',
        cooldownMs: 1000
      }));

      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      await alertService.checkAlerts(marketData);

      const allHistory = await alertService.getAlertHistory();
      expect(allHistory).toHaveLength(2);

      const specificHistory = await alertService.getAlertHistory('btc-alert');
      expect(specificHistory).toHaveLength(1);
      expect(specificHistory[0].alertId).toBe('btc-alert');
    });

    it('should respect limit parameter', async () => {
      // Trigger multiple events
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      for (let i = 0; i < 5; i++) {
        await alertService.checkAlerts(marketData);
        // Wait for cooldown
        await new Promise(resolve => setTimeout(resolve, 1100));
      }

      const limitedHistory = await alertService.getAlertHistory(undefined, 3);
      expect(limitedHistory).toHaveLength(3);
    });

    it('should cleanup old history', async () => {
      // Trigger an alert to create history
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      await alertService.checkAlerts(marketData);

      const initialHistory = await alertService.getAlertHistory();
      expect(initialHistory).toHaveLength(1);

      // Cleanup history older than 1ms (should remove everything)
      const removed = await alertService.cleanupHistory(1);
      expect(removed).toBe(1);

      const finalHistory = await alertService.getAlertHistory();
      expect(finalHistory).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      // Register multiple alerts of different types and priorities
      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-price-high',
        type: AlertType.PRICE_ABOVE,
        priority: AlertPriority.HIGH
      }));

      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-volume-medium',
        type: AlertType.VOLUME_SPIKE,
        priority: AlertPriority.MEDIUM,
        enabled: false
      }));

      await alertService.registerAlert(createTestAlertConfig({
        id: 'btc-change-low',
        type: AlertType.PRICE_CHANGE,
        priority: AlertPriority.LOW
      }));
    });

    it('should return accurate alert statistics', async () => {
      const stats = await alertService.getStatistics();

      expect(stats.totalAlerts).toBe(3);
      expect(stats.activeAlerts).toBe(2); // One is disabled
      expect(stats.triggeredToday).toBe(0);
      expect(stats.triggeredThisWeek).toBe(0);
    });

    it('should track triggered alerts in statistics', async () => {
      // Trigger an alert
      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      await alertService.checkAlerts(marketData);

      const stats = await alertService.getStatistics();
      expect(stats.triggeredToday).toBe(1);
      expect(stats.triggeredThisWeek).toBe(1);
      expect(stats.byType[AlertType.PRICE_ABOVE]).toBe(1);
      expect(stats.byPriority[AlertPriority.HIGH]).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle notification failures gracefully', async () => {
      // Create a failing notification service
      const failingNotificationService: INotificationService = {
        async sendNotification() {
          throw new Error('Notification failed');
        },
        async sendBulkNotifications() {
          throw new Error('Bulk notification failed');
        },
        async registerTemplate() {
          // Mock implementation
        },
        async updateConfig() {
          // Mock implementation
        },
        async getConfig() {
          return null;
        },
        async testChannel() {
          return { success: false, channel: NotificationChannel.TELEGRAM };
        },
        async getNotificationHistory() {
          return [];
        },
        async formatMessage() {
          return 'test message';
        },
        async checkRateLimit() {
          return true;
        }
      };

      const failingAlertService = new UnifiedAlertService(mockLogger, failingNotificationService);

      await failingAlertService.registerAlert(createTestAlertConfig({
        cooldownMs: 1000
      }));

      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      // Should not throw, but should log error
      await expect(failingAlertService.checkAlerts(marketData)).resolves.not.toThrow();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to send alert notifications',
        expect.objectContaining({
          error: 'Notification failed'
        })
      );
    });

    it('should handle individual alert check failures', async () => {
      // Register an alert that will cause issues during check
      await alertService.registerAlert(createTestAlertConfig({
        id: 'problem-alert',
        thresholds: { value: NaN } // This should cause evaluation issues
      }));

      const marketData = createTestMarketData({
        symbol: 'BTC',
        price: 51000
      });

      const results = await alertService.checkAlerts(marketData);

      // Should return a result indicating failure
      const failedResults = results.filter(r => !r.triggered && r.reason?.includes('Check failed'));
      expect(failedResults.length).toBeGreaterThan(0);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking alert',
        expect.objectContaining({
          alertId: 'problem-alert'
        })
      );
    });
  });
});