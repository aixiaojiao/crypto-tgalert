import Database from 'better-sqlite3';
import path from 'path';
import { log } from '../utils/logger';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

export interface CoinNote {
  id: number;
  userId: string;
  symbol: string;
  note: string;
  price: number | null;
  priceChange24h: number | null;
  fundingRate: number | null;
  rankType: 'gainers' | 'losers' | null;
  rankPosition: number | null;
  createdAt: string;
}

export interface NewCoinNote {
  userId: string;
  symbol: string;
  note: string;
  price?: number | null;
  priceChange24h?: number | null;
  fundingRate?: number | null;
  rankType?: 'gainers' | 'losers' | null;
  rankPosition?: number | null;
}

export class CoinNoteModel {
  private static db: Database.Database;

  static initDatabase(): void {
    if (this.db) return;
    try {
      this.db = new Database(DB_PATH);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS coin_notes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          symbol TEXT NOT NULL,
          note TEXT NOT NULL,
          price REAL,
          price_change_24h REAL,
          funding_rate REAL,
          rank_type TEXT CHECK (rank_type IN ('gainers', 'losers') OR rank_type IS NULL),
          rank_position INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_coin_notes_symbol ON coin_notes(symbol);
        CREATE INDEX IF NOT EXISTS idx_coin_notes_created ON coin_notes(created_at DESC);
      `);
      log.info('CoinNoteModel database initialized');
    } catch (err) {
      log.error('CoinNoteModel init failed', err);
      throw err;
    }
  }

  static add(data: NewCoinNote): number {
    const stmt = this.db.prepare(`
      INSERT INTO coin_notes
        (user_id, symbol, note, price, price_change_24h, funding_rate, rank_type, rank_position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      data.userId,
      data.symbol,
      data.note,
      data.price ?? null,
      data.priceChange24h ?? null,
      data.fundingRate ?? null,
      data.rankType ?? null,
      data.rankPosition ?? null
    );
    return info.lastInsertRowid as number;
  }

  static listBySymbol(symbol: string, limit = 20): CoinNote[] {
    const rows = this.db.prepare(`
      SELECT id, user_id AS userId, symbol, note, price,
             price_change_24h AS priceChange24h, funding_rate AS fundingRate,
             rank_type AS rankType, rank_position AS rankPosition,
             created_at AS createdAt
      FROM coin_notes
      WHERE symbol = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(symbol, limit);
    return rows as CoinNote[];
  }

  static getById(id: number): CoinNote | undefined {
    const row = this.db.prepare(`
      SELECT id, user_id AS userId, symbol, note, price,
             price_change_24h AS priceChange24h, funding_rate AS fundingRate,
             rank_type AS rankType, rank_position AS rankPosition,
             created_at AS createdAt
      FROM coin_notes
      WHERE id = ?
    `).get(id);
    return row as CoinNote | undefined;
  }

  static remove(id: number): boolean {
    const info = this.db.prepare(`DELETE FROM coin_notes WHERE id = ?`).run(id);
    return info.changes > 0;
  }
}
