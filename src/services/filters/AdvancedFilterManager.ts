/**
 * 高级过滤管理器
 * 统一管理系统级过滤和用户级过滤
 */

import { injectable, inject } from 'inversify';
import { IUserFilterService } from './UserFilterService';
import { SERVICE_IDENTIFIERS } from '../../core/container/decorators';
import {
  DELISTED_TOKENS,
  BLACKLIST_TOKENS,
  YELLOWLIST_TOKENS,
  isTokenInList
} from '../../config/tokenLists';
import { log } from '../../utils/logger';
import { recordBusinessOperation } from '../../utils/businessMonitor';

export interface FilterResult {
  allowed: boolean;
  reason: string;
  source: 'system_delisted' | 'system_blacklist' | 'system_yellowlist' | 'user_blacklist' | 'user_mute';
  priority: number;
  canOverride: boolean;
}

export interface FilterSummary {
  systemFilters: {
    delisted: number;
    blacklist: number;
    yellowlist: number;
  };
  userFilters: {
    blacklist: number;
    mute: number;
  };
  totalFiltered: number;
  recentlyFiltered: number;
}

export interface SystemFilters {
  delisted: string[];
  blacklist: string[];
  yellowlist: string[];
}

enum FilterPriority {
  SYSTEM_DELISTED = 1,    // 🚫 系统下架 - 不可覆盖
  SYSTEM_BLACKLIST = 2,   // ⛔ 系统风险 - 不可覆盖
  USER_BLACKLIST = 3,     // 🔒 用户永久屏蔽
  USER_MUTE = 4,          // 🔇 用户临时屏蔽
  SYSTEM_YELLOWLIST = 5,  // ⚠️ 系统警告 - 可用户屏蔽
}

export interface IAdvancedFilterManager {
  // 统一过滤检查
  checkFilter(userId: string, symbol: string): Promise<FilterResult>;

  // 用户操作 (安全检查)
  addUserBlacklist(userId: string, symbol: string, reason?: string): Promise<{success: boolean, message: string}>;
  removeUserBlacklist(userId: string, symbol: string): Promise<{success: boolean, message: string}>;

  // 查询功能
  getFilterSummary(userId: string): Promise<FilterSummary>;
  getSystemFilters(): Promise<SystemFilters>;

  // 批量过滤
  filterSymbolList(userId: string, symbols: string[]): Promise<string[]>;

  // 过滤统计
  shouldSendAlert(userId: string, symbol: string, alertType: string): Promise<boolean>;

  // 过滤报告
  generateFilterReport(userId: string): Promise<string>;
}

@injectable()
export class AdvancedFilterManager implements IAdvancedFilterManager {

  constructor(
    @inject(SERVICE_IDENTIFIERS.USER_FILTER_SERVICE)
    private userFilterService: IUserFilterService
  ) {}

  /**
   * 统一过滤检查 - 核心方法
   */
  async checkFilter(userId: string, symbol: string): Promise<FilterResult> {
    // 首先标准化symbol格式
    const normalizedSymbol = this.normalizeSymbolForFiltering(symbol);
    const cleanSymbol = normalizedSymbol.replace(/(USDT|BUSD)$/i, '').toUpperCase();

    // 优先级1: 系统下架代币 (不可覆盖)
    if (isTokenInList(cleanSymbol, DELISTED_TOKENS)) {
      return {
        allowed: false,
        reason: '🚫 代币已下架，无法交易',
        source: 'system_delisted',
        priority: FilterPriority.SYSTEM_DELISTED,
        canOverride: false
      };
    }

    // 优先级2: 系统风险代币 (不可覆盖)
    if (isTokenInList(cleanSymbol, BLACKLIST_TOKENS)) {
      return {
        allowed: false,
        reason: '⛔ 系统风险代币，建议避免',
        source: 'system_blacklist',
        priority: FilterPriority.SYSTEM_BLACKLIST,
        canOverride: false
      };
    }

    try {
      // 优先级3: 用户黑名单 (使用标准化的symbol)
      const userBlacklisted = await this.userFilterService.isBlacklisted(userId, normalizedSymbol);
      if (userBlacklisted) {
        const reason = await this.userFilterService.getFilterReason(userId, normalizedSymbol);
        return {
          allowed: false,
          reason: reason || '🔒 个人黑名单',
          source: 'user_blacklist',
          priority: FilterPriority.USER_BLACKLIST,
          canOverride: true
        };
      }

      // 优先级4: 用户临时屏蔽 (使用标准化的symbol)
      const muteResult = await this.userFilterService.isMuted(userId, normalizedSymbol);
      if (muteResult.muted) {
        return {
          allowed: false,
          reason: `🔇 临时屏蔽 (${muteResult.remainingTime})`,
          source: 'user_mute',
          priority: FilterPriority.USER_MUTE,
          canOverride: true
        };
      }

    } catch (error) {
      log.error('Error checking user filters', { userId, originalSymbol: symbol, normalizedSymbol, error });
      // 继续检查系统过滤，不因用户过滤错误而中断
    }

    // 优先级5: 系统黄名单 (可被用户管理覆盖)
    if (isTokenInList(cleanSymbol, YELLOWLIST_TOKENS)) {
      return {
        allowed: false,
        reason: '⚠️ 系统警告代币，谨慎交易',
        source: 'system_yellowlist',
        priority: FilterPriority.SYSTEM_YELLOWLIST,
        canOverride: true
      };
    }

    // 通过所有过滤检查
    return {
      allowed: true,
      reason: '',
      source: 'system_delisted', // 占位符
      priority: 999,
      canOverride: false
    };
  }

