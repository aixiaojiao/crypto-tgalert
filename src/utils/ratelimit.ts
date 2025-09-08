import { log } from './logger';

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface RequestRecord {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private records = new Map<string, RequestRecord>();
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;

    // 定期清理过期记录
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.windowMs);
  }

  // 检查是否被限制
  public isLimited(key: string): boolean {
    const now = Date.now();
    const record = this.records.get(key);

    if (!record) {
      this.records.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs
      });
      return false;
    }

    if (now > record.resetTime) {
      // 重置计数器
      this.records.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs
      });
      return false;
    }

    record.count++;

    if (record.count > this.config.maxRequests) {
      log.warn(`速率限制触发: ${key}`, {
        count: record.count,
        limit: this.config.maxRequests,
        resetTime: new Date(record.resetTime).toISOString()
      });
      return true;
    }

    return false;
  }

  // 获取剩余请求数
  public getRemainingRequests(key: string): number {
    const record = this.records.get(key);
    if (!record || Date.now() > record.resetTime) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - record.count);
  }

  // 清理过期记录
  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, record] of this.records.entries()) {
      if (now > record.resetTime) {
        this.records.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`清理了 ${cleanedCount} 个过期的速率限制记录`);
    }
  }

  // 销毁速率限制器
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.records.clear();
    log.debug('RateLimiter destroyed');
  }
}

// 预定义的速率限制器
export const binanceRateLimit = new RateLimiter({
  windowMs: 60000, // 1分钟
  maxRequests: 1200 // Binance限制
});

export const twitterRateLimit = new RateLimiter({
  windowMs: 15 * 60000, // 15分钟
  maxRequests: 300 // Twitter限制
});