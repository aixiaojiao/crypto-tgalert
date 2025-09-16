import { Telegraf } from 'telegraf';
import { ITelegramService, BotStatus, BotContext } from './ICommandHandler';
import { CommandRegistry } from './CommandRegistry';
import { MessageFormatter } from './MessageFormatter';
import { ILifecycleAware } from '../../core/Application';
import { log } from '../../utils/logger';
import { config } from '../../config';

export class TelegramService implements ITelegramService, ILifecycleAware {
  private bot: Telegraf<BotContext>;
  private status: BotStatus;
  private commandRegistry: CommandRegistry;
  private messageFormatter: MessageFormatter;

  constructor(
    private logger: typeof log,
    commandRegistry: CommandRegistry,
    messageFormatter: MessageFormatter
  ) {
    this.commandRegistry = commandRegistry;
    this.messageFormatter = messageFormatter;

    this.bot = new Telegraf<BotContext>(config.telegram.botToken);
    this.status = {
      isRunning: false,
      startTime: new Date(),
      commandsProcessed: 0,
      errors: 0,
      lastActivity: new Date(),
      activeUsers: 0
    };

    this.setupMiddleware();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  async initialize(): Promise<void> {
    this.logger.info('Initializing Telegram service');

    // 注册默认命令别名
    this.commandRegistry.registerDefaultAliases();

    // 验证Bot Token
    try {
      const botInfo = await this.bot.telegram.getMe();
      this.logger.info('Telegram bot info retrieved', {
        username: botInfo.username,
        id: botInfo.id
      });
    } catch (error) {
      this.logger.error('Failed to get bot info', error);
      throw new Error('Invalid Telegram bot token');
    }
  }

  async start(): Promise<void> {
    if (this.status.isRunning) {
      this.logger.warn('Telegram service is already running');
      return;
    }

    try {
      await this.bot.launch();
      this.status.isRunning = true;
      this.status.startTime = new Date();

      this.logger.info('Telegram bot started successfully');

      // 发送启动通知
      await this.sendStartupNotification();

    } catch (error) {
      this.logger.error('Failed to start Telegram bot', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.status.isRunning) {
      return;
    }

    try {
      this.bot.stop();
      this.status.isRunning = false;

      this.logger.info('Telegram bot stopped');
    } catch (error) {
      this.logger.error('Error stopping Telegram bot', error);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  async sendMessage(chatId: number, message: string, options?: any): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...options
      });

      this.updateActivity();
    } catch (error) {
      this.logger.error('Failed to send message', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async sendFormattedMessage(
    chatId: number,
    data: any,
    formatter: (data: any) => string
  ): Promise<void> {
    const message = formatter(data);
    await this.sendMessage(chatId, message);
  }

  async sendAlert(alertData: any): Promise<void> {
    const chatId = Number(config.telegram.userId);
    const message = this.messageFormatter.formatAlert(alertData);

    try {
      await this.sendMessage(chatId, message);
      this.logger.info('Alert sent successfully', { alertId: alertData.id });
    } catch (error) {
      this.logger.error('Failed to send alert', {
        alertId: alertData.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async sendError(error: Error | string): Promise<void> {
    const chatId = Number(config.telegram.userId);
    const message = this.messageFormatter.formatError(error);

    try {
      await this.sendMessage(chatId, message);
    } catch (sendError) {
      this.logger.error('Failed to send error notification', {
        originalError: error instanceof Error ? error.message : error,
        sendError: sendError instanceof Error ? sendError.message : String(sendError)
      });
    }
  }

  getBotStatus(): BotStatus {
    return {
      ...this.status,
      lastActivity: this.status.lastActivity || new Date()
    };
  }

  // Bot event methods for external services
  async notifyPriceAlert(symbol: string, currentPrice: number, targetPrice: number, type: string): Promise<void> {
    const alertData = {
      id: `price-${Date.now()}`,
      symbol,
      type,
      currentValue: currentPrice,
      thresholdValue: targetPrice,
      triggeredAt: new Date()
    };

    await this.sendAlert(alertData);
  }

  async notifySystemStatus(status: any): Promise<void> {
    const chatId = Number(config.telegram.userId);
    const message = this.messageFormatter.formatStatus(status);
    await this.sendMessage(chatId, message);
  }

  // Private methods

  private setupMiddleware(): void {
    // 认证中间件
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      const allowedUserId = Number(config.telegram.userId);

      if (userId !== allowedUserId) {
        this.logger.warn('Unauthorized access attempt', {
          userId,
          username: ctx.from?.username
        });
        await ctx.reply('❌ You are not authorized to use this bot.');
        return;
      }

      return next();
    });

    // 活动跟踪中间件
    this.bot.use(async (_ctx, next) => {
      this.updateActivity();
      this.status.commandsProcessed++;
      return next();
    });

    // 日志中间件
    this.bot.use(async (ctx, next) => {
      const start = Date.now();

      this.logger.debug('Processing message', {
        userId: ctx.from?.id,
        username: ctx.from?.username,
        type: ctx.updateType
      });

      try {
        await next();
      } finally {
        const duration = Date.now() - start;
        this.logger.debug('Message processed', { duration });
      }
    });
  }

  private setupHandlers(): void {
    // 命令处理
    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text;

      if (!text.startsWith('/')) {
        return;
      }

      const command = text.split(' ')[0].substring(1).toLowerCase();
      const handled = await this.commandRegistry.handleCommand(command, ctx);

      if (!handled) {
        await ctx.reply(
          `❌ Unknown command: /${command}\n\nUse /help to see available commands.`
        );
      }
    });

    // 回调查询处理
    this.bot.on('callback_query', async (ctx) => {
      try {
        const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
        if (data) {
          await this.handleCallbackQuery(ctx, data);
        }
        await ctx.answerCbQuery();
      } catch (error) {
        this.logger.error('Error handling callback query', error);
        await ctx.answerCbQuery('Error processing request');
      }
    });
  }

  private setupErrorHandling(): void {
    this.bot.catch(async (err, ctx) => {
      this.status.errors++;

      this.logger.error('Bot error occurred', {
        error: err instanceof Error ? err.message : String(err),
        userId: ctx.from?.id,
        updateType: ctx.updateType
      });

      try {
        await ctx.reply('❌ An error occurred. Please try again later.');
      } catch (replyError) {
        this.logger.error('Failed to send error reply', replyError);
      }
    });

    // 全局错误处理
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection in Telegram service', {
        reason,
        promise
      });
    });
  }

  private async handleCallbackQuery(ctx: any, data: string): Promise<void> {
    // 解析回调数据
    const parts = data.split('_');
    const action = parts[0];

    switch (action) {
      case 'page':
        // 处理分页回调
        await this.handlePagination(ctx, parts);
        break;

      case 'alert':
        // 处理报警相关回调
        await this.handleAlertCallback(ctx, parts);
        break;

      default:
        this.logger.warn('Unknown callback action', { action, data });
        break;
    }
  }

  private async handlePagination(_ctx: any, parts: string[]): Promise<void> {
    // TODO: 实现分页处理逻辑
    this.logger.debug('Handling pagination', { parts });
  }

  private async handleAlertCallback(_ctx: any, parts: string[]): Promise<void> {
    // TODO: 实现报警回调处理逻辑
    this.logger.debug('Handling alert callback', { parts });
  }

  private updateActivity(): void {
    this.status.lastActivity = new Date();
  }

  private async sendStartupNotification(): Promise<void> {
    try {
      const message = `🤖 *Crypto TG Alert Bot Started*

🟢 Status: Online
🚀 Started: ${this.status.startTime.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
📊 Ready to monitor crypto prices

Use /help to see available commands.`;

      await this.sendMessage(Number(config.telegram.userId), message);
    } catch (error) {
      this.logger.warn('Failed to send startup notification', error);
    }
  }
}