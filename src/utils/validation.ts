import { ValidationError } from './errors';
import { log } from './logger';

// 环境变量验证
export function validateEnvironment(): void {
  const required = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_USER_ID',
    'BINANCE_API_KEY',
    'BINANCE_API_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    const error = new ValidationError(`缺少必需的环境变量: ${missing.join(', ')}`);
    log.error(error.message);
    throw error;
  }

  // 验证Telegram User ID格式
  const userId = process.env.TELEGRAM_USER_ID!;
  if (!/^\d+$/.test(userId)) {
    throw new ValidationError('TELEGRAM_USER_ID 必须是数字');
  }

  // 验证Bot Token格式
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    throw new ValidationError('TELEGRAM_BOT_TOKEN 格式不正确');
  }

  log.info('环境变量验证通过');
}

// 交易对验证
export function validateTradingPair(symbol: string): boolean {
  // 基本格式检查
  if (!/^[A-Z]+USDT?$/.test(symbol.toUpperCase())) {
    return false;
  }

  return true;
}

// 价格验证
export function validatePrice(price: number): boolean {
  return price > 0 && isFinite(price);
}

// 百分比验证
export function validatePercentage(percentage: number): boolean {
  return percentage >= -100 && percentage <= 1000 && isFinite(percentage);
}