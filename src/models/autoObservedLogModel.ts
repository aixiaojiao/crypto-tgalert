import Database from 'better-sqlite3';
import { log } from '../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

/**
 * 自动观察日志（🔎）：5m 窗口内最大回撤达阈值时 append 一行。
 * 不等于黄名单，不影响任何现有报警/推送，仅用于观察期数据积累。
 * 不行就 clearAll 清空；效果好则可 SQL/代码升级到 yellowlist。
 */
export interface AutoObservedLogRecord {
  id?: number;
  symbol: string;
  triggeredAt: number;      // unix ms, 触发时刻（= trough 时刻）
  drawdownPercent: number;  // 正数，回撤百分比，如 12.5 表示跌 12.5%
  peakPrice: number;        // 窗口内峰值价
  troughPrice: number;      // 峰值后的最低价
  peakAt: number;           // 峰值时刻 ms
  troughAt: number;         // 谷值时刻 ms
  volume24h: number;        // 触发时 24h 成交额 (USDT)
}

export interface SymbolObservationSummary {
  symbol: string;
  count: number;
  maxDrawdown: number;       // 期间最大回撤
  latestDrawdown: number;    // 最近一次回撤
  latestTriggeredAt: number;
}

export class AutoObservedLogModel {
  private static db: Database.Database;

  /**
   * 同一 symbol 两次 insert 之间的最小间隔（ms）。
   * = 5 分钟（与窗口长度一致）：同一次下跌事件只记一行，
   * 但一天之内同一币多次独立下跌仍能分别记录，不影响用户按 count 判断"真垃圾"。
   */
  static readonly COOLDOWN_MS = 5 * 60 * 1000;

  static isDatabaseInitialized(): boolean {
    return this.db !== undefined;
  }

  static initDatabase(): void {
    try {
      this.db = new Database(DB_PATH);

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS auto_observed_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          triggered_at INTEGER NOT NULL,
          drawdown_percent REAL NOT NULL,
          peak_price REAL NOT NULL,
          trough_price REAL NOT NULL,
          peak_at INTEGER NOT NULL,
          trough_at INTEGER NOT NULL,
          volume24h REAL NOT NULL
        )
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_auto_observed_log_time
        ON auto_observed_log(triggered_at DESC)
      `);

      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_auto_observed_log_symbol_time
        ON auto_observed_log(symbol, triggered_at DESC)
      `);

      log.info('AutoObservedLogModel database initialized');
    } catch (error) {
      log.error('Failed to initialize AutoObservedLogModel database', error);
      throw error;
    }
  }

  /** 插入一条观察记录 */
  static recordObservation(record: AutoObservedLogRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO auto_observed_log (
        symbol, triggered_at, drawdown_percent,
        peak_price, trough_price, peak_at, trough_at, volume24h
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.symbol,
      record.triggeredAt,
      record.drawdownPercent,
      record.peakPrice,
      record.troughPrice,
      record.peakAt,
      record.troughAt,
      record.volume24h,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * 同一 symbol 在 COOLDOWN_MS 内是否已有记录，用于避免同次下跌事件被重复落库。
   */
  static wasObservedRecently(symbol: string): boolean {
    const cutoff = Date.now() - this.COOLDOWN_MS;
    const row = this.db.prepare(`
      SELECT 1 FROM auto_observed_log
      WHERE symbol = ? AND triggered_at >= ?
      LIMIT 1
    `).get(symbol, cutoff) as { 1: number } | undefined;
    return !!row;
  }

  /** 返回指定时刻以来的所有观察记录（按触发时间升序） */
  static listSince(sinceMs: number): AutoObservedLogRecord[] {
    const rows = this.db.prepare(`
      SELECT
        id, symbol,
        triggered_at as triggeredAt,
        drawdown_percent as drawdownPercent,
        peak_price as peakPrice,
        trough_price as troughPrice,
        peak_at as peakAt,
        trough_at as troughAt,
        volume24h
      FROM auto_observed_log
      WHERE triggered_at >= ?
      ORDER BY triggered_at ASC
    `).all(sinceMs);
    return rows as AutoObservedLogRecord[];
  }

  /**
   * 按 symbol 聚合 sinceMs 以来的观察记录，返回触发次数、最大回撤、最近触发时间。
   * 用于 /brief 和 /yellow_list 展示 —— 一眼看出哪些币被反复触发。
   */
  static summarizeSince(sinceMs: number): SymbolObservationSummary[] {
    const rows = this.db.prepare(`
      SELECT
        symbol,
        COUNT(*) as count,
        MAX(drawdown_percent) as maxDrawdown,
        MAX(triggered_at) as latestTriggeredAt
      FROM auto_observed_log
      WHERE triggered_at >= ?
      GROUP BY symbol
      ORDER BY count DESC, latestTriggeredAt DESC
    `).all(sinceMs) as Array<{
      symbol: string;
      count: number;
      maxDrawdown: number;
      latestTriggeredAt: number;
    }>;

    // 另取每个 symbol 的最近一次 drawdown（与 max 可能不同）
    const latestStmt = this.db.prepare(`
      SELECT drawdown_percent as d FROM auto_observed_log
      WHERE symbol = ? AND triggered_at >= ?
      ORDER BY triggered_at DESC LIMIT 1
    `);

    return rows.map(r => {
      const latest = latestStmt.get(r.symbol, sinceMs) as { d: number } | undefined;
      return {
        symbol: r.symbol,
        count: r.count,
        maxDrawdown: r.maxDrawdown,
        latestDrawdown: latest?.d ?? r.maxDrawdown,
        latestTriggeredAt: r.latestTriggeredAt,
      };
    });
  }

  /** 清空全部观察记录 —— 观察期结论为"不行"时一键清空 */
  static clearAll(): number {
    const result = this.db.prepare(`DELETE FROM auto_observed_log`).run();
    return result.changes;
  }

  /** 清理 beforeMs 之前的老记录（保留最近数据） */
  static clearBefore(beforeMs: number): number {
    const result = this.db.prepare(`
      DELETE FROM auto_observed_log WHERE triggered_at < ?
    `).run(beforeMs);
    return result.changes;
  }
}
