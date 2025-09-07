import { getDatabase } from '../database/connection';
import { PriceAlert } from '../database/schema';

export class PriceAlertModel {
  static async createAlert(
    userId: string,
    symbol: string,
    condition: 'above' | 'below' | 'change',
    value: number
  ): Promise<number> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    const result = await db.run(
      'INSERT INTO price_alerts (user_id, symbol, condition, value, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      userId, symbol, condition, value, now
    );

    return result.lastID!;
  }

  static async getActiveAlerts(userId: string): Promise<PriceAlert[]> {
    const db = await getDatabase();

    return db.all<PriceAlert[]>(
      'SELECT * FROM price_alerts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC',
      userId
    );
  }

  static async deactivateAlert(alertId: number): Promise<void> {
    const db = await getDatabase();

    await db.run(
      'UPDATE price_alerts SET is_active = 0, triggered_at = ? WHERE id = ?',
      new Date().toISOString(), alertId
    );
  }

  static async getAllActiveAlerts(): Promise<PriceAlert[]> {
    const db = await getDatabase();

    return db.all<PriceAlert[]>(
      'SELECT * FROM price_alerts WHERE is_active = 1'
    );
  }
}