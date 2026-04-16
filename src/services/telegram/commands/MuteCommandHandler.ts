import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';
import { IAdvancedFilterManager } from '../../filters/AdvancedFilterManager';
import { IUserFilterService } from '../../filters/UserFilterService';
import { TimeParser } from '../../../utils/timeParser';

/**
 * 临时屏蔽命令处理器
 * 支持命令: /mute <symbol> <duration>|list|clear|remove
 */
export class MuteCommandHandler extends BaseCommandHandler {
  readonly command = 'mute';
  readonly description = '临时屏蔽代币推送 - /mute <symbol> <duration> 或 /mute list';
  readonly requiresAuth = false;

  constructor(
    formatter: any,
    logger: any,
    private filterManager: IAdvancedFilterManager,
    private userFilterService: IUserFilterService
  ) {
    super(formatter, logger);
  }

  async handle(ctx: BotContext, args: string[]): Promise<CommandResult> {
    return this.safeExecute(ctx, async () => {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return {
          success: false,
          message: '❌ 无法获取用户ID',
          shouldReply: true
        };
      }

      if (args.length === 0) {
        return this.showUsage();
      }

      // 检查是否是子命令
      const firstArg = args[0].toLowerCase();
      if (['list', 'ls', 'clear', 'remove', 'rm', 'unmute', 'help'].includes(firstArg)) {
        return this.handleSubCommand(userId, firstArg, args.slice(1));
      }

      // 否则处理为添加屏蔽命令: /mute <symbol> <duration> [reason]
      return this.handleAdd(userId, args);
    });
  }

  /**
   * 处理子命令
   */
  private async handleSubCommand(userId: string, subCommand: string, args: string[]): Promise<CommandResult> {
    switch (subCommand) {
      case 'list':
      case 'ls':
        return this.handleList(userId);
      case 'clear':
        return this.handleClear(userId);
      case 'remove':
      case 'rm':
      case 'unmute':
        return this.handleRemove(userId, args);
      case 'help':
        return this.showUsage();
      default:
        return this.showUsage();
    }
  }

  /**
   * 添加临时屏蔽
   */
  private async handleAdd(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length < 2) {
      return {
        success: false,
        message: '❌ 参数不足\n用法: /mute <symbol> <duration> [reason]\n示例: /mute DOGE 2h 波动太大',
        shouldReply: true
      };
    }

    const symbol = this.normalizeSymbol(args[0]);
    const duration = args[1];
    const reason = args.slice(2).join(' ') || undefined;

    // 验证符号
    if (!this.isValidSymbol(symbol)) {
      return {
        success: false,
        message: `❌ 无效的代币符号: ${symbol}`,
        shouldReply: true
      };
    }

    // 验证时间格式
    if (!TimeParser.isValidDuration(duration)) {
      return {
        success: false,
        message: `❌ 无效的时间格式: ${duration}\n\n${TimeParser.getUsageHelp()}`,
        shouldReply: true
      };
    }

    try {
      // 检查是否与系统过滤冲突
      const filterResult = await this.filterManager.checkFilter(userId, symbol);
      if (!filterResult.allowed && !filterResult.canOverride) {
        return {
          success: false,
          message: `❌ 无法屏蔽 ${symbol}：${filterResult.reason.replace(/^[🚫⛔⚠️🔒🔇]\s*/, '')}`,
          shouldReply: true
        };
      }

      await this.userFilterService.addMute(userId, symbol, duration, reason);

      const { humanReadable } = TimeParser.parseDuration(duration);
      let message = `✅ 已将 ${symbol} 临时屏蔽 ${humanReadable}`;

      if (reason) {
        message += `\n原因: ${reason}`;
      }

      // 如果原本有其他过滤状态，给出提示
      if (filterResult.source === 'system_yellowlist') {
        message += `\n\n💡 该代币原为系统警告代币，现已临时屏蔽`;
      } else if (filterResult.source === 'user_blacklist') {
        message += `\n\n💡 该代币已在个人黑名单中，临时屏蔽将在到期后恢复为黑名单状态`;
      }

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to add mute', { userId, symbol, duration, error });
      return {
        success: false,
        message: `❌ 屏蔽失败: ${error instanceof Error ? error.message : '未知错误'}`,
        shouldReply: true
      };
    }
  }

  /**
   * 移除屏蔽
   */
  private async handleRemove(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定要解除屏蔽的代币符号\n用法: /mute remove <symbol>',
        shouldReply: true
      };
    }

    const symbol = this.normalizeSymbol(args[0]);

    if (!this.isValidSymbol(symbol)) {
      return {
        success: false,
        message: `❌ 无效的代币符号: ${symbol}`,
        shouldReply: true
      };
    }

    try {
      await this.userFilterService.removeMute(userId, symbol);

      // 检查移除后的过滤状态
      const filterResult = await this.filterManager.checkFilter(userId, symbol);
      let message = `✅ 已解除 ${symbol} 的临时屏蔽`;

      if (!filterResult.allowed) {
        message += `\n\n💡 注意: 该代币仍受其他过滤规则影响 (${filterResult.reason})`;
      }

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to remove mute', { userId, symbol, error });
      return {
        success: false,
        message: `❌ 解除屏蔽失败: ${error instanceof Error ? error.message : '未知错误'}`,
        shouldReply: true
      };
    }
  }

  /**
   * 显示屏蔽列表
   */
  private async handleList(userId: string): Promise<CommandResult> {
    try {
      const muteList = await this.userFilterService.getMuteList(userId);

      if (muteList.length === 0) {
        return {
          success: true,
          message: '📋 当前没有临时屏蔽的代币\n\n💡 使用 /mute <symbol> <duration> 添加临时屏蔽',
          shouldReply: true
        };
      }

      let message = '🔇 **临时屏蔽列表**\n\n';

      // 按剩余时间排序，即将过期的排在前面
      const sortedList = muteList.sort((a, b) => {
        if (!a.expires_at || !b.expires_at) return 0;
        return a.expires_at - b.expires_at;
      });

      sortedList.forEach((rule, index) => {
        const remainingTime = rule.remaining_time || '未知';
        const reason = rule.reason ? ` (${rule.reason})` : '';

        // 标记即将过期的(小于1小时)
        const isExpiringSoon = rule.expires_at && (rule.expires_at - Date.now()) < 60 * 60 * 1000;
        const urgentFlag = isExpiringSoon ? ' ⏰' : '';

        message += `**${index + 1}. ${rule.symbol}**${urgentFlag}\n`;
        message += `   ⏱️ 剩余时间: ${remainingTime}\n`;
        if (reason) {
          message += `   📝 原因: ${rule.reason}\n`;
        }
        message += '\n';
      });

      // 添加管理提示
      message += '**管理命令:**\n';
      message += '• `/mute remove <symbol>` - 解除屏蔽\n';
      message += '• `/mute clear` - 清空所有屏蔽\n';
      message += '• ⏰ 标记表示1小时内过期';

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to get mute list', { userId, error });
      return {
        success: false,
        message: '❌ 获取屏蔽列表失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 清空所有屏蔽
   */
  private async handleClear(userId: string): Promise<CommandResult> {
    try {
      const count = await this.userFilterService.clearAll(userId, 'mute');

      if (count === 0) {
        return {
          success: true,
          message: '✅ 临时屏蔽列表已经是空的',
          shouldReply: true
        };
      }

      return {
        success: true,
        message: `✅ 已清空所有临时屏蔽 (${count}个代币)`,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to clear mutes', { userId, error });
      return {
        success: false,
        message: '❌ 清空屏蔽失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 显示使用说明
   */
  private showUsage(): CommandResult {
    const message = `🔇 **临时屏蔽命令**

**基本用法:**
• \`/mute <symbol> <duration> [reason]\` - 添加临时屏蔽
• \`/mute list\` - 查看屏蔽列表
• \`/mute remove <symbol>\` - 解除屏蔽
• \`/mute clear\` - 清空所有屏蔽

**时间格式:**
• 分钟: 30m, 45m
• 小时: 1h, 2h, 24h
• 天: 1d, 7d, 30d
• 周: 1w, 2w
• 年: 1y

**示例:**
• \`/mute DOGE 2h 波动太大\`
• \`/mute SHIB 1d\`
• \`/mute remove BTC\`
• \`/mute list\`

**说明:**
• 临时屏蔽到期后自动恢复
• 屏蔽期间该代币的所有推送都会被过滤
• 与黑名单不同，临时屏蔽有时间限制
• 可随时手动解除屏蔽

💡 **提示:** 使用 /black 命令管理永久黑名单`;

    return {
      success: true,
      message,
      shouldReply: true
    };
  }
}