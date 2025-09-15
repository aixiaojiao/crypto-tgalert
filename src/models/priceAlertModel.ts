import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

export interface PriceAlertConfig {
  id?: number;
  userId: string;
  symbol?: string | null; // null表示全部代币
  timeframe: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '24h' | '3d';
  alertType: 'gain' | 'loss' | 'both'; // 涨幅/跌幅/双向
  thresholdPercent: number; // 触发阈值百分比
  isEnabled: boolean;
  createdAt: string;
  lastTriggered?: string;
  triggerCount: number;
}

export interface PriceAlertTrigger {
  id?: number;
  configId: number;
  symbol: string;
  timeframe: string;
  changePercent: number;
  fromPrice: number;
  toPrice: number;
  triggeredAt: string;
  volume24h: number;
}

export class PriceAlertModel {
  private static db: Database.Database;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);

      // 创建报警配置表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS price_alert_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          symbol TEXT, -- NULL表示全部代币
          timeframe TEXT NOT NULL CHECK (timeframe IN ('1m', '5m', '15m', '30m', '1h', '4h', '24h', '3d')),
          alert_type TEXT NOT NULL CHECK (alert_type IN ('gain', 'loss', 'both')),
          threshold_percent REAL NOT NULL,
          is_enabled BOOLEAN NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_triggered TEXT,
          trigger_count INTEGER NOT NULL DEFAULT 0
        )
      `);

      // 创建报警触发记录表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS price_alert_triggers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          config_id INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          change_percent REAL NOT NULL,
          from_price REAL NOT NULL,
          to_price REAL NOT NULL,
          triggered_at TEXT NOT NULL DEFAULT (datetime('now')),
          volume_24h REAL NOT NULL DEFAULT 0,
          FOREIGN KEY (config_id) REFERENCES price_alert_configs (id)
        )
      `);

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_alert_configs_user_enabled
        ON price_alert_configs(user_id, is_enabled);

        CREATE INDEX IF NOT EXISTS idx_alert_triggers_config_time
        ON price_alert_triggers(config_id, triggered_at);

        CREATE INDEX IF NOT EXISTS idx_alert_triggers_symbol_time
        ON price_alert_triggers(symbol, triggered_at);
      `);

      log.info('Price alert database initialized successfully');
    } catch (error) {
      log.error('Failed to initialize price alert database', error);
      throw error;
    }
  }

  // 添加报警配置
  static async addAlert(config: Omit<PriceAlertConfig, 'id' | 'createdAt' | 'triggerCount'>): Promise<number> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO price_alert_configs
        (user_id, symbol, timeframe, alert_type, threshold_percent, is_enabled)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        config.userId,
        config.symbol || null,
        config.timeframe,
        config.alertType,
        config.thresholdPercent,
        config.isEnabled ? 1 : 0
      );

      log.info(`Added price alert config`, {
        id: result.lastInsertRowid,
        userId: config.userId,
        symbol: config.symbol || 'ALL',
        timeframe: config.timeframe,
        threshold: config.thresholdPercent
      });

      return result.lastInsertRowid as number;
    } catch (error) {
      log.error('Failed to add price alert config', error);
      throw error;
    }
  }

  // 获取用户的报警配置
  static async getUserAlerts(userId: string): Promise<PriceAlertConfig[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT
          id, user_id as userId, symbol, timeframe, alert_type as alertType,
          threshold_percent as thresholdPercent, is_enabled as isEnabled,
          created_at as createdAt, last_triggered as lastTriggered,
          trigger_count as triggerCount
        FROM price_alert_configs
        WHERE user_id = ?
        ORDER BY created_at DESC
      `);

      return stmt.all(userId) as PriceAlertConfig[];
    } catch (error) {
      log.error('Failed to get user alerts', error);
      throw error;
    }
  }

  // 获取启用的报警配置
  static async getEnabledAlerts(): Promise<PriceAlertConfig[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT
          id, user_id as userId, symbol, timeframe, alert_type as alertType,
          threshold_percent as thresholdPercent, is_enabled as isEnabled,
          created_at as createdAt, last_triggered as lastTriggered,
          trigger_count as triggerCount
        FROM price_alert_configs
        WHERE is_enabled = 1
        ORDER BY created_at DESC
      `);

      return stmt.all() as PriceAlertConfig[];
    } catch (error) {
      log.error('Failed to get enabled alerts', error);
      throw error;
    }
  }

  // 更新报警状态
  static async toggleAlert(id: number, enabled: boolean): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        UPDATE price_alert_configs
        SET is_enabled = ?
        WHERE id = ?
      `);

      const result = stmt.run(enabled ? 1 : 0, id);
      return result.changes > 0;
    } catch (error) {
      log.error('Failed to toggle alert', error);
      throw error;
    }
  }

  // 删除报警配置
  static async deleteAlert(id: number, userId: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM price_alert_configs
        WHERE id = ? AND user_id = ?
      `);

      const result = stmt.run(id, userId);
      return result.changes > 0;
    } catch (error) {
      log.error('Failed to delete alert', error);
      throw error;
    }
  }

  // 记录报警触发
  static async recordTrigger(trigger: Omit<PriceAlertTrigger, 'id' | 'triggeredAt'>): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO price_alert_triggers
        (config_id, symbol, timeframe, change_percent, from_price, to_price, volume_24h)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        trigger.configId,
        trigger.symbol,
        trigger.timeframe,
        trigger.changePercent,
        trigger.fromPrice,
        trigger.toPrice,
        trigger.volume24h
      );

      // 更新配置的触发统计
      const updateStmt = this.db.prepare(`
        UPDATE price_alert_configs
        SET trigger_count = trigger_count + 1, last_triggered = datetime('now')
        WHERE id = ?
      `);
      updateStmt.run(trigger.configId);

    } catch (error) {
      log.error('Failed to record alert trigger', error);
      throw error;
    }
  }

  // 获取报警触发历史
  static async getTriggerHistory(userId: string, limit: number = 50): Promise<PriceAlertTrigger[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT
          t.id, t.config_id as configId, t.symbol, t.timeframe,
          t.change_percent as changePercent, t.from_price as fromPrice,
          t.to_price as toPrice, t.triggered_at as triggeredAt,
          t.volume_24h as volume24h
        FROM price_alert_triggers t
        JOIN price_alert_configs c ON t.config_id = c.id
        WHERE c.user_id = ?
        ORDER BY t.triggered_at DESC
        LIMIT ?
      `);

      return stmt.all(userId, limit) as PriceAlertTrigger[];
    } catch (error) {
      log.error('Failed to get trigger history', error);
      throw error;
    }
  }

  // 清理旧的触发记录 (保留最近30天)
  static async cleanupOldTriggers(): Promise<number> {
    try {
      const stmt = this.db.prepare(`
        DELETE FROM price_alert_triggers
        WHERE triggered_at < datetime('now', '-30 days')
      `);

      const result = stmt.run();
      if (result.changes > 0) {
        log.info(`Cleaned up ${result.changes} old price alert triggers`);
      }
      return result.changes;
    } catch (error) {
      log.error('Failed to cleanup old triggers', error);
      throw error;
    }
  }
}