/**
 * 用户过滤服务
 * 管理用户的黑名单、临时屏蔽等过滤规则
 */

import { getDatabase } from '../../database/connection';
import { UserFilterSettings } from '../../database/schema';

// Re-export for command handlers
export { UserFilterSettings };
import { TimeParser } from '../../utils/timeParser';
import { log } from '../../utils/logger';
import { injectable } from 'inversify';

export interface FilterRule {
  id: number;
  symbol: string;
  filter_type: 'blacklist' | 'mute' | 'yellowlist';
  expires_at: number | null;
  reason: string | null;
  created_at: number;
  remaining_time?: string | undefined;
}

export interface FilterStats {
  blacklistCount: number;
  muteCount: number;
  yellowlistCount: number;
  totalFiltered: number;
  expiringSoon: FilterRule[];
}

export interface IUserFilterService {
  // 黑名单管理
  addBlacklist(userId: string, symbol: string, reason?: string): Promise<void>;
  removeBlacklist(userId: string, symbol: string): Promise<void>;
  getBlacklist(userId: string): Promise<FilterRule[]>;
  isBlacklisted(userId: string, symbol: string): Promise<boolean>;

  // 临时屏蔽管理
  addMute(userId: string, symbol: string, duration: string, reason?: string): Promise<void>;
  removeMute(userId: string, symbol: string): Promise<void>;
  getMuteList(userId: string): Promise<FilterRule[]>;
  isMuted(userId: string, symbol: string): Promise<{ muted: boolean; remainingTime?: string }>;

  // 黄名单管理 (新增功能)
  addYellowlist(userId: string, symbol: string, reason?: string): Promise<void>;
  removeYellowlist(userId: string, symbol: string): Promise<void>;
  getYellowlist(userId: string): Promise<FilterRule[]>;
  isYellowlisted(userId: string, symbol: string): Promise<boolean>;

  // 过滤检查
  isFiltered(userId: string, symbol: string): Promise<boolean>;
  getFilterReason(userId: string, symbol: string): Promise<string | null>;

  // 设置管理
  getSettings(userId: string): Promise<UserFilterSettings>;
  updateSettings(userId: string, settings: Partial<UserFilterSettings>): Promise<void>;

  // 统计和清理
  getFilterStats(userId: string): Promise<FilterStats>;
  cleanupExpiredMutes(): Promise<number>;
  clearAll(userId: string, filterType?: 'blacklist' | 'mute' | 'yellowlist'): Promise<number>;
}

@injectable()
export class UserFilterService implements IUserFilterService {

  /**
   * 添加黑名单
   */
  async addBlacklist(userId: string, symbol: string, reason?: string): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();

