import Database from 'better-sqlite3';
import path from 'path';
import { log } from '../utils/logger';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

export interface DebugReport {
  id: number;
  userId: string;
  content: string;
  status: 'open' | 'resolved';
  createdAt: string;
  resolvedAt: string | null;
}

export class DebugReportModel {
  private static db: Database.Database;

  static initDatabase(): void {
    if (this.db) return;
    try {
      this.db = new Database(DB_PATH);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS debug_reports (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_debug_reports_status ON debug_reports(status, created_at DESC);
      `);
      log.info('DebugReportModel database initialized');
    } catch (err) {
      log.error('DebugReportModel init failed', err);
      throw err;
    }
  }

  static add(userId: string, content: string): number {
    const info = this.db.prepare(
      `INSERT INTO debug_reports (user_id, content) VALUES (?, ?)`
    ).run(userId, content);
    return info.lastInsertRowid as number;
  }

  static listOpen(limit = 50): DebugReport[] {
    const rows = this.db.prepare(`
      SELECT id, user_id AS userId, content, status,
             created_at AS createdAt, resolved_at AS resolvedAt
      FROM debug_reports
      WHERE status = 'open'
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(limit);
    return rows as DebugReport[];
  }

  static getById(id: number): DebugReport | undefined {
    const row = this.db.prepare(`
      SELECT id, user_id AS userId, content, status,
             created_at AS createdAt, resolved_at AS resolvedAt
      FROM debug_reports
      WHERE id = ?
    `).get(id);
    return row as DebugReport | undefined;
  }

  static resolve(id: number): boolean {
    const info = this.db.prepare(
      `UPDATE debug_reports SET status = 'resolved', resolved_at = datetime('now') WHERE id = ? AND status = 'open'`
    ).run(id);
    return info.changes > 0;
  }

  static remove(id: number): boolean {
    const info = this.db.prepare(`DELETE FROM debug_reports WHERE id = ?`).run(id);
    return info.changes > 0;
  }
}
