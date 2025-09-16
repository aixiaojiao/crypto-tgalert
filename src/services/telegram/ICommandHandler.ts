import { Context } from 'telegraf';

export interface BotContext extends Context {
  match?: RegExpMatchArray;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  error?: string;
  shouldReply?: boolean;
}

export interface ICommandHandler {
  /**
   * 命令名称
   */
  readonly command: string;

  /**
   * 命令描述
   */
  readonly description: string;

  /**
   * 命令是否需要认证
   */
  readonly requiresAuth: boolean;

  /**
   * 处理命令
   */
  handle(ctx: BotContext, args: string[]): Promise<CommandResult>;

  /**
   * 获取命令帮助信息
   */
  getHelp(): string;
}

export interface IMessageFormatter {
  /**
   * 格式化价格信息
   */
  formatPrice(symbol: string, price: number, change?: number): string;

  /**
   * 格式化报警信息
   */
  formatAlert(alertData: any): string;

  /**
   * 格式化市场数据
   */
  formatMarketData(data: any): string;

  /**
   * 格式化错误信息
   */
  formatError(error: Error | string): string;

  /**
   * 格式化列表数据
   */
  formatList(items: any[], formatFn: (item: any) => string): string;
}

export interface ITelegramService {
  /**
   * 发送消息
   */
  sendMessage(chatId: number, message: string, options?: any): Promise<void>;

  /**
   * 发送格式化消息
   */
  sendFormattedMessage(chatId: number, data: any, formatter: (data: any) => string): Promise<void>;

  /**
   * 发送报警通知
   */
  sendAlert(alertData: any): Promise<void>;

  /**
   * 发送错误通知
   */
  sendError(error: Error | string): Promise<void>;

  /**
   * 获取Bot状态
   */
  getBotStatus(): BotStatus;
}

export interface BotStatus {
  isRunning: boolean;
  startTime: Date;
  commandsProcessed: number;
  errors: number;
  lastActivity?: Date;
  activeUsers?: number;
}