import { getDatabase } from '../database/connection';
import { log } from '../utils/logger';

export interface GainersRanking {
  id?: number;
  symbol: string;
  position: number;
  price_change_percent: number;
  timestamp?: string;
}

export interface FundingRanking {
  id?: number;
  symbol: string;
  position: number;
  funding_rate: number;
  funding_rate_8h: number;
  timestamp?: string;
}

export interface OIRanking {
  id?: number;
  symbol: string;
  position: number;
  oi_change_percent: number;
  oi_value: number;
  period: '1h' | '4h' | '1d';
  timestamp?: string;
}

export interface TriggerAlertSetting {
  id?: number;
  user_id: string;
  alert_type: 'gainers' | 'funding' | 'oi1h' | 'oi4h' | 'oi24h';
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface RankingChange {
  symbol: string;
  currentPosition: number;
  previousPosition: number | undefined;
  change: 'new' | 'up' | 'down' | 'same';
  changeValue: number | undefined;
}

export class TriggerAlertModel {
  
  /**
   * Initialize trigger alert tables
   */
  static async initializeTables(): Promise<void> {
    try {
      const db = await getDatabase();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS gainers_rankings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          position INTEGER NOT NULL,
          price_change_percent REAL NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS funding_rankings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          position INTEGER NOT NULL,
          funding_rate REAL NOT NULL,
          funding_rate_8h REAL NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS oi_rankings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          position INTEGER NOT NULL,
          oi_change_percent REAL NOT NULL,
          oi_value REAL NOT NULL,
          period TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS trigger_alert_settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id TEXT NOT NULL,
          alert_type TEXT NOT NULL,
          is_enabled INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, alert_type)
        );

