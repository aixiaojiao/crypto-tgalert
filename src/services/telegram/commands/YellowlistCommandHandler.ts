import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';
import { IAdvancedFilterManager } from '../../filters/AdvancedFilterManager';
import { IUserFilterService } from '../../filters/UserFilterService';

/**
 * 黄名单管理命令处理器
 * 支持命令: /yellowlist add|remove|list|clear|system
 */
export class YellowlistCommandHandler extends BaseCommandHandler {
  readonly command = 'yellowlist';
  readonly description = '管理个人黄名单 - /yellowlist add|remove|list|clear|system';
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
   * 添加黄名单
   */
  private async handleAdd(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定要添加的代币符号\n用法: /yellowlist add <symbol> [reason]',
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
      const result = await this.filterManager.addUserYellowlist(userId, symbol, reason);

      return {
        success: result.success,
        message: result.message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to add yellowlist', { userId, symbol, error });
      return {
        success: false,
        message: '❌ 添加黄名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 移除黄名单
   */
  private async handleRemove(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定要移除的代币符号\n用法: /yellowlist remove <symbol>',
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
      const result = await this.filterManager.removeUserYellowlist(userId, symbol);

      return {
        success: result.success,
        message: result.message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to remove yellowlist', { userId, symbol, error });
      return {
        success: false,
        message: '❌ 移除黄名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 显示黄名单列表
   */
  private async handleList(userId: string): Promise<CommandResult> {
    try {
      const summary = await this.filterManager.getFilterSummary(userId);
      const blacklist = await this.userFilterService.getBlacklist(userId);
      const muteList = await this.userFilterService.getMuteList(userId);
      const yellowlist = await this.userFilterService.getYellowlist(userId);

      let message = '📋 **过滤规则状态**\n\n';

      // 系统级过滤
      message += '🚫 **系统级过滤 (不可修改):**\n';
      message += `   • 已下架代币: ${summary.systemFilters.delisted}个\n`;
      message += `   • 风险代币: ${summary.systemFilters.blacklist}个\n`;
      message += `   • 警告代币: ${summary.systemFilters.yellowlist}个\n\n`;

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

      // 个人黄名单
      if (yellowlist.length > 0) {
        message += '⚠️ **个人黄名单:**\n';
        yellowlist.forEach((rule, index) => {
          const reason = rule.reason ? ` (${rule.reason})` : '';
          message += `   ${index + 1}. ${rule.symbol}${reason}\n`;
        });
        message += '\n';
      } else {
        message += '⚠️ **个人黄名单:** 空\n\n';
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
      message += `   • 个人设置: ${summary.userFilters.blacklist + summary.userFilters.mute + summary.userFilters.yellowlist}个`;

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to get yellowlist', { userId, error });
      return {
        success: false,
        message: '❌ 获取黄名单失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 清空个人黄名单
   */
  private async handleClear(userId: string): Promise<CommandResult> {
    try {
      const count = await this.userFilterService.clearAll(userId, 'yellowlist');

      if (count === 0) {
        return {
          success: true,
          message: '✅ 个人黄名单已经是空的',
          shouldReply: true
        };
      }

      return {
        success: true,
        message: `✅ 已清空个人黄名单 (${count}个代币)`,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to clear yellowlist', { userId, error });
      return {
        success: false,
        message: '❌ 清空黄名单失败，请稍后重试',
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
      message += '• 警告代币可通过个人黄名单添加自定义警告标记\n';
      message += '• 使用 /yellowlist add <symbol> 添加个人黄名单标记';

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
    const message = `📋 **黄名单管理命令**

**基本用法:**
• \`/yellowlist add <symbol> [reason]\` - 添加黄名单标记
• \`/yellowlist remove <symbol>\` - 移除黄名单标记
• \`/yellowlist list\` - 查看所有过滤规则
• \`/yellowlist clear\` - 清空个人黄名单
• \`/yellowlist system\` - 查看系统过滤规则

**示例:**
• \`/yellowlist add DOGE 高波动性代币\`
• \`/yellowlist remove DOGE\`
• \`/yellowlist list\`

**说明:**
• 黄名单代币仍会推送但带有警告标记
• 用于标记需要谨慎交易的代币
• 不同于黑名单，黄名单不会阻止推送
• 临时屏蔽请使用 /mute 命令`;

    return {
      success: true,
      message,
      shouldReply: true
    };
  }
}