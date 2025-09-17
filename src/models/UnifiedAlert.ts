import { getDatabase } from '../database/connection';
import { log } from '../utils/logger';
import { AlertConfig, AlertEvent, AlertType, AlertCondition, AlertPriority } from '../services/alerts/IAlertService';

export interface AlertRecord {
  id?: number;
  alert_id: string;
  user_id: string;
  chat_id: number;
  symbol: string;
  alert_type: AlertType;
  condition: AlertCondition;
  threshold_value: number;
  threshold_reference_price?: number;
  enabled: number;
  priority: AlertPriority;
  cooldown_ms: number;
  max_retries: number;
  notification_channels: string; // JSON string
  metadata?: string; // JSON string
  created_at?: string;
  updated_at?: string;
}

export interface AlertEventRecord {
  id?: number;
  event_id: string;
  alert_id: string;
  symbol: string;
  alert_type: AlertType;
  triggered_at: string;
  current_value: number;
  threshold_value: number;
  condition: AlertCondition;
  priority: AlertPriority;
  message: string;
  metadata?: string; // JSON string
  created_at?: string;
}

export class UnifiedAlertModel {

  /**
   * 初始化数据库表
   */
  static async initDatabase(): Promise<void> {
    try {
      const db = await getDatabase();

      // 创建alerts表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS unified_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alert_id TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          chat_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          condition TEXT NOT NULL,
          threshold_value REAL NOT NULL,
          threshold_reference_price REAL,
          enabled INTEGER NOT NULL DEFAULT 1,
          priority TEXT NOT NULL DEFAULT 'medium',
          cooldown_ms INTEGER NOT NULL DEFAULT 300000,
          max_retries INTEGER NOT NULL DEFAULT 3,
          notification_channels TEXT NOT NULL,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 创建alert_events表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS alert_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT UNIQUE NOT NULL,
          alert_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          triggered_at DATETIME NOT NULL,
          current_value REAL NOT NULL,
          threshold_value REAL NOT NULL,
          condition TEXT NOT NULL,
          priority TEXT NOT NULL,
          message TEXT NOT NULL,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (alert_id) REFERENCES unified_alerts (alert_id)
        )
      `);

      // 创建索引
      await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_alerts_user_symbol ON unified_alerts (user_id, symbol);
        CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON unified_alerts (enabled);
        CREATE INDEX IF NOT EXISTS idx_events_alert_id ON alert_events (alert_id);
        CREATE INDEX IF NOT EXISTS idx_events_triggered_at ON alert_events (triggered_at);
      `);

