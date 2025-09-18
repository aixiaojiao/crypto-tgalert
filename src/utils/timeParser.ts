/**
 * 时间解析工具
 * 支持多种时间格式：1h, 2d, 30m, 1w 等
 */

export interface ParsedDuration {
  milliseconds: number;
  humanReadable: string;
}

export class TimeParser {
  /**
   * 解析时间字符串到毫秒
   * 支持格式: 1h, 2d, 30m, 1w, 1y
   */
  static parseDuration(durationStr: string): ParsedDuration {
    const trimmed = durationStr.trim().toLowerCase();
    const match = trimmed.match(/^(\d+)(m|h|d|w|y)$/);

    if (!match) {
      throw new Error(`无效的时间格式: ${durationStr}. 支持格式: 30m, 2h, 1d, 1w, 1y`);
    }

    const value = parseInt(match[1]);
    const unit = match[2];

    if (value <= 0) {
      throw new Error(`时间值必须大于0: ${durationStr}`);
    }

    let milliseconds: number;
    let humanReadable: string;

    switch (unit) {
      case 'm': // 分钟
        milliseconds = value * 60 * 1000;
        humanReadable = `${value}分钟`;
        break;
      case 'h': // 小时
        milliseconds = value * 60 * 60 * 1000;
        humanReadable = `${value}小时`;
        break;
      case 'd': // 天
        milliseconds = value * 24 * 60 * 60 * 1000;
        humanReadable = `${value}天`;
        break;
      case 'w': // 周
        milliseconds = value * 7 * 24 * 60 * 60 * 1000;
        humanReadable = `${value}周`;
        break;
      case 'y': // 年
        milliseconds = value * 365 * 24 * 60 * 60 * 1000;
        humanReadable = `${value}年`;
        break;
      default:
        throw new Error(`不支持的时间单位: ${unit}`);
    }

    return { milliseconds, humanReadable };
  }

  /**
   * 计算从现在开始的过期时间戳
   */
  static getExpiresAt(durationStr: string): number {
    const { milliseconds } = this.parseDuration(durationStr);
    return Date.now() + milliseconds;
  }

  /**
   * 计算剩余时间的人类可读格式
   */
  static getRemainingTime(expiresAt: number): string {
    const now = Date.now();
    if (expiresAt <= now) {
      return '已过期';
    }

    const remaining = expiresAt - now;

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

    if (days > 0) {
      return hours > 0 ? `${days}天${hours}小时` : `${days}天`;
    } else if (hours > 0) {
      return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
    } else {
      return `${minutes}分钟`;
    }
  }

  /**
   * 检查时间戳是否已过期
   */
  static isExpired(expiresAt: number | null): boolean {
    if (expiresAt === null) return false;
    return Date.now() >= expiresAt;
  }

  /**
   * 验证时间格式是否有效
   */
  static isValidDuration(durationStr: string): boolean {
    try {
      this.parseDuration(durationStr);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取时间格式使用说明
   */
  static getUsageHelp(): string {
    return `
支持的时间格式:
• 分钟: 30m, 45m
• 小时: 1h, 2h, 24h
• 天: 1d, 7d, 30d
• 周: 1w, 2w
• 年: 1y

示例:
• /mute DOGE 2h  (屏蔽2小时)
• /mute SHIB 1d  (屏蔽1天)
• /mute BTC 1w   (屏蔽1周)
    `.trim();
  }
}