import Database from 'better-sqlite3';
import { log } from '../../utils/logger';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'crypto-alerts.db');

export enum AlertIdType {
  PRICE_ALERT = 'P',
  BREAKTHROUGH = 'B',
  VOLUME_SPIKE = 'V',
  PUMP_DUMP = 'T' // 保持现有格式
}

export interface AlertIdRecord {
  id: string;
  type: AlertIdType;
  sequence: number;
  userId: string;
  originalId?: string; // 用于迁移现有警报
  createdAt: string;
}

/**
 * 统一警报ID管理器
 * 为所有类型的警报生成简洁、用户友好的ID
 */
export class AlertIdManager {
  private static db: Database.Database;
  private static initialized = false;

  /**
   * 初始化ID管理器
   */
  static async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.db = new Database(DB_PATH);

      // 创建警报ID管理表
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS alert_id_mapping (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          user_id TEXT NOT NULL,
          original_id TEXT, -- 用于存储原有的复杂ID，便于迁移
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(type, sequence)
        )
      `);

      // 创建索引
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_alert_id_user_type
        ON alert_id_mapping(user_id, type);

        CREATE INDEX IF NOT EXISTS idx_alert_id_original
        ON alert_id_mapping(original_id);
      `);

      this.initialized = true;
      log.info('AlertIdManager initialized successfully');
    } catch (error) {
      log.error('Failed to initialize AlertIdManager', error);
      throw error;
    }
  }

  /**
   * 生成新的警报ID
   */
  static async generateId(type: AlertIdType, userId: string, originalId?: string): Promise<string> {
    if (!this.initialized) await this.initialize();

    try {
      // 获取该类型的下一个序号
      const sequence = await this.getNextSequence(type);
      const id = `${type}${sequence}`;

      // 保存ID记录
      const stmt = this.db.prepare(`
        INSERT INTO alert_id_mapping (id, type, sequence, user_id, original_id)
        VALUES (?, ?, ?, ?, ?)
      `);

      stmt.run(id, type, sequence, userId, originalId || null);

      log.debug('Generated new alert ID', { id, type, sequence, userId });
      return id;
    } catch (error) {
      log.error('Failed to generate alert ID', error);
      throw error;
    }
  }

  /**
   * 根据原始ID查找简化ID（用于迁移）
   */
  static async findIdByOriginal(originalId: string): Promise<string | null> {
    if (!this.initialized) await this.initialize();

    try {
      const stmt = this.db.prepare(`
        SELECT id FROM alert_id_mapping WHERE original_id = ?
      `);

      const result = stmt.get(originalId) as { id: string } | undefined;
      return result?.id || null;
    } catch (error) {
      log.error('Failed to find ID by original', error);
      return null;
    }
  }

  /**
   * 根据简化ID查找原始ID（用于向后兼容）
   */
  static async findOriginalById(id: string): Promise<string | null> {
    if (!this.initialized) await this.initialize();

    try {
      const stmt = this.db.prepare(`
        SELECT original_id FROM alert_id_mapping WHERE id = ?
      `);

      const result = stmt.get(id) as { original_id: string | null } | undefined;
      return result?.original_id || null;
    } catch (error) {
      log.error('Failed to find original ID', error);
      return null;
    }
  }

  /**
   * 验证ID是否存在
   */
  static async isValidId(id: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    try {
      const stmt = this.db.prepare(`
        SELECT 1 FROM alert_id_mapping WHERE id = ?
      `);

      return !!stmt.get(id);
    } catch (error) {
      log.error('Failed to validate ID', error);
      return false;
    }
  }

  /**
   * 删除ID记录
   */
  static async removeId(id: string): Promise<boolean> {
    if (!this.initialized) await this.initialize();

    try {
      const stmt = this.db.prepare(`
        DELETE FROM alert_id_mapping WHERE id = ?
      `);

      const result = stmt.run(id);
      return result.changes > 0;
    } catch (error) {
      log.error('Failed to remove alert ID', error);
      return false;
    }
  }

  /**
   * 获取用户的所有警报ID
   */
  static async getUserAlertIds(userId: string): Promise<AlertIdRecord[]> {
    if (!this.initialized) await this.initialize();

    try {
      const stmt = this.db.prepare(`
        SELECT
          id, type, sequence, user_id as userId,
          original_id as originalId, created_at as createdAt
        FROM alert_id_mapping
        WHERE user_id = ?
        ORDER BY created_at DESC
      `);

      return stmt.all(userId) as AlertIdRecord[];
    } catch (error) {
      log.error('Failed to get user alert IDs', error);
      return [];
    }
  }

  /**
   * 迁移现有的复杂ID到简化格式
   */
  static async migrateExistingId(originalId: string, type: AlertIdType, userId: string): Promise<string> {
    // 先检查是否已经迁移过
    const existingId = await this.findIdByOriginal(originalId);
    if (existingId) {
      return existingId;
    }

    // 生成新的简化ID
    return await this.generateId(type, userId, originalId);
  }

  /**
   * 获取下一个序号
   */
  private static async getNextSequence(type: AlertIdType): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT MAX(sequence) as max_seq FROM alert_id_mapping WHERE type = ?
    `);

    const result = stmt.get(type) as { max_seq: number | null };
    return (result?.max_seq || 0) + 1;
  }

  /**
   * 解析ID获取类型和序号
   */
  static parseId(id: string): { type: AlertIdType; sequence: number } | null {
    const match = id.match(/^([PBVT])(\d+)$/);
    if (!match) return null;

    return {
      type: match[1] as AlertIdType,
      sequence: parseInt(match[2])
    };
  }

  /**
   * 根据警报类型确定ID类型
   */
  static getIdTypeFromAlertType(alertType: string): AlertIdType {
    switch (alertType) {
      case 'PRICE_ABOVE':
      case 'PRICE_BELOW':
      case 'PRICE_CHANGE':
        return AlertIdType.PRICE_ALERT;

      case 'BREAKTHROUGH':
      case 'MULTI_BREAKTHROUGH':
        return AlertIdType.BREAKTHROUGH;

      case 'VOLUME_SPIKE':
        return AlertIdType.VOLUME_SPIKE;

      case 'PUMP_DUMP':
      case 'PUMP_DUMP_ALERT':
        return AlertIdType.PUMP_DUMP;

      default:
        return AlertIdType.PRICE_ALERT; // 默认
    }
  }

  /**
   * 获取统计信息
   */
  static async getStats(): Promise<{
    totalIds: number;
    byType: Record<string, number>;
    recentMigrations: number;
  }> {
    if (!this.initialized) await this.initialize();

    try {
      // 总数
      const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM alert_id_mapping`);
      const totalResult = totalStmt.get() as { count: number };

      // 按类型统计
      const typeStmt = this.db.prepare(`
        SELECT type, COUNT(*) as count
        FROM alert_id_mapping
        GROUP BY type
      `);
      const typeResults = typeStmt.all() as { type: string; count: number }[];
      const byType = typeResults.reduce((acc, { type, count }) => {
        acc[type] = count;
        return acc;
      }, {} as Record<string, number>);

      // 最近迁移的数量（有original_id的记录）
      const migrationStmt = this.db.prepare(`
        SELECT COUNT(*) as count
        FROM alert_id_mapping
        WHERE original_id IS NOT NULL
      `);
      const migrationResult = migrationStmt.get() as { count: number };

      return {
        totalIds: totalResult.count,
        byType,
        recentMigrations: migrationResult.count
      };
    } catch (error) {
      log.error('Failed to get AlertIdManager stats', error);
      return { totalIds: 0, byType: {}, recentMigrations: 0 };
    }
  }
}