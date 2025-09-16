import { ICommandHandler, BotContext } from './ICommandHandler';
import { log } from '../../utils/logger';

export class CommandRegistry {
  private commands = new Map<string, ICommandHandler>();
  private aliases = new Map<string, string>();

  constructor(
    private logger: typeof log
  ) {}

  /**
   * 注册命令处理器
   */
  register(handler: ICommandHandler): void {
    this.commands.set(handler.command, handler);

    this.logger.debug('Command registered', {
      command: handler.command,
      description: handler.description,
      requiresAuth: handler.requiresAuth
    });
  }

  /**
   * 批量注册命令处理器
   */
  registerAll(handlers: ICommandHandler[]): void {
    handlers.forEach(handler => this.register(handler));
  }

  /**
   * 注册命令别名
   */
  registerAlias(alias: string, command: string): void {
    if (!this.commands.has(command)) {
      throw new Error(`Cannot create alias '${alias}' for unknown command '${command}'`);
    }

    this.aliases.set(alias, command);
    this.logger.debug('Command alias registered', { alias, command });
  }

  /**
   * 获取命令处理器
   */
  getHandler(command: string): ICommandHandler | null {
    // 检查直接命令
    let handler = this.commands.get(command);
    if (handler) {
      return handler;
    }

    // 检查别名
    const aliasTarget = this.aliases.get(command);
    if (aliasTarget) {
      return this.commands.get(aliasTarget) || null;
    }

    return null;
  }

  /**
   * 处理命令
   */
  async handleCommand(command: string, ctx: BotContext): Promise<boolean> {
    const handler = this.getHandler(command);
    if (!handler) {
      return false;
    }

    try {
      // 检查权限
      if (handler.requiresAuth && !this.checkPermission(ctx, handler)) {
        await ctx.reply('❌ You don\'t have permission to use this command.');
        return true;
      }

      // 解析参数
      const args = this.parseArgs(ctx);

      // 执行命令
      const result = await handler.handle(ctx, args);

      // 发送响应
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }

      // 记录命令执行
      this.logger.info('Command executed', {
        command: handler.command,
        success: result.success,
        userId: ctx.from?.id,
        username: ctx.from?.username
      });

      return true;
    } catch (error) {
      this.logger.error('Command execution failed', {
        command: handler.command,
        error: error instanceof Error ? error.message : String(error),
        userId: ctx.from?.id
      });

      await ctx.reply('❌ An error occurred while processing your command.');
      return true;
    }
  }

  /**
   * 获取所有可用命令
   */
  getAvailableCommands(requiresAuth?: boolean): Array<{ command: string; description: string }> {
    const commands: Array<{ command: string; description: string }> = [];

    for (const [command, handler] of this.commands) {
      if (requiresAuth === undefined || handler.requiresAuth === requiresAuth) {
        commands.push({
          command,
          description: handler.description
        });
      }
    }

    return commands.sort((a, b) => a.command.localeCompare(b.command));
  }

  /**
   * 获取命令帮助信息
   */
  getCommandHelp(command: string): string | null {
    const handler = this.getHandler(command);
    return handler ? handler.getHelp() : null;
  }

  /**
   * 检查命令是否存在
   */
  hasCommand(command: string): boolean {
    return this.commands.has(command) || this.aliases.has(command);
  }

  /**
   * 获取命令统计信息
   */
  getStatistics() {
    return {
      totalCommands: this.commands.size,
      totalAliases: this.aliases.size,
      authCommands: Array.from(this.commands.values()).filter(h => h.requiresAuth).length,
      publicCommands: Array.from(this.commands.values()).filter(h => !h.requiresAuth).length
    };
  }

  // Private methods

  private parseArgs(ctx: BotContext): string[] {
    if (!ctx.message || !('text' in ctx.message)) {
      return [];
    }

    const text = ctx.message.text;
    const parts = text.trim().split(/\s+/);
    return parts.slice(1); // 跳过命令本身
  }

  private checkPermission(ctx: BotContext, handler: ICommandHandler): boolean {
    // 基础权限检查
    if (!handler.requiresAuth) {
      return true;
    }

    const userId = ctx.from?.id;
    if (!userId) {
      return false;
    }

    // TODO: 实现更复杂的权限系统
    // 现在简单检查用户ID是否存在
    return userId > 0;
  }

  /**
   * 注册默认命令别名
   */
  registerDefaultAliases(): void {
    const defaultAliases = [
      { alias: 'p', command: 'price' },
      { alias: 'help', command: 'start' },
      { alias: 'h', command: 'start' },
      { alias: 'status', command: 'stats' },
      { alias: 'alerts', command: 'listalerts' }
    ];

    defaultAliases.forEach(({ alias, command }) => {
      if (this.commands.has(command)) {
        this.registerAlias(alias, command);
      }
    });
  }
}