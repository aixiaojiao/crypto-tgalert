import { getDatabase } from '../database/connection';
import { TwitterFollow } from '../database/schema';

export class TwitterFollowModel {
  static async addFollow(userId: string, twitterUsername: string): Promise<number> {
    const db = await getDatabase();
    const now = new Date().toISOString();

    try {
      const result = await db.run(
        'INSERT INTO twitter_follows (user_id, twitter_username, created_at) VALUES (?, ?, ?)',
        userId, twitterUsername, now
      );
      return result.lastID!;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('UNIQUE constraint failed')) {
        throw new Error(`已经关注了 @${twitterUsername}`);
      }
      throw error;
    }
  }

  static async removeFollow(userId: string, twitterUsername: string): Promise<boolean> {
    const db = await getDatabase();

    const result = await db.run(
      'DELETE FROM twitter_follows WHERE user_id = ? AND twitter_username = ?',
      userId, twitterUsername
    );

    return (result.changes || 0) > 0;
  }

  static async getUserFollows(userId: string): Promise<TwitterFollow[]> {
    const db = await getDatabase();

    return db.all<TwitterFollow[]>(
      'SELECT * FROM twitter_follows WHERE user_id = ? ORDER BY created_at DESC',
      userId
    );
  }

  static async getAllFollows(): Promise<TwitterFollow[]> {
    const db = await getDatabase();

    return db.all<TwitterFollow[]>(
      'SELECT * FROM twitter_follows ORDER BY created_at DESC'
    );
  }
}