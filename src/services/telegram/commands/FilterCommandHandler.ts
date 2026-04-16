import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';
import { IAdvancedFilterManager } from '../../filters/AdvancedFilterManager';
import { IUserFilterService } from '../../filters/UserFilterService';

/**
 * 过滤设置命令处理器
 * 支持命令: /filter settings|volume|auto|stats|report
 */
export class FilterCommandHandler extends BaseCommandHandler {
  readonly command = 'filter';
  readonly description = '过滤设置管理 - /filter settings|volume|auto|stats';
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
        case 'settings':
        case 'config':
          return this.handleSettings(userId);
        case 'volume':
          return this.handleVolume(userId, args.slice(1));
        case 'auto':
          return this.handleAuto(userId, args.slice(1));
        case 'stats':
          return this.handleStats(userId);
        case 'report':
          return this.handleReport(userId);
        case 'reset':
          return this.handleReset(userId);
        default:
          return this.showUsage();
      }
    });
  }

  /**
   * 显示当前过滤设置
   */
  private async handleSettings(userId: string): Promise<CommandResult> {
    try {
      const settings = await this.userFilterService.getSettings(userId);
      const summary = await this.filterManager.getFilterSummary(userId);

      const volumeThreshold = (settings.volume_threshold / 1000000).toFixed(0); // 转换为百万
      const autoFilterStatus = settings.enable_auto_filter ? '✅ 启用' : '❌ 禁用';

      let message = '⚙️ **过滤设置**\n\n';

      // 基本设置
      message += '**基本设置:**\n';
      message += `• 交易量阈值: ${volumeThreshold}M USDT\n`;
      message += `• 自动过滤: ${autoFilterStatus}\n\n`;

      // 过滤统计
      message += '**过滤统计:**\n';
      message += `• 系统级过滤: ${summary.systemFilters.delisted + summary.systemFilters.blacklist + summary.systemFilters.yellowlist}个\n`;
      message += `• 个人过滤: ${summary.userFilters.blacklist + summary.userFilters.mute}个\n`;
      message += `• 总过滤规则: ${summary.totalFiltered}个\n\n`;

      // 设置说明
      message += '**设置说明:**\n';
      message += '• 交易量阈值: 自动过滤低于此交易量的代币推送\n';
      message += '• 自动过滤: 启用后将自动应用交易量过滤\n\n';

      // 管理命令
      message += '**管理命令:**\n';
      message += '• `/filter volume <amount>` - 设置交易量阈值(M USDT)\n';
      message += '• `/filter auto on/off` - 启用/禁用自动过滤\n';
      message += '• `/filter stats` - 查看详细统计\n';
      message += '• `/filter report` - 生成过滤报告';

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to get filter settings', { userId, error });
      return {
        success: false,
        message: '❌ 获取过滤设置失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 设置交易量阈值
   */
  private async handleVolume(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定交易量阈值\n用法: /filter volume <amount>\n示例: /filter volume 10 (表示10M USDT)',
        shouldReply: true
      };
    }

    const volumeStr = args[0];
    const volumeNum = parseFloat(volumeStr);

    if (isNaN(volumeNum) || volumeNum < 0) {
      return {
        success: false,
        message: '❌ 无效的交易量数值，请输入大于等于0的数字',
        shouldReply: true
      };
    }

    if (volumeNum > 1000) {
      return {
        success: false,
        message: '❌ 交易量阈值不能超过1000M USDT',
        shouldReply: true
      };
    }

    try {
      const volumeThreshold = Math.floor(volumeNum * 1000000); // 转换为实际值

      await this.userFilterService.updateSettings(userId, {
        volume_threshold: volumeThreshold
      });

      const displayVolume = (volumeThreshold / 1000000).toFixed(0);
      let message = `✅ 交易量阈值已设置为 ${displayVolume}M USDT`;

      if (volumeThreshold === 0) {
        message += '\n\n💡 阈值为0表示不进行交易量过滤';
      } else {
        message += '\n\n💡 24小时交易量低于此阈值的代币推送将被过滤';
      }

      // 检查自动过滤状态
      const settings = await this.userFilterService.getSettings(userId);
      if (!settings.enable_auto_filter) {
        message += '\n\n⚠️ 自动过滤当前已禁用，使用 `/filter auto on` 启用';
      }

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to set volume threshold', { userId, volumeNum, error });
      return {
        success: false,
        message: '❌ 设置交易量阈值失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 设置自动过滤开关
   */
  private async handleAuto(userId: string, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        message: '❌ 请指定开关状态\n用法: /filter auto on|off',
        shouldReply: true
      };
    }

    const action = args[0].toLowerCase();
    let enableAutoFilter: boolean;

    switch (action) {
      case 'on':
      case 'enable':
      case 'true':
      case '1':
        enableAutoFilter = true;
        break;
      case 'off':
      case 'disable':
      case 'false':
      case '0':
        enableAutoFilter = false;
        break;
      default:
        return {
          success: false,
          message: '❌ 无效的开关状态，请使用 on 或 off',
          shouldReply: true
        };
    }

    try {
      await this.userFilterService.updateSettings(userId, {
        enable_auto_filter: enableAutoFilter
      });

      const settings = await this.userFilterService.getSettings(userId);
      const statusText = enableAutoFilter ? '启用' : '禁用';
      const statusIcon = enableAutoFilter ? '✅' : '❌';

      let message = `${statusIcon} 自动过滤已${statusText}`;

      if (enableAutoFilter) {
        const volumeThreshold = (settings.volume_threshold / 1000000).toFixed(0);
        message += `\n\n📊 当前交易量阈值: ${volumeThreshold}M USDT`;
        message += '\n💡 24小时交易量低于此阈值的代币推送将被自动过滤';

        if (settings.volume_threshold === 0) {
          message += '\n\n⚠️ 当前阈值为0，将不进行交易量过滤';
          message += '\n使用 `/filter volume <amount>` 设置有效阈值';
        }
      } else {
        message += '\n\n💡 自动过滤已禁用，仅应用手动设置的黑名单和屏蔽规则';
      }

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to set auto filter', { userId, enableAutoFilter, error });
      return {
        success: false,
        message: '❌ 设置自动过滤失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 显示详细统计
   */
  private async handleStats(userId: string): Promise<CommandResult> {
    try {
      const summary = await this.filterManager.getFilterSummary(userId);
      const userStats = await this.userFilterService.getFilterStats(userId);

      let message = '📊 **过滤统计详情**\n\n';

      // 系统级过滤详情
      message += '🏛️ **系统级过滤:**\n';
      message += `• 🚫 已下架代币: ${summary.systemFilters.delisted}个\n`;
      message += `• ⛔ 风险代币: ${summary.systemFilters.blacklist}个\n`;
      message += `• ⚠️ 警告代币: ${summary.systemFilters.yellowlist}个\n`;
      message += `• 小计: ${summary.systemFilters.delisted + summary.systemFilters.blacklist + summary.systemFilters.yellowlist}个\n\n`;

      // 用户级过滤详情
      message += '👤 **个人过滤:**\n';
      message += `• 🔒 永久黑名单: ${summary.userFilters.blacklist}个\n`;
      message += `• 🔇 临时屏蔽: ${summary.userFilters.mute}个\n`;
      message += `• 小计: ${summary.userFilters.blacklist + summary.userFilters.mute}个\n\n`;

      // 即将过期的屏蔽
      if (userStats.expiringSoon.length > 0) {
        message += '⏰ **即将过期 (24小时内):**\n';
        userStats.expiringSoon.forEach(rule => {
          message += `• ${rule.symbol} (${rule.remaining_time})\n`;
        });
        message += '\n';
      }

      // 总体效果
      message += '📈 **总体效果:**\n';
      message += `• 总过滤规则: ${summary.totalFiltered}个\n`;
      message += `• 过滤覆盖率: ${summary.totalFiltered > 0 ? '有效' : '基础'}保护\n`;

      // 建议
      if (summary.userFilters.blacklist + summary.userFilters.mute === 0) {
        message += '\n💡 **建议:** 使用 /black 或 /mute 命令自定义过滤规则';
      } else if (userStats.expiringSoon.length > 0) {
        message += '\n💡 **提醒:** 有临时屏蔽即将过期，请检查是否需要续期';
      }

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to get filter stats', { userId, error });
      return {
        success: false,
        message: '❌ 获取过滤统计失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 生成详细过滤报告
   */
  private async handleReport(userId: string): Promise<CommandResult> {
    try {
      const report = await this.filterManager.generateFilterReport(userId);

      return {
        success: true,
        message: report,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to generate filter report', { userId, error });
      return {
        success: false,
        message: '❌ 生成过滤报告失败，请稍后重试',
        shouldReply: true
      };
    }
  }

  /**
   * 重置所有过滤设置
   */
  private async handleReset(userId: string): Promise<CommandResult> {
    try {
      // 重置用户设置为默认值
      await this.userFilterService.updateSettings(userId, {
        volume_threshold: 10000000, // 10M USDT
        enable_auto_filter: false
      });

      let message = '✅ 过滤设置已重置为默认值\n\n';
      message += '**默认设置:**\n';
      message += '• 交易量阈值: 10M USDT\n';
      message += '• 自动过滤: 禁用\n\n';
      message += '💡 个人黑名单和临时屏蔽不受影响\n';
      message += '使用 `/filter settings` 查看当前设置';

      return {
        success: true,
        message,
        shouldReply: true
      };
    } catch (error) {
      this.logger.error('Failed to reset filter settings', { userId, error });
      return {
        success: false,
        message: '❌ 重置过滤设置失败，请稍后重试',
        shouldReply: true
      };
    }
  }


  /**
   * 显示使用说明
   */
  private showUsage(): CommandResult {
    const message = `⚙️ **过滤设置命令**

**基本用法:**
• \`/filter settings\` - 查看当前设置
• \`/filter volume <amount>\` - 设置交易量阈值(M USDT)
• \`/filter auto on/off\` - 启用/禁用自动过滤
• \`/filter stats\` - 查看详细统计
• \`/filter report\` - 生成过滤报告
• \`/filter reset\` - 重置为默认设置

**示例:**
• \`/filter volume 5\` - 设置5M USDT阈值
• \`/filter auto on\` - 启用自动过滤
• \`/filter stats\` - 查看统计

**说明:**
• 交易量阈值用于自动过滤低流动性代币
• 自动过滤启用后会应用交易量阈值
• 个人黑名单和临时屏蔽独立生效
• 系统级过滤规则始终生效且不可修改

💡 **相关命令:**
• \`/black\` - 管理永久黑名单
• \`/yellow\` - 管理黄名单
• \`/mute\` - 管理临时屏蔽`;

    return {
      success: true,
      message,
      shouldReply: true
    };
  }
}