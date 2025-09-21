#!/usr/bin/env npx ts-node

/**
 * 数据库迁移脚本：更新user_filters表支持yellowlist
 * 解决CHECK约束不包含'yellowlist'的问题
 */

import Database from 'better-sqlite3';
import * as path from 'path';

const DB_PATH = path.join(__dirname, '../data/crypto-tgalert.db');

async function migrateDatabase() {
  console.log('🔧 开始数据库迁移：添加yellowlist支持...');

  const db = new Database(DB_PATH);

  try {
    // 临时禁用外键约束检查
    db.exec('PRAGMA foreign_keys = OFF');

    // 开始事务
    db.exec('BEGIN TRANSACTION');

    // 1. 检查当前表结构
    const tableInfo = db.prepare("PRAGMA table_info(user_filters)").all();
    console.log('📋 当前表结构:', tableInfo);

    // 2. 备份现有数据
    interface UserFilterRow {
      id: number;
      user_id: string;
      symbol: string;
      filter_type: string;
      expires_at: number | null;
      reason: string | null;
      created_at: number;
      updated_at: number;
    }

    const existingData = db.prepare("SELECT * FROM user_filters").all() as UserFilterRow[];
    console.log(`📦 备份现有数据: ${existingData.length}条记录`);

    // 3. 重命名现有表
    db.exec('ALTER TABLE user_filters RENAME TO user_filters_backup');
    console.log('✅ 已备份现有表为 user_filters_backup');

    // 4. 创建新表（带正确的yellowlist约束）
    const createNewTable = `
      CREATE TABLE user_filters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        filter_type TEXT NOT NULL CHECK (filter_type IN ('blacklist', 'mute', 'yellowlist')),
        expires_at INTEGER NULL,
        reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES user_config(user_id),
        UNIQUE(user_id, symbol, filter_type)
      )
    `;

    db.exec(createNewTable);
    console.log('✅ 已创建新的user_filters表（支持yellowlist）');

    // 5. 复制数据（如果有的话）
    if (existingData.length > 0) {
      const insertStmt = db.prepare(`
        INSERT INTO user_filters (id, user_id, symbol, filter_type, expires_at, reason, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const row of existingData) {
        insertStmt.run(
          row.id, row.user_id, row.symbol, row.filter_type,
          row.expires_at, row.reason, row.created_at, row.updated_at
        );
      }
      console.log(`✅ 已迁移 ${existingData.length} 条现有记录`);
    }

    // 6. 重建索引
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_filters_user ON user_filters(user_id, filter_type)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_filters_expires ON user_filters(expires_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_user_filters_symbol ON user_filters(symbol)');
    console.log('✅ 已重建索引');

    // 7. 删除备份表
    db.exec('DROP TABLE user_filters_backup');
    console.log('✅ 已清理备份表');

    // 提交事务
    db.exec('COMMIT');

    // 重新启用外键约束检查
    db.exec('PRAGMA foreign_keys = ON');
    console.log('🎉 数据库迁移完成！现在支持yellowlist功能');

    // 8. 验证新约束（检查表结构）
    try {
      const constraintCheck = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_filters'").get();
      if (constraintCheck && constraintCheck.sql.includes("'yellowlist'")) {
        console.log('✅ yellowlist约束验证成功 - 表结构已正确更新');
      } else {
        throw new Error('yellowlist约束未正确应用');
      }
    } catch (error) {
      console.error('❌ yellowlist约束验证失败:', error);
      throw error;
    }

  } catch (error) {
    // 回滚事务
    db.exec('ROLLBACK');
    console.error('❌ 迁移失败，已回滚:', error);
    throw error;
  } finally {
    db.close();
  }
}

// 运行迁移
if (require.main === module) {
  migrateDatabase()
    .then(() => {
      console.log('✅ 迁移脚本执行完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 迁移脚本执行失败:', error);
      process.exit(1);
    });
}

export { migrateDatabase };