    try {
      await db.run(`
        INSERT OR REPLACE INTO user_filters
        (user_id, symbol, filter_type, expires_at, reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [userId, symbol.toUpperCase(), 'blacklist', null, reason || null, now, now]);

      log.info(`Added blacklist rule`, { userId, symbol, reason });
    } catch (error) {
      log.error(`Failed to add blacklist rule`, { userId, symbol, error });
      throw error;
    }
  }

  /**
   * 移除黑名单
   */
  async removeBlacklist(userId: string, symbol: string): Promise<void> {
    const db = await getDatabase();

    try {
      const result = await db.run(`
        DELETE FROM user_filters
        WHERE user_id = ? AND symbol = ? AND filter_type = ?
      `, [userId, symbol.toUpperCase(), 'blacklist']);

      if (result.changes === 0) {
        throw new Error(`${symbol} 不在黑名单中`);
      }

      log.info(`Removed blacklist rule`, { userId, symbol });
    } catch (error) {
      log.error(`Failed to remove blacklist rule`, { userId, symbol, error });
      throw error;
    }
  }

  /**
   * 获取黑名单
   */
  async getBlacklist(userId: string): Promise<FilterRule[]> {
    const db = await getDatabase();

    try {
      const rows = await db.all(`
        SELECT * FROM user_filters
        WHERE user_id = ? AND filter_type = ?
        ORDER BY created_at DESC
      `, [userId, 'blacklist']);

      return rows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        filter_type: row.filter_type,
        expires_at: row.expires_at,
        reason: row.reason,
        created_at: row.created_at
      }));
    } catch (error) {
      log.error(`Failed to get blacklist`, { userId, error });
      throw error;
    }
  }

  /**
   * 检查是否在黑名单中
   */
  async isBlacklisted(userId: string, symbol: string): Promise<boolean> {
    const db = await getDatabase();

    try {
      const row = await db.get(`
        SELECT id FROM user_filters
        WHERE user_id = ? AND symbol = ? AND filter_type = ?
      `, [userId, symbol.toUpperCase(), 'blacklist']);

      return !!row;
    } catch (error) {
      log.error(`Failed to check blacklist`, { userId, symbol, error });
      return false;
    }
  }

  /**
   * 添加临时屏蔽
   */
  async addMute(userId: string, symbol: string, duration: string, reason?: string): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();

    try {
      const expiresAt = TimeParser.getExpiresAt(duration);
      const { humanReadable } = TimeParser.parseDuration(duration);

      await db.run(`
        INSERT OR REPLACE INTO user_filters
        (user_id, symbol, filter_type, expires_at, reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [userId, symbol.toUpperCase(), 'mute', expiresAt, reason || null, now, now]);

      log.info(`Added mute rule`, { userId, symbol, duration: humanReadable, expiresAt, reason });
    } catch (error) {
      log.error(`Failed to add mute rule`, { userId, symbol, duration, error });
      throw error;
    }
  }

  /**
   * 移除临时屏蔽
   */
  async removeMute(userId: string, symbol: string): Promise<void> {
    const db = await getDatabase();

    try {
      const result = await db.run(`
        DELETE FROM user_filters
        WHERE user_id = ? AND symbol = ? AND filter_type = ?
      `, [userId, symbol.toUpperCase(), 'mute']);

      if (result.changes === 0) {
        throw new Error(`${symbol} 不在屏蔽列表中`);
      }

      log.info(`Removed mute rule`, { userId, symbol });
    } catch (error) {
      log.error(`Failed to remove mute rule`, { userId, symbol, error });
      throw error;
    }
  }

