import { ICommandHandler, BotContext, CommandResult } from '../ICommandHandler';
import { MessageFormatter } from '../MessageFormatter';
import { log } from '../../../utils/logger';

export abstract class BaseCommandHandler implements ICommandHandler {
  abstract readonly command: string;
  abstract readonly description: string;
  abstract readonly requiresAuth: boolean;

  constructor(
    protected formatter: MessageFormatter,
    protected logger: typeof log
  ) {}

  abstract handle(ctx: BotContext, args: string[]): Promise<CommandResult>;

  getHelp(): string {
    return `/${this.command} - ${this.description}`;
  }

  protected async safeExecute(
    ctx: BotContext,
    operation: () => Promise<CommandResult>
  ): Promise<CommandResult> {
    try {
      this.logger.debug(`Executing command: ${this.command}`, {
        userId: ctx.from?.id,
        args: ctx.message ? 'text' in ctx.message ? ctx.message.text : '' : ''
      });

      const result = await operation();

      this.logger.debug(`Command executed successfully: ${this.command}`, {
        success: result.success,
        hasMessage: !!result.message
      });

      return result;
    } catch (error) {
      this.logger.error(`Command execution failed: ${this.command}`, {
        error: error instanceof Error ? error.message : String(error),
        userId: ctx.from?.id
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: this.formatter.formatError(error instanceof Error ? error : String(error)),
        shouldReply: true
      };
    }
  }

  protected parseArgs(text: string): string[] {
    // 移除命令部分，获取参数
    const parts = text.trim().split(/\s+/);
    return parts.slice(1); // 跳过命令本身
  }

  protected validateArgs(args: string[], minLength: number, maxLength?: number): boolean {
    if (args.length < minLength) {
      return false;
    }
    if (maxLength && args.length > maxLength) {
      return false;
    }
    return true;
  }

  protected async reply(ctx: BotContext, message: string, options?: any): Promise<void> {
    try {
      await ctx.reply(message, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      this.logger.error('Failed to send reply', {
        command: this.command,
        error: error instanceof Error ? error.message : String(error)
      });

      // 尝试发送纯文本消息
      try {
        await ctx.reply(message.replace(/[*_`\[\]()]/g, ''));
      } catch (fallbackError) {
        this.logger.error('Failed to send fallback reply', {
          command: this.command,
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        });
      }
    }
  }

  protected isValidSymbol(symbol: string): boolean {
    // 基本的符号验证：支持2-10个字母，可选USDT/USD后缀
    return /^[A-Z]{2,10}(USDT|USD)?$/.test(symbol.toUpperCase());
  }

  protected normalizeSymbol(symbol: string): string {
    const upper = symbol.toUpperCase();
    // 如果没有USDT后缀，自动添加
    if (!upper.endsWith('USDT') && !upper.endsWith('USD')) {
      return upper + 'USDT';
    }
    return upper;
  }

  protected formatSymbolList(symbols: string[]): string {
    if (symbols.length === 0) {
      return 'No symbols found';
    }

    if (symbols.length <= 10) {
      return symbols.join(', ');
    }

    return `${symbols.slice(0, 10).join(', ')} and ${symbols.length - 10} more...`;
  }

  protected createPaginationButtons(currentPage: number, totalPages: number, baseCommand: string): any {
    const buttons = [];

    if (currentPage > 1) {
      buttons.push({
        text: '⬅️ Previous',
        data: `${baseCommand}_page_${currentPage - 1}`
      });
    }

    buttons.push({
      text: `${currentPage}/${totalPages}`,
      data: 'noop'
    });

    if (currentPage < totalPages) {
      buttons.push({
        text: 'Next ➡️',
        data: `${baseCommand}_page_${currentPage + 1}`
      });
    }

    return this.formatter.formatInlineKeyboard(buttons);
  }

  protected extractUserId(ctx: BotContext): number {
    return ctx.from?.id || 0;
  }

  protected extractChatId(ctx: BotContext): number {
    return ctx.chat?.id || 0;
  }

  protected isPrivateChat(ctx: BotContext): boolean {
    return ctx.chat?.type === 'private';
  }

  protected hasPermission(ctx: BotContext, _requiredRole?: string): boolean {
    // 基础权限检查 - 可以扩展为更复杂的权限系统
    if (!this.requiresAuth) {
      return true;
    }

    const userId = this.extractUserId(ctx);
    // TODO: 实现基于用户ID的权限检查
    return userId > 0;
  }
}