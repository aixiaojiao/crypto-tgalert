import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

/**
 * 历史高点时间框架
 *   7d   — 近 7 天（K线粒度 1h）
 *   30d  — 近 30 天（K线粒度 1d）
 *   180d — 近 180 天（K线粒度 1d）
 *   52w  — 近 52 周（K线粒度 1d）
 *   ATH  — 合约上线至今（K线粒度 1d）
 */
export type HighTimeframe = '7d' | '30d' | '180d' | '52w' | 'ATH';

export const ALL_TIMEFRAMES: HighTimeframe[] = ['7d', '30d', '180d', '52w', 'ATH'];

export interface HistoricalHighRecord {
  symbol: string;
  timeframe: HighTimeframe;
  highPrice: number;
  highAt: number;        // unix ms, K 线高点所在 K 线的开盘时间
  windowStart: number;   // unix ms, 统计窗口起点
  windowEnd: number;     // unix ms, 统计窗口终点
  collectedAt: number;   // unix ms, 本条目最后刷新时间
}

/**
 * 历史高点缓存
 * 表 historical_highs：(symbol, timeframe) 唯一，按 symbol 增量更新
 */
export class HistoricalHighModel {
  private static db: Database.Database;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS historical_highs (
          symbol TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          high_price REAL NOT NULL,
          high_at INTEGER NOT NULL,
          window_start INTEGER NOT NULL,
          window_end INTEGER NOT NULL,
          collected_at INTEGER NOT NULL,
          PRIMARY KEY (symbol, timeframe)
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_historical_highs_symbol
        ON historical_highs(symbol)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_historical_highs_tf_collected
        ON historical_highs(timeframe, collected_at DESC)
      `);

      log.info('HistoricalHighModel database initialized');
    } catch (error) {
      log.error('Failed to initialize HistoricalHighModel database', error);
      throw error;
    }
  }

  /**
   * upsert 单条高点记录
   */
  static upsertHigh(record: HistoricalHighRecord): void {
    this.db.prepare(`
      INSERT INTO historical_highs (
        symbol, timeframe, high_price, high_at,
        window_start, window_end, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol, timeframe) DO UPDATE SET
        high_price   = excluded.high_price,
        high_at      = excluded.high_at,
        window_start = excluded.window_start,
        window_end   = excluded.window_end,
        collected_at = excluded.collected_at
    `).run(
      record.symbol,
      record.timeframe,
      record.highPrice,
      record.highAt,
      record.windowStart,
      record.windowEnd,
      record.collectedAt,
    );
  }

  /**
   * 查询单个 symbol + timeframe 的高点
   */
  static getHigh(symbol: string, timeframe: HighTimeframe): HistoricalHighRecord | null {
    const row = this.db.prepare(`
      SELECT symbol, timeframe, high_price, high_at, window_start, window_end, collected_at
      FROM historical_highs WHERE symbol = ? AND timeframe = ?
    `).get(symbol, timeframe) as
      | {
          symbol: string;
          timeframe: HighTimeframe;
          high_price: number;
          high_at: number;
          window_start: number;
          window_end: number;
          collected_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      symbol: row.symbol,
      timeframe: row.timeframe,
      highPrice: row.high_price,
      highAt: row.high_at,
      windowStart: row.window_start,
      windowEnd: row.window_end,
      collectedAt: row.collected_at,
    };
  }

  /**
   * 查询某 symbol 全部 timeframe 的高点
   */
  static getAllHighsForSymbol(symbol: string): Record<HighTimeframe, HistoricalHighRecord | null> {
    const rows = this.db.prepare(`
      SELECT symbol, timeframe, high_price, high_at, window_start, window_end, collected_at
      FROM historical_highs WHERE symbol = ?
    `).all(symbol) as Array<{
      symbol: string;
      timeframe: HighTimeframe;
      high_price: number;
      high_at: number;
      window_start: number;
      window_end: number;
      collected_at: number;
    }>;

    const result: Record<HighTimeframe, HistoricalHighRecord | null> = {
      '7d': null, '30d': null, '180d': null, '52w': null, 'ATH': null,
    };
    for (const r of rows) {
      result[r.timeframe] = {
        symbol: r.symbol,
        timeframe: r.timeframe,
        highPrice: r.high_price,
        highAt: r.high_at,
        windowStart: r.window_start,
        windowEnd: r.window_end,
        collectedAt: r.collected_at,
      };
    }
    return result;
  }

  /**
   * 查询某 timeframe 下全部 symbol 的高点（用于排名类查询）
   */
  static getAllForTimeframe(timeframe: HighTimeframe): HistoricalHighRecord[] {
    const rows = this.db.prepare(`
      SELECT symbol, timeframe, high_price, high_at, window_start, window_end, collected_at
      FROM historical_highs WHERE timeframe = ?
    `).all(timeframe) as Array<{
      symbol: string;
      timeframe: HighTimeframe;
      high_price: number;
      high_at: number;
      window_start: number;
      window_end: number;
      collected_at: number;
    }>;
    return rows.map(r => ({
      symbol: r.symbol,
      timeframe: r.timeframe,
      highPrice: r.high_price,
      highAt: r.high_at,
      windowStart: r.window_start,
      windowEnd: r.window_end,
      collectedAt: r.collected_at,
    }));
  }

  /**
   * 列出缓存里所有已收录的 symbol
   */
  static getCachedSymbols(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT symbol FROM historical_highs
    `).all() as Array<{ symbol: string }>;
    return rows.map(r => r.symbol);
  }

  /**
   * 删除某 symbol 的所有高点记录（死币清理时用）
   */
  static deleteSymbol(symbol: string): number {
    const result = this.db.prepare(`DELETE FROM historical_highs WHERE symbol = ?`).run(symbol);
    return result.changes;
  }

  /**
   * 统计信息：总行数、覆盖 symbol 数、最旧/最新 collected_at
   */
  static getStats(): {
    rows: number;
    symbols: number;
    oldestCollectedAt: number | null;
    newestCollectedAt: number | null;
  } {
    const r = this.db.prepare(`
      SELECT COUNT(*) as rows,
             COUNT(DISTINCT symbol) as symbols,
             MIN(collected_at) as oldest,
             MAX(collected_at) as newest
      FROM historical_highs
    `).get() as { rows: number; symbols: number; oldest: number | null; newest: number | null };
    return {
      rows: r.rows,
      symbols: r.symbols,
      oldestCollectedAt: r.oldest,
      newestCollectedAt: r.newest,
    };
  }
}
