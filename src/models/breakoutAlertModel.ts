import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';
import { HighTimeframe } from './historicalHighModel';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

/**
 * 突破档位
 *   L3_weak     — 突破 7d 高点
 *   L2_mid      — 突破 30d 高点
 *   L1_strong   — 突破 180d 高点
 *   L1_extreme  — 突破 52w 或 ATH 高点（结构性）
 *
 * 档位由 timeframe 映射而来，见 BreakoutAlertService.tierOf()
 */
export type BreakoutTier = 'L3_weak' | 'L2_mid' | 'L1_strong' | 'L1_extreme';

export const ALL_TIERS: BreakoutTier[] = ['L3_weak', 'L2_mid', 'L1_strong', 'L1_extreme'];

export interface BreakoutAlertRecord {
  id?: number;
  symbol: string;
  tier: BreakoutTier;
  timeframe: HighTimeframe;   // 突破的参考 timeframe（7d / 30d / 180d / 52w / ATH）
  refHigh: number;            // 参考高点价格
  currentPrice: number;       // 触发时的当前价
  breakPct: number;           // (current - refHigh) / refHigh * 100
  volumeRatio: number;        // 1h 量 / 20h 均量
  triggeredAt: number;        // unix ms
}

/**
 * 突破报警模型
 */
export class BreakoutAlertModel {
  private static db: Database.Database;

  /** 冷却窗口：同 symbol + 同 tier 在此时间内只报一次 */
  static readonly DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS breakout_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          tier TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          ref_high REAL NOT NULL,
          current_price REAL NOT NULL,
          break_pct REAL NOT NULL,
          volume_ratio REAL NOT NULL,
          triggered_at INTEGER NOT NULL
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_breakout_alerts_symbol_tier_time
        ON breakout_alerts(symbol, tier, triggered_at DESC)
      `);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS breakout_alert_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      log.info('BreakoutAlertModel database initialized');
    } catch (error) {
      log.error('Failed to initialize BreakoutAlertModel database', error);
      throw error;
    }
  }

  static recordAlert(record: BreakoutAlertRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO breakout_alerts (
        symbol, tier, timeframe, ref_high, current_price,
        break_pct, volume_ratio, triggered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.symbol,
      record.tier,
      record.timeframe,
      record.refHigh,
      record.currentPrice,
      record.breakPct,
      record.volumeRatio,
      record.triggeredAt,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 检查同 symbol + 同 tier 是否在冷却窗口内已报过
   */
  static hasAlertedRecently(symbol: string, tier: BreakoutTier): boolean {
    const cutoff = Date.now() - this.DEDUP_WINDOW_MS;
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM breakout_alerts
      WHERE symbol = ? AND tier = ? AND triggered_at >= ?
    `).get(symbol, tier, cutoff) as { cnt: number };
    return row.cnt > 0;
  }

  /**
   * 返回指定时间窗口内的所有告警（升序）
   */
  static listSince(sinceMs: number): BreakoutAlertRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id, symbol, tier, timeframe,
        ref_high as refHigh,
        current_price as currentPrice,
        break_pct as breakPct,
        volume_ratio as volumeRatio,
        triggered_at as triggeredAt
      FROM breakout_alerts
      WHERE triggered_at >= ?
      ORDER BY triggered_at ASC
    `).all(sinceMs);
    return rows as BreakoutAlertRecord[];
  }

  /**
   * 今日（UTC+8）触发统计（按档位分组）
   */
  static getTodayStats(): { total: number; byTier: Record<string, number> } {
    const todayStartMs = this.getTodayStartMs();

    const total = (this.db.prepare(`
      SELECT COUNT(*) as cnt FROM breakout_alerts WHERE triggered_at >= ?
    `).get(todayStartMs) as { cnt: number }).cnt;

    const byTierRows = this.db.prepare(`
      SELECT tier, COUNT(*) as cnt FROM breakout_alerts
      WHERE triggered_at >= ?
      GROUP BY tier
    `).all(todayStartMs) as Array<{ tier: string; cnt: number }>;

    const byTier: Record<string, number> = {};
    byTierRows.forEach(r => { byTier[r.tier] = r.cnt; });

    return { total, byTier };
  }

  private static getTodayStartMs(): number {
    const now = new Date();
    const utc8Offset = 8 * 60 * 60 * 1000;
    const utc8Now = now.getTime() + utc8Offset;
    const utc8DayStart = Math.floor(utc8Now / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000);
    return utc8DayStart - utc8Offset;
  }

  // ---- 配置 ----

  static getConfig(key: string): string | null {
    const row = this.db.prepare(
      `SELECT value FROM breakout_alert_config WHERE key = ?`
    ).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  static setConfig(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO breakout_alert_config (key, value, updated_at)
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