  /**
   * 获取屏蔽列表
   */
  async getMuteList(userId: string): Promise<FilterRule[]> {
    const db = await getDatabase();

    try {
      const rows = await db.all(`
        SELECT * FROM user_filters
        WHERE user_id = ? AND filter_type = ?
        ORDER BY expires_at ASC
      `, [userId, 'mute']);

      return rows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        filter_type: row.filter_type,
        expires_at: row.expires_at,
        reason: row.reason,
        created_at: row.created_at,
        remaining_time: row.expires_at ? TimeParser.getRemainingTime(row.expires_at) : undefined
      }));
    } catch (error) {
      log.error(`Failed to get mute list`, { userId, error });
      throw error;
    }
  }

  /**
   * 检查是否被屏蔽
   */
  async isMuted(userId: string, symbol: string): Promise<{ muted: boolean; remainingTime?: string }> {
    const db = await getDatabase();

    try {
      const row = await db.get(`
        SELECT expires_at FROM user_filters
        WHERE user_id = ? AND symbol = ? AND filter_type = ?
      `, [userId, symbol.toUpperCase(), 'mute']);

      if (!row) {
        return { muted: false };
      }

      if (TimeParser.isExpired(row.expires_at)) {
        // 自动清理过期规则
        await this.removeMute(userId, symbol);
        return { muted: false };
      }

      return {
        muted: true,
        remainingTime: TimeParser.getRemainingTime(row.expires_at)
      };
    } catch (error) {
      log.error(`Failed to check mute status`, { userId, symbol, error });
      return { muted: false };
    }
  }

  /**
   * 检查是否被过滤(黑名单或屏蔽)
   */
  async isFiltered(userId: string, symbol: string): Promise<boolean> {
    const [blacklisted, muteResult] = await Promise.all([
      this.isBlacklisted(userId, symbol),
      this.isMuted(userId, symbol)
    ]);

    return blacklisted || muteResult.muted;
  }

  /**
   * 获取过滤原因
   */
  async getFilterReason(userId: string, symbol: string): Promise<string | null> {
    const db = await getDatabase();

    try {
      const rows = await db.all(`
        SELECT filter_type, reason, expires_at FROM user_filters
        WHERE user_id = ? AND symbol = ?
        ORDER BY CASE filter_type WHEN 'blacklist' THEN 1 WHEN 'mute' THEN 2 END
      `, [userId, symbol.toUpperCase()]);

      for (const row of rows) {
        if (row.filter_type === 'blacklist') {
          return row.reason || '用户黑名单';
        }
        if (row.filter_type === 'mute' && !TimeParser.isExpired(row.expires_at)) {
          const remaining = TimeParser.getRemainingTime(row.expires_at);
          return row.reason ? `临时屏蔽(${remaining}): ${row.reason}` : `临时屏蔽(${remaining})`;
        }
      }

      return null;
    } catch (error) {
      log.error(`Failed to get filter reason`, { userId, symbol, error });
      return null;
    }
  }

  /**
   * 获取用户设置
   */
  async getSettings(userId: string): Promise<UserFilterSettings> {
    const db = await getDatabase();

    try {
      const row = await db.get(`
        SELECT * FROM user_filter_settings WHERE user_id = ?
      `, [userId]);

      if (row) {
        return row;
      }

      // 创建默认设置
      const now = Date.now();
      const defaults: UserFilterSettings = {
        user_id: userId,
        volume_threshold: 10000000, // 1千万USDT
        enable_auto_filter: false,
        created_at: now,
        updated_at: now
      };

      await db.run(`
        INSERT INTO user_filter_settings
        (user_id, volume_threshold, enable_auto_filter, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, defaults.volume_threshold, defaults.enable_auto_filter, now, now]);

      return defaults;
    } catch (error) {
      log.error(`Failed to get user settings`, { userId, error });
      throw error;
    }
  }

  /**
   * 更新用户设置
   */
  async updateSettings(userId: string, settings: Partial<UserFilterSettings>): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();

    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (settings.volume_threshold !== undefined) {
        updates.push('volume_threshold = ?');
        values.push(settings.volume_threshold);
      }

      if (settings.enable_auto_filter !== undefined) {
        updates.push('enable_auto_filter = ?');
        values.push(settings.enable_auto_filter);
      }

      if (updates.length === 0) {
        return;
      }

      updates.push('updated_at = ?');
      values.push(now, userId);

      await db.run(`
        UPDATE user_filter_settings
        SET ${updates.join(', ')}
        WHERE user_id = ?
      `, values);

      log.info(`Updated user filter settings`, { userId, settings });
    } catch (error) {
      log.error(`Failed to update user settings`, { userId, settings, error });
      throw error;
    }
  }

  /**
   * 获取过滤统计
   */
  async getFilterStats(userId: string): Promise<FilterStats> {
    const db = await getDatabase();

    try {
      const [blacklistRows, muteRows, yellowlistRows] = await Promise.all([
        db.all(`SELECT * FROM user_filters WHERE user_id = ? AND filter_type = ?`, [userId, 'blacklist']),
        db.all(`SELECT * FROM user_filters WHERE user_id = ? AND filter_type = ?`, [userId, 'mute']),
        db.all(`SELECT * FROM user_filters WHERE user_id = ? AND filter_type = ?`, [userId, 'yellowlist'])
      ]);

      const activeMutes = muteRows.filter(row => !TimeParser.isExpired(row.expires_at));
      const expiringSoon = activeMutes
        .filter(row => row.expires_at && (row.expires_at - Date.now()) < 24 * 60 * 60 * 1000) // 24小时内过期
        .map(row => ({
          id: row.id,
          symbol: row.symbol,
          filter_type: row.filter_type,
          expires_at: row.expires_at,
          reason: row.reason,
          created_at: row.created_at,
          remaining_time: TimeParser.getRemainingTime(row.expires_at)
        }));

      return {
        blacklistCount: blacklistRows.length,
        muteCount: activeMutes.length,
        yellowlistCount: yellowlistRows.length,
        totalFiltered: blacklistRows.length + activeMutes.length + yellowlistRows.length,
        expiringSoon
      };
    } catch (error) {
      log.error(`Failed to get filter stats`, { userId, error });
      throw error;
    }
  }

  /**
   * 清理过期的屏蔽规则
   */
  async cleanupExpiredMutes(): Promise<number> {
    const db = await getDatabase();

    try {
      const result = await db.run(`
        DELETE FROM user_filters
        WHERE filter_type = ? AND expires_at IS NOT NULL AND expires_at <= ?
      `, ['mute', Date.now()]);

      if (result.changes && result.changes > 0) {
        log.info(`Cleaned up expired mutes`, { count: result.changes });
      }

      return result.changes || 0;
    } catch (error) {
      log.error(`Failed to cleanup expired mutes`, { error });
      return 0;
    }
  }

  /**
   * 清空所有过滤规则
   */
  async clearAll(userId: string, filterType?: 'blacklist' | 'mute' | 'yellowlist'): Promise<number> {
    const db = await getDatabase();

    try {
      let query = 'DELETE FROM user_filters WHERE user_id = ?';
      const params = [userId];

      if (filterType) {
        query += ' AND filter_type = ?';
        params.push(filterType);
      }

      const result = await db.run(query, params);

      log.info(`Cleared user filters`, { userId, filterType, count: result.changes });
      return result.changes || 0;
    } catch (error) {
      log.error(`Failed to clear user filters`, { userId, filterType, error });
      throw error;
    }
  }

  // ========================
  // 黄名单管理方法 (新增功能)
  // ========================

  /**
   * 添加黄名单
   */
  async addYellowlist(userId: string, symbol: string, reason?: string): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();

    try {
      await db.run(`
        INSERT OR REPLACE INTO user_filters
        (user_id, symbol, filter_type, expires_at, reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [userId, symbol.toUpperCase(), 'yellowlist', null, reason || null, now, now]);

      log.info(`Added yellowlist rule`, { userId, symbol, reason });
    } catch (error) {
      log.error(`Failed to add yellowlist rule`, { userId, symbol, error });
      throw error;
    }
  }

  /**
   * 移除黄名单
   */
  async removeYellowlist(userId: string, symbol: string): Promise<void> {
    const db = await getDatabase();

    try {
      const result = await db.run(`
        DELETE FROM user_filters
        WHERE user_id = ? AND symbol = ? AND filter_type = ?
      `, [userId, symbol.toUpperCase(), 'yellowlist']);

      if (result.changes === 0) {
        throw new Error(`${symbol} 不在黄名单中`);
      }

      log.info(`Removed yellowlist rule`, { userId, symbol });
    } catch (error) {
      log.error(`Failed to remove yellowlist rule`, { userId, symbol, error });
      throw error;
    }
  }

  /**
   * 获取黄名单
   */
  async getYellowlist(userId: string): Promise<FilterRule[]> {
    const db = await getDatabase();

    try {
      const rows = await db.all(`
        SELECT * FROM user_filters
        WHERE user_id = ? AND filter_type = ?
        ORDER BY created_at DESC
      `, [userId, 'yellowlist']);

      return rows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        filter_type: row.filter_type,
        expires_at: row.expires_at,
        reason: row.reason,
        created_at: row.created_at
      }));
    } catch (error) {
      log.error(`Failed to get yellowlist`, { userId, error });
      throw error;
    }
  }

  /**
   * 检查是否在黄名单中
   */
  async isYellowlisted(userId: string, symbol: string): Promise<boolean> {
    const db = await getDatabase();

    try {
      const row = await db.get(`
        SELECT id FROM user_filters
        WHERE user_id = ? AND symbol = ? AND filter_type = ?
      `, [userId, symbol.toUpperCase(), 'yellowlist']);

      return !!row;
    } catch (error) {
      log.error(`Failed to check yellowlist`, { userId, symbol, error });
      return false;
    }
  }
}