  /**
   * 安全的用户黑名单添加
   */
  async addUserBlacklist(userId: string, symbol: string, reason?: string): Promise<{success: boolean, message: string}> {
    try {
      const filterResult = await this.checkFilter(userId, symbol);

      // 检查是否为系统不可覆盖的代币
      if (!filterResult.allowed && !filterResult.canOverride) {
        return {
          success: false,
          message: `❌ 无法添加 ${symbol}：${filterResult.reason.replace(/^[🚫⛔⚠️🔒🔇]\s*/, '')}`
        };
      }

      await this.userFilterService.addBlacklist(userId, symbol, reason);

      // 如果原本是黄名单，给出特殊提示
      if (filterResult.source === 'system_yellowlist') {
        return {
          success: true,
          message: `✅ 已将 ${symbol} 添加到个人黑名单\n   原状态：⚠️ 系统黄名单 → 🔒 个人黑名单`
        };
      }

      return {
        success: true,
        message: `✅ 已将 ${symbol} 添加到个人黑名单`
      };

    } catch (error) {
      log.error('Failed to add user blacklist', { userId, symbol, error });
      return {
        success: false,
        message: `❌ 添加失败：${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 安全的用户黑名单移除
   */
  async removeUserBlacklist(userId: string, symbol: string): Promise<{success: boolean, message: string}> {
    try {
      const isBlacklisted = await this.userFilterService.isBlacklisted(userId, symbol);

      if (!isBlacklisted) {
        return {
          success: false,
          message: `❌ ${symbol} 不在个人黑名单中`
        };
      }

      await this.userFilterService.removeBlacklist(userId, symbol);

      // 检查移除后是否还有系统级过滤
      const filterResult = await this.checkFilter(userId, symbol);
      if (!filterResult.allowed) {
        return {
          success: true,
          message: `✅ 已将 ${symbol} 从个人黑名单移除\n   注意：该代币仍受系统过滤 (${filterResult.reason})`
        };
      }

      return {
        success: true,
        message: `✅ 已将 ${symbol} 从个人黑名单移除`
      };

    } catch (error) {
      log.error('Failed to remove user blacklist', { userId, symbol, error });
      return {
        success: false,
        message: `❌ 移除失败：${error instanceof Error ? error.message : '未知错误'}`
      };
    }
  }

  /**
   * 获取过滤汇总
   */
  async getFilterSummary(userId: string): Promise<FilterSummary> {
    try {
      const userStats = await this.userFilterService.getFilterStats(userId);

      return {
        systemFilters: {
          delisted: DELISTED_TOKENS.length,
          blacklist: BLACKLIST_TOKENS.length,
          yellowlist: YELLOWLIST_TOKENS.length
        },
        userFilters: {
          blacklist: userStats.blacklistCount,
          mute: userStats.muteCount
        },
        totalFiltered: DELISTED_TOKENS.length + BLACKLIST_TOKENS.length + userStats.totalFiltered,
        recentlyFiltered: userStats.expiringSoon.length
      };

    } catch (error) {
      log.error('Failed to get filter summary', { userId, error });
      throw error;
    }
  }

  /**
   * 获取系统过滤规则
   */
  async getSystemFilters(): Promise<SystemFilters> {
    return {
      delisted: [...DELISTED_TOKENS],
      blacklist: [...BLACKLIST_TOKENS],
      yellowlist: [...YELLOWLIST_TOKENS]
    };
  }

  /**
   * 批量过滤符号列表
   */
  async filterSymbolList(userId: string, symbols: string[]): Promise<string[]> {
    const allowedSymbols: string[] = [];

    for (const symbol of symbols) {
      try {
        const filterResult = await this.checkFilter(userId, symbol);
        if (filterResult.allowed) {
          allowedSymbols.push(symbol);
        }
      } catch (error) {
        log.error('Error filtering symbol', { userId, symbol, error });
        // 发生错误时保守处理，不包含该符号
      }
    }

    return allowedSymbols;
  }

  /**
   * 检查是否应该发送警报
   */
  async shouldSendAlert(userId: string, symbol: string, alertType: string): Promise<boolean> {
    try {
      // 标准化symbol格式以确保与存储的格式一致
      const normalizedSymbol = this.normalizeSymbolForFiltering(symbol);
      const filterResult = await this.checkFilter(userId, normalizedSymbol);

      if (filterResult.allowed) {
        recordBusinessOperation('filter_check', true, {
          userId,
          symbol: normalizedSymbol,
          alertType,
          result: 'allowed'
        });
        return true;
      }

      // 记录过滤日志和业务监控
      log.debug('Alert filtered', {
        userId,
        originalSymbol: symbol,
        normalizedSymbol,
        alertType,
        reason: filterResult.reason,
        source: filterResult.source
      });

      recordBusinessOperation('filter_check', true, {
        userId,
        symbol: normalizedSymbol,
        alertType,
        result: 'filtered',
        reason: filterResult.reason,
        source: filterResult.source
      });

      return false;

    } catch (error) {
      log.error('Error checking alert filter', { userId, symbol, alertType, error });

      recordBusinessOperation('filter_check', false, {
        userId,
        symbol,
        alertType
      }, error instanceof Error ? error.message : String(error));

      // 发生错误时采用保守策略：不发送警报
      return false;
    }
  }

  /**
   * 标准化symbol格式以确保过滤检查的一致性
   * 处理不同的symbol输入格式 (如 "BULLA/USDT", "BULLA", "bulla" 等)
   */
  private normalizeSymbolForFiltering(symbol: string): string {
    // 移除常见的分隔符和空格
    let normalized = symbol.replace(/[\/\-_\s]/g, '').toUpperCase();

    // 如果没有USDT或USD后缀，自动添加USDT
    if (!normalized.endsWith('USDT') && !normalized.endsWith('USD')) {
      normalized += 'USDT';
    }

    return normalized;
  }

  /**
   * 生成过滤状态报告 (用于调试和用户查看)
   */
  async generateFilterReport(userId: string): Promise<string> {
    try {
      const summary = await this.getFilterSummary(userId);
      const userStats = await this.userFilterService.getFilterStats(userId);

      let report = '📊 **过滤规则状态报告**\n\n';

      // 系统级过滤
      report += '🚫 **系统级过滤 (不可修改):**\n';
      report += `   • 已下架代币: ${summary.systemFilters.delisted}个\n`;
      report += `   • 风险代币: ${summary.systemFilters.blacklist}个\n`;
      report += `   • 警告代币: ${summary.systemFilters.yellowlist}个\n\n`;

      // 用户级过滤
      report += '🔒 **个人过滤:**\n';
      report += `   • 永久黑名单: ${summary.userFilters.blacklist}个\n`;
      report += `   • 临时屏蔽: ${summary.userFilters.mute}个\n\n`;

      // 即将过期的屏蔽
      if (userStats.expiringSoon.length > 0) {
        report += '⏰ **即将过期的屏蔽:**\n';
        for (const rule of userStats.expiringSoon) {
          report += `   • ${rule.symbol} (${rule.remaining_time})\n`;
        }
        report += '\n';
      }

      // 总体统计
      report += '📈 **总体统计:**\n';
      report += `   • 总过滤规则: ${summary.totalFiltered}个\n`;
      report += `   • 系统保护: ${summary.systemFilters.delisted + summary.systemFilters.blacklist}个\n`;
      report += `   • 用户自定义: ${summary.userFilters.blacklist + summary.userFilters.mute}个\n`;

      return report;

    } catch (error) {
      log.error('Failed to generate filter report', { userId, error });
      return '❌ 生成过滤报告失败';
    }
  }
}