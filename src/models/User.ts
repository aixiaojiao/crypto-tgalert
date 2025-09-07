import { getDatabase } from '../database/connection';
import { UserConfig } from '../database/schema';

export class UserModel {
  static async findOrCreateUser(userId: string): Promise<UserConfig> {
    const db = await getDatabase();

    let user = await db.get<UserConfig>(
      'SELECT * FROM user_config WHERE user_id = ?',
      userId
    );

    if (!user) {
      const now = new Date().toISOString();
      await db.run(
        'INSERT INTO user_config (user_id, created_at, updated_at) VALUES (?, ?, ?)',
        userId, now, now
      );

      user = {
        user_id: userId,
        created_at: now,
        updated_at: now
      };
    }

    return user;
  }

  static async updateUser(userId: string): Promise<void> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    await db.run(
      'UPDATE user_config SET updated_at = ? WHERE user_id = ?',
      now, userId
    );
  }
}