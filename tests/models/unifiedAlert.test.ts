import { UnifiedAlertModel } from '../../src/models/UnifiedAlert';
import { AlertConfig, AlertType, AlertCondition, AlertPriority, NotificationChannel } from '../../src/services/alerts/IAlertService';
import { getDatabase, initDatabase } from '../../src/database/connection';

describe('UnifiedAlertModel', () => {
  beforeAll(async () => {
    // Initialize test database with in-memory DB for testing
    await initDatabase(':memory:');
    await UnifiedAlertModel.initDatabase();
  });

  beforeEach(async () => {
    // Clear test data before each test
    const db = await getDatabase();
    await db.exec('DELETE FROM unified_alerts');
    await db.exec('DELETE FROM alert_events');
  });

  describe('Database Initialization', () => {
    it('should initialize database tables without errors', async () => {
      await expect(UnifiedAlertModel.initDatabase()).resolves.not.toThrow();
    });

    it('should create unified_alerts table with correct schema', async () => {
      const db = await getDatabase();
      const tableInfo = await db.all("PRAGMA table_info(unified_alerts)");

      const expectedColumns = [
        'id', 'alert_id', 'user_id', 'chat_id', 'symbol', 'alert_type',
        'condition', 'threshold_value', 'threshold_reference_price',
        'enabled', 'priority', 'cooldown_ms', 'max_retries',
        'notification_channels', 'metadata', 'created_at', 'updated_at'
      ];

      const actualColumns = tableInfo.map((col: any) => col.name);
      expectedColumns.forEach(col => {
        expect(actualColumns).toContain(col);
      });
    });

    it('should create alert_events table with correct schema', async () => {
      const db = await getDatabase();
      const tableInfo = await db.all("PRAGMA table_info(alert_events)");

      const expectedColumns = [
        'id', 'event_id', 'alert_id', 'symbol', 'alert_type',
        'triggered_at', 'current_value', 'threshold_value', 'condition',
        'priority', 'message', 'metadata', 'created_at'
      ];

      const actualColumns = tableInfo.map((col: any) => col.name);
      expectedColumns.forEach(col => {
        expect(actualColumns).toContain(col);
      });
    });
  });

  describe('Alert Configuration Management', () => {
    const createTestAlertConfig = (): AlertConfig => ({
      id: 'test-user-BTC-123456789',
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
        chatId: 123456789,
        createdAt: new Date().toISOString()
      }
    });

    it('should save alert configuration successfully', async () => {
      const config = createTestAlertConfig();

      await expect(UnifiedAlertModel.saveAlert(config)).resolves.not.toThrow();

      // Verify the alert was saved
      const alerts = await UnifiedAlertModel.loadAlerts('test-user');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].id).toBe(config.id);
      expect(alerts[0].symbol).toBe(config.symbol);
      expect(alerts[0].enabled).toBe(config.enabled);
    });

    it('should load alerts for specific user', async () => {
      const config1 = createTestAlertConfig();
      const config2 = { ...createTestAlertConfig(), id: 'test-user-ETH-987654321', symbol: 'ETH' };
      const config3 = { ...createTestAlertConfig(), id: 'other-user-BTC-111111111', metadata: { userId: 'other-user', chatId: 111111111 } };

      await UnifiedAlertModel.saveAlert(config1);
      await UnifiedAlertModel.saveAlert(config2);
      await UnifiedAlertModel.saveAlert(config3);

      const userAlerts = await UnifiedAlertModel.loadAlerts('test-user');
      expect(userAlerts).toHaveLength(2);

      const otherUserAlerts = await UnifiedAlertModel.loadAlerts('other-user');
      expect(otherUserAlerts).toHaveLength(1);
    });

    it('should load all alerts when no userId specified', async () => {
      const config1 = createTestAlertConfig();
      const config2 = { ...createTestAlertConfig(), id: 'other-user-BTC-222222222', metadata: { userId: 'other-user', chatId: 222222222 } };

      await UnifiedAlertModel.saveAlert(config1);
      await UnifiedAlertModel.saveAlert(config2);

      const allAlerts = await UnifiedAlertModel.loadAlerts();
      expect(allAlerts).toHaveLength(2);
    });

    it('should update existing alert on save with same ID', async () => {
      const config = createTestAlertConfig();
      await UnifiedAlertModel.saveAlert(config);

      // Update the alert
      const updatedConfig = { ...config, enabled: false, thresholds: { value: 60000 } };
      await UnifiedAlertModel.saveAlert(updatedConfig);

      const alerts = await UnifiedAlertModel.loadAlerts('test-user');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].enabled).toBe(false);
      expect(alerts[0].thresholds.value).toBe(60000);
    });

    it('should delete alert successfully', async () => {
      const config = createTestAlertConfig();
      await UnifiedAlertModel.saveAlert(config);

      const deleted = await UnifiedAlertModel.deleteAlert(config.id);
      expect(deleted).toBe(true);

      const alerts = await UnifiedAlertModel.loadAlerts('test-user');
      expect(alerts).toHaveLength(0);
    });

    it('should return false when deleting non-existent alert', async () => {
      const deleted = await UnifiedAlertModel.deleteAlert('non-existent-id');
      expect(deleted).toBe(false);
    });

    it('should update alert status successfully', async () => {
      const config = createTestAlertConfig();
      await UnifiedAlertModel.saveAlert(config);

      const updated = await UnifiedAlertModel.updateAlertStatus(config.id, false);
      expect(updated).toBe(true);

      const alerts = await UnifiedAlertModel.loadAlerts('test-user');
      expect(alerts[0].enabled).toBe(false);
    });

    it('should return false when updating status of non-existent alert', async () => {
      const updated = await UnifiedAlertModel.updateAlertStatus('non-existent-id', false);
      expect(updated).toBe(false);
    });
  });

  describe('Alert Event Management', () => {
    const createTestAlertEvent = () => ({
      id: 'event-123456789',
      alertId: 'test-user-BTC-123456789',
      symbol: 'BTC',
      type: AlertType.PRICE_ABOVE,
      triggeredAt: new Date(),
      currentValue: 51000,
      thresholdValue: 50000,
      condition: AlertCondition.GREATER_THAN,
      priority: AlertPriority.MEDIUM,
      message: 'BTC price is above 50000! Current: 51000',
      metadata: { test: true }
    });

    it('should save alert event successfully', async () => {
      const event = createTestAlertEvent();

      await expect(UnifiedAlertModel.saveAlertEvent(event)).resolves.not.toThrow();

      // Verify the event was saved
      const history = await UnifiedAlertModel.getAlertHistory();
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe(event.id);
      expect(history[0].alertId).toBe(event.alertId);
      expect(history[0].currentValue).toBe(event.currentValue);
    });

    it('should get alert history for specific alert', async () => {
      const event1 = createTestAlertEvent();
      const event2 = { ...createTestAlertEvent(), id: 'event-987654321', alertId: 'other-alert-id' };

      await UnifiedAlertModel.saveAlertEvent(event1);
      await UnifiedAlertModel.saveAlertEvent(event2);

      const specificHistory = await UnifiedAlertModel.getAlertHistory('test-user-BTC-123456789');
      expect(specificHistory).toHaveLength(1);
      expect(specificHistory[0].alertId).toBe('test-user-BTC-123456789');

      const allHistory = await UnifiedAlertModel.getAlertHistory();
      expect(allHistory).toHaveLength(2);
    });

    it('should respect limit parameter in getAlertHistory', async () => {
      // Create multiple events
      for (let i = 0; i < 5; i++) {
        const event = { ...createTestAlertEvent(), id: `event-${i}` };
        await UnifiedAlertModel.saveAlertEvent(event);
      }

      const limitedHistory = await UnifiedAlertModel.getAlertHistory(undefined, 3);
      expect(limitedHistory).toHaveLength(3);
    });

    it('should cleanup old alert history', async () => {
      const now = Date.now();
      const oldEvent = {
        ...createTestAlertEvent(),
        id: 'old-event',
        triggeredAt: new Date(now - 7 * 24 * 60 * 60 * 1000) // 7 days ago
      };
      const recentEvent = {
        ...createTestAlertEvent(),
        id: 'recent-event',
        triggeredAt: new Date(now - 1000) // 1 second ago
      };

      await UnifiedAlertModel.saveAlertEvent(oldEvent);
      await UnifiedAlertModel.saveAlertEvent(recentEvent);

      // Cleanup events older than 3 days
      const deletedCount = await UnifiedAlertModel.cleanupHistory(3 * 24 * 60 * 60 * 1000);
      expect(deletedCount).toBe(1);

      const remainingHistory = await UnifiedAlertModel.getAlertHistory();
      expect(remainingHistory).toHaveLength(1);
      expect(remainingHistory[0].id).toBe('recent-event');
    });
  });

  describe('Data Conversion', () => {
    it('should correctly convert database record to AlertConfig', async () => {
      const originalConfig: AlertConfig = {
        id: 'test-conversion-123',
        symbol: 'ETH',
        type: AlertType.PRICE_BELOW,
        condition: AlertCondition.LESS_THAN,
        thresholds: {
          value: 3000,
          referencePrice: 3500
        },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM, NotificationChannel.EMAIL],
        cooldownMs: 600000,
        maxRetries: 5,
        priority: AlertPriority.HIGH,
        metadata: {
          userId: 'test-user',
          chatId: 987654321,
          customField: 'test-value'
        }
      };

      await UnifiedAlertModel.saveAlert(originalConfig);
      const loadedAlerts = await UnifiedAlertModel.loadAlerts('test-user');

      expect(loadedAlerts).toHaveLength(1);
      const loadedConfig = loadedAlerts[0];

      expect(loadedConfig.id).toBe(originalConfig.id);
      expect(loadedConfig.symbol).toBe(originalConfig.symbol);
      expect(loadedConfig.type).toBe(originalConfig.type);
      expect(loadedConfig.condition).toBe(originalConfig.condition);
      expect(loadedConfig.thresholds.value).toBe(originalConfig.thresholds.value);
      expect(loadedConfig.thresholds.referencePrice).toBe(originalConfig.thresholds.referencePrice);
      expect(loadedConfig.enabled).toBe(originalConfig.enabled);
      expect(loadedConfig.notificationChannels).toEqual(originalConfig.notificationChannels);
      expect(loadedConfig.cooldownMs).toBe(originalConfig.cooldownMs);
      expect(loadedConfig.maxRetries).toBe(originalConfig.maxRetries);
      expect(loadedConfig.priority).toBe(originalConfig.priority);
      expect(loadedConfig.metadata).toEqual(originalConfig.metadata);
    });

    it('should correctly convert database record to AlertEvent', async () => {
      const originalEvent = {
        id: 'test-event-conversion',
        alertId: 'test-alert-id',
        symbol: 'DOT',
        type: AlertType.VOLUME_SPIKE,
        triggeredAt: new Date('2023-12-01T10:30:00Z'),
        currentValue: 1500000,
        thresholdValue: 1000000,
        condition: AlertCondition.GREATER_THAN,
        priority: AlertPriority.CRITICAL,
        message: 'DOT volume spike detected!',
        metadata: { spike_ratio: 2.5, previous_volume: 600000 }
      };

      await UnifiedAlertModel.saveAlertEvent(originalEvent);
      const loadedEvents = await UnifiedAlertModel.getAlertHistory();

      expect(loadedEvents).toHaveLength(1);
      const loadedEvent = loadedEvents[0];

      expect(loadedEvent.id).toBe(originalEvent.id);
      expect(loadedEvent.alertId).toBe(originalEvent.alertId);
      expect(loadedEvent.symbol).toBe(originalEvent.symbol);
      expect(loadedEvent.type).toBe(originalEvent.type);
      expect(loadedEvent.triggeredAt.toISOString()).toBe(originalEvent.triggeredAt.toISOString());
      expect(loadedEvent.currentValue).toBe(originalEvent.currentValue);
      expect(loadedEvent.thresholdValue).toBe(originalEvent.thresholdValue);
      expect(loadedEvent.condition).toBe(originalEvent.condition);
      expect(loadedEvent.priority).toBe(originalEvent.priority);
      expect(loadedEvent.message).toBe(originalEvent.message);
      expect(loadedEvent.metadata).toEqual(originalEvent.metadata);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully during save', async () => {
      // Test with invalid data that should cause constraint violation
      const invalidConfig = {
        id: '', // Empty ID should cause issues
        symbol: 'BTC',
        type: AlertType.PRICE_ABOVE,
        condition: AlertCondition.GREATER_THAN,
        thresholds: { value: 50000 },
        enabled: true,
        notificationChannels: [NotificationChannel.TELEGRAM],
        cooldownMs: 300000,
        maxRetries: 3,
        priority: AlertPriority.MEDIUM,
        metadata: {}
      } as AlertConfig;

      await expect(UnifiedAlertModel.saveAlert(invalidConfig)).rejects.toThrow();
    });

    it('should handle database errors gracefully during event save', async () => {
      const invalidEvent = {
        id: '',
        alertId: '',
        symbol: '',
        type: AlertType.PRICE_ABOVE,
        triggeredAt: new Date(),
        currentValue: 0,
        thresholdValue: 0,
        condition: AlertCondition.GREATER_THAN,
        priority: AlertPriority.MEDIUM,
        message: ''
      };

      await expect(UnifiedAlertModel.saveAlertEvent(invalidEvent)).rejects.toThrow();
    });
  });
});