        CREATE INDEX IF NOT EXISTS idx_gainers_timestamp ON gainers_rankings(timestamp);
        CREATE INDEX IF NOT EXISTS idx_funding_timestamp ON funding_rankings(timestamp);
        CREATE INDEX IF NOT EXISTS idx_oi_timestamp ON oi_rankings(timestamp);
        CREATE INDEX IF NOT EXISTS idx_oi_period ON oi_rankings(period, timestamp);
        CREATE INDEX IF NOT EXISTS idx_trigger_settings_user ON trigger_alert_settings(user_id, alert_type);
      `);
      
      log.info('Trigger alert tables initialized successfully');
    } catch (error) {
      log.error('Failed to initialize trigger alert tables', error);
      throw error;
    }
  }

  /**
   * Save gainers rankings
   */
  static async saveGainersRankings(rankings: GainersRanking[]): Promise<void> {
    const db = await getDatabase();
    const stmt = await db.prepare(`
      INSERT INTO gainers_rankings (symbol, position, price_change_percent) 
      VALUES (?, ?, ?)
    `);

    try {
      for (const ranking of rankings) {
        await stmt.run(ranking.symbol, ranking.position, ranking.price_change_percent);
      }
      
      log.debug(`Saved ${rankings.length} gainers rankings`);
    } catch (error) {
      log.error('Failed to save gainers rankings', error);
      throw error;
    } finally {
      await stmt.finalize();
    }
  }

  /**
   * Save funding rankings
   */
  static async saveFundingRankings(rankings: FundingRanking[]): Promise<void> {
    const db = await getDatabase();
    const stmt = await db.prepare(`
      INSERT INTO funding_rankings (symbol, position, funding_rate, funding_rate_8h) 
      VALUES (?, ?, ?, ?)
    `);

    try {
      for (const ranking of rankings) {
        await stmt.run(ranking.symbol, ranking.position, ranking.funding_rate, ranking.funding_rate_8h);
      }
      
      log.debug(`Saved ${rankings.length} funding rankings`);
    } catch (error) {
      log.error('Failed to save funding rankings', error);
      throw error;
    } finally {
      await stmt.finalize();
    }
  }

  /**
   * Save OI rankings
   */
  static async saveOIRankings(rankings: OIRanking[]): Promise<void> {
    const db = await getDatabase();
    const stmt = await db.prepare(`
      INSERT INTO oi_rankings (symbol, position, oi_change_percent, oi_value, period) 
      VALUES (?, ?, ?, ?, ?)
    `);

    try {
      for (const ranking of rankings) {
        await stmt.run(ranking.symbol, ranking.position, ranking.oi_change_percent, ranking.oi_value, ranking.period);
      }
      
      log.debug(`Saved ${rankings.length} OI rankings for period ${rankings[0]?.period}`);
    } catch (error) {
      log.error('Failed to save OI rankings', error);
      throw error;
    } finally {
      await stmt.finalize();
    }
  }

  /**
   * Get latest gainers rankings (top 10)
   */
  static async getLatestGainersRankings(): Promise<GainersRanking[]> {
    try {
      const db = await getDatabase();
      const stmt = await db.prepare(`
        SELECT * FROM gainers_rankings 
        WHERE timestamp = (SELECT MAX(timestamp) FROM gainers_rankings)
        ORDER BY position ASC
        LIMIT 10
      `);
      
      return await stmt.all() as GainersRanking[];
    } catch (error) {
      log.error('Failed to get latest gainers rankings', error);
      return [];
    }
  }

  /**
   * Get latest funding rankings (top 10)
   */
  static async getLatestFundingRankings(): Promise<FundingRanking[]> {
    try {
      const db = await getDatabase();
      const stmt = await db.prepare(`
        SELECT * FROM funding_rankings 
        WHERE timestamp = (SELECT MAX(timestamp) FROM funding_rankings)
        ORDER BY position ASC
        LIMIT 10
      `);
      
      return await stmt.all() as FundingRanking[];
    } catch (error) {
      log.error('Failed to get latest funding rankings', error);
      return [];
    }
  }

  /**
   * Get latest OI rankings (top 10) for a specific period
   */
  static async getLatestOIRankings(period: '1h' | '4h' | '1d'): Promise<OIRanking[]> {
    try {
      const db = await getDatabase();
      const stmt = await db.prepare(`
        SELECT * FROM oi_rankings 
        WHERE period = ? AND timestamp = (
          SELECT MAX(timestamp) FROM oi_rankings WHERE period = ?
        )
        ORDER BY position ASC
        LIMIT 10
      `);
      
      return await stmt.all(period, period) as OIRanking[];
    } catch (error) {
      log.error(`Failed to get latest OI rankings for ${period}`, error);
      return [];
    }
  }

  /**
   * Get previous OI rankings for comparison
   */
  static async getPreviousOIRankings(period: '1h' | '4h' | '1d'): Promise<OIRanking[]> {
    try {
      const db = await getDatabase();
      
      // First check if we have enough data (at least 2 distinct timestamps)
      const countStmt = await db.prepare(`
        SELECT COUNT(DISTINCT timestamp) as distinct_timestamps 
        FROM oi_rankings WHERE period = ?
      `);
      const countResult = await countStmt.get(period) as any;
      await countStmt.finalize();
      
      if (countResult.distinct_timestamps < 2) {
        log.debug(`Not enough historical data for OI ${period} comparison`);
        return [];
      }
      
      // Use row-based approach instead of timestamp comparison
      const stmt = await db.prepare(`
        WITH ranked_timestamps AS (
          SELECT DISTINCT timestamp,
                 ROW_NUMBER() OVER (ORDER BY timestamp DESC) as rn
          FROM oi_rankings WHERE period = ?
        ),
        second_latest_timestamp AS (
          SELECT timestamp FROM ranked_timestamps WHERE rn = 2
        )
        SELECT oir.* FROM oi_rankings oir
        JOIN second_latest_timestamp slt ON oir.timestamp = slt.timestamp
        WHERE oir.period = ?
        ORDER BY oir.position ASC
        LIMIT 10
      `);
      
      const result = await stmt.all(period, period) as OIRanking[];
      await stmt.finalize();
      
      log.debug(`Retrieved ${result.length} previous OI ${period} rankings`);
      return result;
    } catch (error) {
      log.error(`Failed to get previous OI ${period} rankings`, error);
      return [];
    }
  }

  /**
   * Get previous gainers rankings for comparison
   */
  static async getPreviousGainersRankings(): Promise<GainersRanking[]> {
    try {
      const db = await getDatabase();
      
      // First check if we have enough data (at least 2 distinct timestamps)
      const countStmt = await db.prepare(`
        SELECT COUNT(DISTINCT timestamp) as distinct_timestamps 
        FROM gainers_rankings
      `);
      const countResult = await countStmt.get() as any;
      await countStmt.finalize();
      
      if (countResult.distinct_timestamps < 2) {
        log.debug('Not enough historical data for gainers comparison');
        return [];
      }
      
      // Use row-based approach instead of timestamp comparison
      const stmt = await db.prepare(`
        WITH ranked_timestamps AS (
          SELECT DISTINCT timestamp,
                 ROW_NUMBER() OVER (ORDER BY timestamp DESC) as rn
          FROM gainers_rankings
        ),
        second_latest_timestamp AS (
          SELECT timestamp FROM ranked_timestamps WHERE rn = 2
        )
        SELECT gr.* FROM gainers_rankings gr
        JOIN second_latest_timestamp slt ON gr.timestamp = slt.timestamp
        ORDER BY gr.position ASC
        LIMIT 10
      `);
      
      const result = await stmt.all() as GainersRanking[];
      await stmt.finalize();
      
      log.debug(`Retrieved ${result.length} previous gainers rankings`);
      return result;
    } catch (error) {
      log.error('Failed to get previous gainers rankings', error);
      return [];
    }
  }

  /**
   * Get previous funding rankings for comparison
   */
  static async getPreviousFundingRankings(): Promise<FundingRanking[]> {
    try {
      const db = await getDatabase();
      
      // First check if we have enough data (at least 2 distinct timestamps)
      const countStmt = await db.prepare(`
        SELECT COUNT(DISTINCT timestamp) as distinct_timestamps 
        FROM funding_rankings
      `);
      const countResult = await countStmt.get() as any;
      await countStmt.finalize();
      
      if (countResult.distinct_timestamps < 2) {
        log.debug('Not enough historical data for funding comparison');
        return [];
      }
      
      // Use row-based approach instead of timestamp comparison
      const stmt = await db.prepare(`
        WITH ranked_timestamps AS (
          SELECT DISTINCT timestamp,
                 ROW_NUMBER() OVER (ORDER BY timestamp DESC) as rn
          FROM funding_rankings
        ),
        second_latest_timestamp AS (
          SELECT timestamp FROM ranked_timestamps WHERE rn = 2
        )
        SELECT fr.* FROM funding_rankings fr
        JOIN second_latest_timestamp slt ON fr.timestamp = slt.timestamp
        ORDER BY fr.position ASC
        LIMIT 10
      `);
      
      const result = await stmt.all() as FundingRanking[];
      await stmt.finalize();
      
      log.debug(`Retrieved ${result.length} previous funding rankings`);
      return result;
    } catch (error) {
      log.error('Failed to get previous funding rankings', error);
      return [];
    }
  }

  /**
   * Enable/disable trigger alert for user
   */
  static async setTriggerAlert(userId: string, alertType: 'gainers' | 'funding' | 'oi1h' | 'oi4h' | 'oi24h', enabled: boolean): Promise<void> {
    try {
      const db = await getDatabase();
      const stmt = await db.prepare(`
        INSERT OR REPLACE INTO trigger_alert_settings 
        (user_id, alert_type, is_enabled, updated_at)
        VALUES (?, ?, ?, datetime('now'))
      `);
      
      stmt.run(userId, alertType, enabled ? 1 : 0);
      await stmt.finalize();
      
      log.info(`${enabled ? 'Enabled' : 'Disabled'} ${alertType} trigger alert for user ${userId}`);
    } catch (error) {
      log.error('Failed to set trigger alert setting', error);
      throw error;
    }
  }

  /**
   * Get trigger alert settings for user
   */
  static async getTriggerAlertSettings(userId: string): Promise<TriggerAlertSetting[]> {
    try {
      const db = await getDatabase();
      const stmt = await db.prepare(`
        SELECT * FROM trigger_alert_settings 
        WHERE user_id = ?
      `);
      
      const results = await stmt.all(userId) as any[];
      return results.map(row => ({
        ...row,
        is_enabled: row.is_enabled === 1
      }));
    } catch (error) {
      log.error('Failed to get trigger alert settings', error);
      return [];
    }
  }

  /**
   * Get all users with enabled trigger alerts
   */
  static async getEnabledUsers(alertType: 'gainers' | 'funding' | 'oi1h' | 'oi4h' | 'oi24h'): Promise<string[]> {
    try {
      const db = await getDatabase();
      const stmt = await db.prepare(`
        SELECT user_id FROM trigger_alert_settings 
        WHERE alert_type = ? AND is_enabled = 1
      `);
      
      const results = await stmt.all(alertType) as any[];
      return results.map(row => row.user_id);
    } catch (error) {
      log.error('Failed to get enabled users', error);
      return [];
    }
  }

  /**
   * Clean old rankings data (keep only last 7 days)
   */
  static async cleanOldData(): Promise<void> {
    try {
      const db = await getDatabase();
      const stmt1 = await db.prepare(`
        DELETE FROM gainers_rankings 
        WHERE timestamp < datetime('now', '-7 days')
      `);
      
      const stmt2 = await db.prepare(`
        DELETE FROM funding_rankings 
        WHERE timestamp < datetime('now', '-7 days')
      `);
      
      const stmt3 = await db.prepare(`
        DELETE FROM oi_rankings 
        WHERE timestamp < datetime('now', '-7 days')
      `);
      
      const deleted1 = await stmt1.run();
      const deleted2 = await stmt2.run();
      const deleted3 = await stmt3.run();
      
      await stmt1.finalize();
      await stmt2.finalize();
      await stmt3.finalize();
      
      log.info(`Cleaned old data: ${deleted1.changes} gainers records, ${deleted2.changes} funding records, ${deleted3.changes} OI records`);
    } catch (error) {
      log.error('Failed to clean old data', error);
    }
  }

  /**
   * Compare rankings and detect changes
   */
  static compareRankings<T extends { symbol: string; position: number }>(
    current: T[], 
    previous: T[]
  ): RankingChange[] {
    const changes: RankingChange[] = [];
    const previousMap = new Map(previous.map(r => [r.symbol, r.position]));

    current.forEach(currentRanking => {
      const previousPosition = previousMap.get(currentRanking.symbol);
      
      let change: RankingChange['change'];
      let changeValue: number | undefined;

      if (previousPosition === undefined) {
        change = 'new';
      } else if (previousPosition > currentRanking.position) {
        change = 'up';
        changeValue = previousPosition - currentRanking.position;
      } else if (previousPosition < currentRanking.position) {
        change = 'down';
        changeValue = currentRanking.position - previousPosition;
      } else {
        change = 'same';
      }

      changes.push({
        symbol: currentRanking.symbol,
        currentPosition: currentRanking.position,
        previousPosition,
        change,
        changeValue
      });
    });

    return changes;
  }
}