      log.info('Unified alerts database initialized successfully');
    } catch (error) {
      log.error('Failed to initialize unified alerts database:', error);
      throw error;
    }
  }

  /**
   * 保存警报配置
   */
  static async saveAlert(config: AlertConfig): Promise<void> {
    try {
      const db = await getDatabase();
      const metadata = config.metadata || {};

      const record: Omit<AlertRecord, 'id'> = {
        alert_id: config.id,
        user_id: metadata.userId || '',
        chat_id: metadata.chatId || 0,
        symbol: config.symbol,
        alert_type: config.type,
        condition: config.condition,
        threshold_value: config.thresholds.value,
        ...(config.thresholds.referencePrice !== undefined && { threshold_reference_price: config.thresholds.referencePrice }),
        enabled: config.enabled ? 1 : 0,
        priority: config.priority,
        cooldown_ms: config.cooldownMs,
        max_retries: config.maxRetries,
        notification_channels: JSON.stringify(config.notificationChannels),
        metadata: JSON.stringify(metadata)
      };

      await db.run(`
        INSERT OR REPLACE INTO unified_alerts (
          alert_id, user_id, chat_id, symbol, alert_type, condition,
          threshold_value, threshold_reference_price, enabled, priority,
          cooldown_ms, max_retries, notification_channels, metadata, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        record.alert_id, record.user_id, record.chat_id, record.symbol,
        record.alert_type, record.condition, record.threshold_value,
        record.threshold_reference_price, record.enabled, record.priority,
        record.cooldown_ms, record.max_retries, record.notification_channels,
        record.metadata
      ]);

      log.info('Alert saved successfully', { alertId: config.id });
    } catch (error) {
      log.error('Failed to save alert:', error);
      throw error;
    }
  }

  /**
   * 加载警报配置
   */
  static async loadAlerts(userId?: string): Promise<AlertConfig[]> {
    try {
      const db = await getDatabase();
      const query = userId
        ? `SELECT * FROM unified_alerts WHERE user_id = ? ORDER BY created_at DESC`
        : `SELECT * FROM unified_alerts ORDER BY created_at DESC`;

      const params = userId ? [userId] : [];
      const rows = await db.all(query, params) as AlertRecord[];

      return rows.map(row => this.recordToConfig(row));
    } catch (error) {
      log.error('Failed to load alerts:', error);
      throw error;
    }
  }

  /**
   * 删除警报
   */
  static async deleteAlert(alertId: string): Promise<boolean> {
    try {
      const db = await getDatabase();
      const result = await db.run('DELETE FROM unified_alerts WHERE alert_id = ?', [alertId]);
      return (result.changes || 0) > 0;
    } catch (error) {
      log.error('Failed to delete alert:', error);
      throw error;
    }
  }

  /**
   * 更新警报状态
   */
  static async updateAlertStatus(alertId: string, enabled: boolean): Promise<boolean> {
    try {
      const db = await getDatabase();
      const result = await db.run(
        'UPDATE unified_alerts SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE alert_id = ?',
        [enabled ? 1 : 0, alertId]
      );
      return (result.changes || 0) > 0;
    } catch (error) {
      log.error('Failed to update alert status:', error);
      throw error;
    }
  }

  /**
   * 保存警报事件
   */
  static async saveAlertEvent(event: AlertEvent): Promise<void> {
    try {
      const db = await getDatabase();

      const record: Omit<AlertEventRecord, 'id'> = {
        event_id: event.id,
        alert_id: event.alertId,
        symbol: event.symbol,
        alert_type: event.type,
        triggered_at: event.triggeredAt.toISOString(),
        current_value: event.currentValue,
        threshold_value: event.thresholdValue,
        condition: event.condition,
        priority: event.priority,
        message: event.message,
        metadata: JSON.stringify(event.metadata || {})
      };

      await db.run(`
        INSERT INTO alert_events (
          event_id, alert_id, symbol, alert_type, triggered_at,
          current_value, threshold_value, condition, priority, message, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        record.event_id, record.alert_id, record.symbol, record.alert_type,
        record.triggered_at, record.current_value, record.threshold_value,
        record.condition, record.priority, record.message, record.metadata
      ]);

      log.info('Alert event saved successfully', { eventId: event.id });
    } catch (error) {
      log.error('Failed to save alert event:', error);
      throw error;
    }
  }

  /**
   * 获取警报历史
   */
  static async getAlertHistory(alertId?: string, limit: number = 100): Promise<AlertEvent[]> {
    try {
      const db = await getDatabase();
      const query = alertId
        ? `SELECT * FROM alert_events WHERE alert_id = ? ORDER BY triggered_at DESC LIMIT ?`
        : `SELECT * FROM alert_events ORDER BY triggered_at DESC LIMIT ?`;

      const params = alertId ? [alertId, limit] : [limit];
      const rows = await db.all(query, params) as AlertEventRecord[];

      return rows.map(row => this.recordToEvent(row));
    } catch (error) {
      log.error('Failed to get alert history:', error);
      throw error;
    }
  }

  /**
   * 清理过期的警报历史
   */
  static async cleanupHistory(olderThanMs: number): Promise<number> {
    try {
      const db = await getDatabase();
      const cutoffDate = new Date(Date.now() - olderThanMs).toISOString();

      const result = await db.run(
        'DELETE FROM alert_events WHERE triggered_at < ?',
        [cutoffDate]
      );

      const deletedCount = result.changes || 0;
      log.info('Alert history cleaned up', { deletedCount });
      return deletedCount;
    } catch (error) {
      log.error('Failed to cleanup alert history:', error);
      throw error;
    }
  }

  /**
   * 转换数据库记录为AlertConfig
   */
  private static recordToConfig(record: AlertRecord): AlertConfig {
    return {
      id: record.alert_id,
      symbol: record.symbol,
      type: record.alert_type,
      condition: record.condition,
      thresholds: {
        value: record.threshold_value,
        ...(record.threshold_reference_price !== undefined && { referencePrice: record.threshold_reference_price })
      },
      enabled: record.enabled === 1,
      notificationChannels: JSON.parse(record.notification_channels || '[]'),
      cooldownMs: record.cooldown_ms,
      maxRetries: record.max_retries,
      priority: record.priority,
      metadata: record.metadata ? JSON.parse(record.metadata) : {}
    };
  }

  /**
   * 转换数据库记录为AlertEvent
   */
  private static recordToEvent(record: AlertEventRecord): AlertEvent {
    return {
      id: record.event_id,
      alertId: record.alert_id,
      symbol: record.symbol,
      type: record.alert_type,
      triggeredAt: new Date(record.triggered_at),
      currentValue: record.current_value,
      thresholdValue: record.threshold_value,
      condition: record.condition,
      priority: record.priority,
      message: record.message,
      metadata: record.metadata ? JSON.parse(record.metadata) : {}
    };
  }
}