import { Database, open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { createTables } from './schema';

let dbInstance: Database | null = null;

export async function initDatabase(customPath?: string): Promise<Database> {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = customPath || process.env.DATABASE_PATH || './data/crypto-tgalert.db';
  
  // Only create directory if not using in-memory database
  if (dbPath !== ':memory:') {
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await dbInstance.exec(createTables);

  console.log('✅ Database initialized:', dbPath);
  return dbInstance;
}

export async function getDatabase(): Promise<Database> {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close();
    dbInstance = null;
    console.log('✅ Database connection closed');
  }
}