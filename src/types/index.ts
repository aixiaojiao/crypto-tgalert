import { Context } from 'telegraf';

// 使用Telegraf的Context直接作为BotContext
export type BotContext = Context;

// 用户命令参数类型
export interface CommandArgs {
  command: string;
  args: string[];
  fullText: string;
}

// 价格查询结果
export interface PriceData {
  symbol: string;
  price: number;
  change24h?: number;
  volume24h?: number;
}

// 提醒配置
export interface AlertConfig {
  symbol: string;
  condition: 'above' | 'below' | 'change';
  value: number;
  userId: string;
}

// Bot状态
export interface BotStatus {
  isRunning: boolean;
  startTime: Date;
  commandsProcessed: number;
  errors: number;
}

// 命令处理结果
export interface CommandResult {
  success: boolean;
  message: string;
  data?: any;
}