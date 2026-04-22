import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

export interface RankingAlertRecord {
  id?: number;
  symbol: string;
  alertType: 'l1_new_top'; // 预留：后续若加 L2/排名跌出等扩展
  changeType: 'new_entry' | 'position_change';
  previousPosition: number | null; // new_entry 时为 null
  triggeredAt: number; // unix ms
}

/**
 * 涨幅榜排名告警持久化
 * 当前仅记录 L1 榜首易主事件，供 /brief 早报汇总
 */
export class RankingAlertModel {
  private static db: Database.Database;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS ranking_alerts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          change_type TEXT NOT NULL,
          previous_position INTEGER,
          triggered_at INTEGER NOT NULL
        )
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_ranking_alerts_triggered
        ON ranking_alerts(triggered_at DESC)
      `);
      log.info('RankingAlertModel database initialized');
    } catch (error) {
      log.error('Failed to initialize RankingAlertModel database', error);
      throw error;
    }
  }

  static recordAlert(record: RankingAlertRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO ranking_alerts (
        symbol, alert_type, change_type, previous_position, triggered_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.symbol,
      record.alertType,
      record.changeType,
      record.previousPosition,
      record.triggeredAt
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 返回指定时间窗口内的告警记录（按触发时间升序）
   */
  static listSince(sinceMs: number): RankingAlertRecord[] {
    const rows = this.db.prepare(`
      SELECT id, symbol,
             alert_type AS alertType,
             change_type AS changeType,
             previous_position AS previousPosition,
             triggered_at AS triggeredAt
      FROM ranking_alerts
      WHERE triggered_at >= ?
      ORDER BY triggered_at ASC
    `).all(sinceMs);
    return rows as RankingAlertRecord[];
  }
}
