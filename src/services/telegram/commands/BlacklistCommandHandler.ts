import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';
import { IAdvancedFilterManager } from '../../filters/AdvancedFilterManager';
import { IUserFilterService } from '../../filters/UserFilterService';

/**
 * 黑名单管理命令处理器
 * 支持命令: /blacklist add|remove|list|clear|system
 */
export class BlacklistCommandHandler extends BaseCommandHandler {
  readonly command = 'blacklist';
  readonly description = '管理个人黑名单 - /blacklist add|remove|list|clear|system';
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

      const action = args[0].toLowerCase();

      switch (action) {
        case 'add':
          return this.handleAdd(userId, args.slice(1));
        case 'remove':
        case 'rm':
          return this.handleRemove(userId, args.slice(1));
        case 'list':
        case 'ls':
          return this.handleList(userId);
        case 'clear':
          return this.handleClear(userId);
        case 'system':
          return this.handleSystemList();
        default:
          return this.showUsage();
      }
    });
  }

  /**
   * 添加黑名单
   */
  private async handleAdd(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定要添加的代币符号\n用法: /blacklist add <symbol> [reason]',
        shouldReply: true
      };
    }

    const symbol = this.normalizeSymbol(args[0]);
    const reason = args.slice(1).join(' ') || undefined;

    if (!this.isValidSymbol(symbol)) {
      return {
        success: false,
        message: `❌ 无效的代币符号: ${symbol}`,
        shouldReply: true
      };
    }

    try {
      const result = await this.filterManager.addUserBlacklist(userId, symbol, reason);

      return {
        success: result.success,
        message: result.message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to add blacklist', { userId, symbol, error });
      return {
        success: false,
        message: '❌ 添加黑名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 移除黑名单
   */
  private async handleRemove(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定要移除的代币符号\n用法: /blacklist remove <symbol>',
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
      const result = await this.filterManager.removeUserBlacklist(userId, symbol);

      return {
        success: result.success,
        message: result.message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to remove blacklist', { userId, symbol, error });
      return {
        success: false,
        message: '❌ 移除黑名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 显示黑名单列表
   */
  private async handleList(userId: string): Promise<CommandResult> {
    try {
      const summary = await this.filterManager.getFilterSummary(userId);
      const blacklist = await this.userFilterService.getBlacklist(userId);
      const muteList = await this.userFilterService.getMuteList(userId);
      const systemFilters = await this.filterManager.getSystemFilters();

      let message = '📋 **过滤规则状态**\n\n';

      // 系统级过滤
      message += '🚫 **系统级过滤 (不可修改):**\n';
      if (systemFilters.delisted.length > 0) {
        message += `   • 已下架代币: ${systemFilters.delisted.join(', ')}\n`;
      } else {
        message += `   • 已下架代币: 无\n`;
      }
      if (systemFilters.blacklist.length > 0) {
        message += `   • 风险代币: ${systemFilters.blacklist.join(', ')}\n`;
      } else {
        message += `   • 风险代币: 无\n`;
      }
      if (systemFilters.yellowlist.length > 0) {
        message += `   • 警告代币: ${systemFilters.yellowlist.join(', ')}\n\n`;
      } else {
        message += `   • 警告代币: 无\n\n`;
      }

      // 个人黑名单
      if (blacklist.length > 0) {
        message += '🔒 **个人黑名单:**\n';
        blacklist.forEach((rule, index) => {
          const reason = rule.reason ? ` (${rule.reason})` : '';
          message += `   ${index + 1}. ${rule.symbol}${reason}\n`;
        });
        message += '\n';
      } else {
        message += '🔒 **个人黑名单:** 空\n\n';
      }

      // 临时屏蔽
      if (muteList.length > 0) {
        message += '🔇 **临时屏蔽:**\n';
        muteList.forEach((rule, index) => {
          const reason = rule.reason ? ` (${rule.reason})` : '';
          message += `   ${index + 1}. ${rule.symbol} - ${rule.remaining_time}${reason}\n`;
        });
        message += '\n';
      } else {
        message += '🔇 **临时屏蔽:** 空\n\n';
      }

      // 统计信息
      message += '📊 **统计:**\n';
      message += `   • 总过滤规则: ${summary.totalFiltered}个\n`;
      message += `   • 系统保护: ${summary.systemFilters.delisted + summary.systemFilters.blacklist}个\n`;
      message += `   • 个人设置: ${summary.userFilters.blacklist + summary.userFilters.mute}个`;

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to get blacklist', { userId, error });
      return {
        success: false,
        message: '❌ 获取黑名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 清空个人黑名单
   */
  private async handleClear(userId: string): Promise<CommandResult> {
    try {
      const count = await this.userFilterService.clearAll(userId, 'blacklist');

      if (count === 0) {
        return {
          success: true,
          message: '✅ 个人黑名单已经是空的',
          shouldReply: true
        };
      }

      return {
        success: true,
        message: `✅ 已清空个人黑名单 (${count}个代币)`,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to clear blacklist', { userId, error });
      return {
        success: false,
        message: '❌ 清空黑名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 显示系统过滤列表
   */
  private async handleSystemList(): Promise<CommandResult> {
    try {
      const systemFilters = await this.filterManager.getSystemFilters();

      let message = '🏛️ **系统级过滤规则**\n\n';

      // 下架代币
      message += '🚫 **已下架代币 (不可交易):**\n';
      if (systemFilters.delisted.length > 0) {
        message += `   ${systemFilters.delisted.join(', ')}\n\n`;
      } else {
        message += '   无\n\n';
      }

      // 风险代币
      message += '⛔ **风险代币 (建议避免):**\n';
      if (systemFilters.blacklist.length > 0) {
        message += `   ${systemFilters.blacklist.join(', ')}\n\n`;
      } else {
        message += '   无\n\n';
      }

      // 警告代币
      message += '⚠️ **警告代币 (谨慎交易):**\n';
      if (systemFilters.yellowlist.length > 0) {
        message += `   ${systemFilters.yellowlist.join(', ')}\n\n`;
      } else {
        message += '   无\n\n';
      }

      message += '💡 **说明:**\n';
      message += '• 下架和风险代币的过滤无法移除\n';
      message += '• 警告代币可通过个人黑名单进一步屏蔽\n';
      message += '• 使用 /blacklist add <symbol> 添加个人黑名单';

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to get system filters', { error });
      return {
        success: false,
        message: '❌ 获取系统过滤规则失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 显示使用说明
   */
  private showUsage(): CommandResult {
    const message = `📋 **黑名单管理命令**

**基本用法:**
• \`/blacklist add <symbol> [reason]\` - 添加黑名单
• \`/blacklist remove <symbol>\` - 移除黑名单
• \`/blacklist list\` - 查看所有过滤规则
• \`/blacklist clear\` - 清空个人黑名单
• \`/blacklist system\` - 查看系统过滤规则

**示例:**
• \`/blacklist add SHIB 垃圾币\`
• \`/blacklist remove DOGE\`
• \`/blacklist list\`

**说明:**
• 个人黑名单永久生效，直到手动移除
• 系统级过滤规则无法覆盖
• 临时屏蔽请使用 /mute 命令`;

    return {
      success: true,
      message,
      shouldReply: true
    };
  }
}