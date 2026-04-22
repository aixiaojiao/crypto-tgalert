import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

export interface PotentialAlertRecord {
  id?: number;
  symbol: string;
  level: 1 | 2 | 3;
  priceChange1h: number;       // 语义：窗口内价格变化%（当前窗口=24h），DB 字段历史命名保留
  oiChange1h: number;          // 语义：窗口内 OI 变化%
  fundingRate8h: number;       // 已归一化为 8h
  fundingIntervalHours: number; // 原始周期（用于判断是否异常）
  fundingMax24h: number;        // 近 24h 费率最大值（未归一化）
  currentPrice: number;
  volume24h: number;
  triggeredAt: number; // unix ms
}

/**
 * 潜力币信号报警模型
 * 表 potential_alerts：存储历史触发记录
 * 表 potential_alert_config：存储推送开关等配置
 */
export class PotentialAlertModel {
  private static db: Database.Database;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);

      // 报警记录表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS potential_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
          price_change_1h REAL NOT NULL,
          oi_change_1h REAL NOT NULL,
          funding_rate_8h REAL NOT NULL,
          funding_interval_hours INTEGER NOT NULL,
          funding_max_24h REAL NOT NULL,
          current_price REAL NOT NULL,
          volume_24h REAL NOT NULL,
          triggered_at INTEGER NOT NULL
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_potential_symbol_time
        ON potential_alerts(symbol, triggered_at DESC)
      `);

      // 配置表（开关等）
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS potential_alert_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      log.info('PotentialAlertModel database initialized');
    } catch (error) {
      log.error('Failed to initialize PotentialAlertModel database', error);
      throw error;
    }
  }

  /**
   * 记录一次触发
   */
  static recordAlert(record: PotentialAlertRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO potential_alerts (
        symbol, level, price_change_1h, oi_change_1h,
        funding_rate_8h, funding_interval_hours, funding_max_24h,
        current_price, volume_24h, triggered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      record.symbol,
      record.level,
      record.priceChange1h,
      record.oiChange1h,
      record.fundingRate8h,
      record.fundingIntervalHours,
      record.fundingMax24h,
      record.currentPrice,
      record.volume24h,
      record.triggeredAt
    );

    return result.lastInsertRowid as number;
  }

  /**
   * 查找某 symbol 最近一次的触发记录（用于去重和等级变化检测）
   */
  static getLastAlert(symbol: string): PotentialAlertRecord | null {
    const row = this.db.prepare(`
      SELECT
        id, symbol, level,
        price_change_1h as priceChange1h,
        oi_change_1h as oiChange1h,
        funding_rate_8h as fundingRate8h,
        funding_interval_hours as fundingIntervalHours,
        funding_max_24h as fundingMax24h,
        current_price as currentPrice,
        volume_24h as volume24h,
        triggered_at as triggeredAt
      FROM potential_alerts
      WHERE symbol = ?
      ORDER BY triggered_at DESC
      LIMIT 1
    `).get(symbol) as PotentialAlertRecord | undefined;

    return row || null;
  }

  /**
   * 返回指定时间窗口内的所有告警（升序）
   */
  static listSince(sinceMs: number): PotentialAlertRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id, symbol, level,
        price_change_1h as priceChange1h,
        oi_change_1h as oiChange1h,
        funding_rate_8h as fundingRate8h,
        funding_interval_hours as fundingIntervalHours,
        funding_max_24h as fundingMax24h,
        current_price as currentPrice,
        volume_24h as volume24h,
        triggered_at as triggeredAt
      FROM potential_alerts
      WHERE triggered_at >= ?
      ORDER BY triggered_at ASC
    `).all(sinceMs);
    return rows as PotentialAlertRecord[];
  }

  /**
   * 获取今日触发统计
   */
  static getTodayStats(): { total: number; byLevel: Record<number, number> } {
    const startOfDayMs = new Date().setHours(0, 0, 0, 0);

    const total = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM potential_alerts WHERE triggered_at >= ?
    `).get(startOfDayMs) as { cnt: number }).cnt;

    const byLevelRows = this.db.prepare(`
      SELECT level, COUNT(*) as cnt FROM potential_alerts
      WHERE triggered_at >= ?
      GROUP BY level
    `).all(startOfDayMs) as Array<{ level: number; cnt: number }>;

    const byLevel: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    byLevelRows.forEach(r => { byLevel[r.level] = r.cnt; });

    return { total, byLevel };
  }

  // ---- 配置存取 ----

  static getConfig(key: string): string | null {
    const row = this.db.prepare(
      `SELECT value FROM potential_alert_config WHERE key = ?`
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  static setConfig(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO potential_alert_config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  }

  static isEnabled(): boolean {
    return this.getConfig('enabled') === 'true';
  }

  static setEnabled(enabled: boolean): void {
    this.setConfig('enabled', enabled ? 'true' : 'false');
  }
}
