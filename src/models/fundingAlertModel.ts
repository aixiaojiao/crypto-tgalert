import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

/**
 * 费率报警类型
 * - negative: 费率首次降为负数
 * - rate_-0.5 / rate_-1 / rate_-1.5: 费率首次突破阈值
 * - interval_4h / interval_1h: 费率周期首次变为 4h / 1h
 */
export type FundingAlertType =
  | 'negative'
  | 'rate_-0.5'
  | 'rate_-1'
  | 'rate_-1.5'
  | 'interval_4h'
  | 'interval_1h';

export interface FundingAlertRecord {
  id?: number;
  symbol: string;
  alertType: FundingAlertType;
  fundingRate8h: number;        // 8h 归一化费率
  fundingIntervalHours: number; // 原始结算周期
  triggeredAt: number;          // unix ms
}

/**
 * 费率报警模型
 * 表 funding_alerts：存储历史触发记录
 * 表 funding_alert_config：存储推送开关等配置
 */
export class FundingAlertModel {
  private static db: Database.Database;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS funding_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          funding_rate_8h REAL NOT NULL,
          funding_interval_hours INTEGER NOT NULL,
          triggered_at INTEGER NOT NULL
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_funding_alerts_symbol_type_time
        ON funding_alerts(symbol, alert_type, triggered_at DESC)
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS funding_alert_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS funding_rate_state (
          symbol TEXT PRIMARY KEY,
          last_rate_8h REAL NOT NULL,
          last_scanned_at INTEGER NOT NULL,
          last_interval_hours INTEGER
        )
      `);

      // 迁移：老版本表没有 last_interval_hours 列，缺则补上（NULL 允许）
      const cols = this.db.prepare(`PRAGMA table_info(funding_rate_state)`).all() as Array<{ name: string }>;
      if (!cols.some(c => c.name === 'last_interval_hours')) {
        this.db.exec(`ALTER TABLE funding_rate_state ADD COLUMN last_interval_hours INTEGER`);
        log.info('Migrated funding_rate_state: added last_interval_hours column');
      }

      log.info('FundingAlertModel database initialized');
    } catch (error) {
      log.error('Failed to initialize FundingAlertModel database', error);
      throw error;
    }
  }

  /**
   * 记录一次触发
   */
  static recordAlert(record: FundingAlertRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO funding_alerts (
        symbol, alert_type, funding_rate_8h,
        funding_interval_hours, triggered_at
      ) VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      record.symbol,
      record.alertType,
      record.fundingRate8h,
      record.fundingIntervalHours,
      record.triggeredAt
    );

    return result.lastInsertRowid as number;
  }

  /**
   * 去重窗口（4 小时）：同 symbol + alertType 在此窗口内只报一次
   */
  static readonly DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000;

  /**
   * 检查某 symbol + alertType 在去重窗口内（最近 4 小时）是否已报警
   */
  static hasAlertedRecently(symbol: string, alertType: FundingAlertType): boolean {
    const cutoffMs = Date.now() - this.DEDUP_WINDOW_MS;

    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM funding_alerts
      WHERE symbol = ? AND alert_type = ? AND triggered_at >= ?
    `).get(symbol, alertType, cutoffMs) as { cnt: number };

    return row.cnt > 0;
  }

  /**
   * 返回指定时间窗口内的所有告警（升序）
   */
  static listSince(sinceMs: number): FundingAlertRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id, symbol,
        alert_type as alertType,
        funding_rate_8h as fundingRate8h,
        funding_interval_hours as fundingIntervalHours,
        triggered_at as triggeredAt
      FROM funding_alerts
      WHERE triggered_at >= ?
      ORDER BY triggered_at ASC
    `).all(sinceMs);
    return rows as FundingAlertRecord[];
  }

  /**
   * 获取今日（UTC+8）触发统计
   */
  static getTodayStats(): { total: number; byType: Record<string, number> } {
    const todayStartMs = this.getTodayStartMs();

    const total = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM funding_alerts WHERE triggered_at >= ?
    `).get(todayStartMs) as { cnt: number }).cnt;

    const byTypeRows = this.db.prepare(`
      SELECT alert_type, COUNT(*) as cnt FROM funding_alerts
      WHERE triggered_at >= ?
      GROUP BY alert_type
    `).all(todayStartMs) as Array<{ alert_type: string; cnt: number }>;

    const byType: Record<string, number> = {};
    byTypeRows.forEach(r => { byType[r.alert_type] = r.cnt; });

    return { total, byType };
  }

  /**
   * 获取今天 UTC+8 00:00 的 unix ms
   */
  private static getTodayStartMs(): number {
    const now = new Date();
    // UTC+8
    const utc8Offset = 8 * 60 * 60 * 1000;
    const utc8Now = now.getTime() + utc8Offset;
    const utc8DayStart = Math.floor(utc8Now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
    return utc8DayStart - utc8Offset;
  }

  // ---- 配置存取 ----

  static getConfig(key: string): string | null {
    const row = this.db.prepare(
      `SELECT value FROM funding_alert_config WHERE key = ?`
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  static setConfig(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO funding_alert_config (key, value, updated_at)
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

  // ---- 费率/周期状态（用于边沿触发） ----

  /**
   * 获取某 symbol 上次扫描记录的状态
   * 返回 null 表示从未记录过；字段为 null 表示该列历史缺失
   */
  static getLastState(symbol: string): { rate: number; intervalHours: number | null } | null {
    const row = this.db.prepare(
      `SELECT last_rate_8h, last_interval_hours FROM funding_rate_state WHERE symbol = ?`
    ).get(symbol) as { last_rate_8h: number; last_interval_hours: number | null } | undefined;
    if (!row) return null;
    return { rate: row.last_rate_8h, intervalHours: row.last_interval_hours ?? null };
  }

  /** 保留旧 API 兼容（若有外部引用，仅返回 rate） */
  static getLastRate(symbol: string): number | null {
    return this.getLastState(symbol)?.rate ?? null;
  }

  /**
   * upsert 费率/周期状态（每次扫描结束后调用）
   */
  static upsertRateState(symbol: string, rate: number, intervalHours: number, ts: number): void {
    this.db.prepare(`
      INSERT INTO funding_rate_state (symbol, last_rate_8h, last_scanned_at, last_interval_hours)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        last_rate_8h = excluded.last_rate_8h,
        last_scanned_at = excluded.last_scanned_at,
        last_interval_hours = excluded.last_interval_hours
    `).run(symbol, rate, ts, intervalHours);
  }
}
