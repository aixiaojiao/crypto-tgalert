import { Telegraf, Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { BotContext } from '../ICommandHandler';
import { log } from '../../../utils/logger';
import { FundingAlertModel } from '../../../models/fundingAlertModel';
import { PotentialAlertModel } from '../../../models/potentialAlertModel';
import { esp32NotificationService } from '../../esp32';
import { IUserFilterService, FilterRule } from '../../filters/UserFilterService';
import { IAdvancedFilterManager } from '../../filters/AdvancedFilterManager';
import { fundingAlertService } from '../../fundingAlertService';
import { potentialAlertService } from '../../potentialAlertService';

/**
 * Inline keyboard 菜单
 *
 * 增量式 UI：只新增 /menu 命令和回调处理，不修改任何已有命令。
 *
 * 菜单层级：
 *   home       → 开关三项 + 入口按钮
 *     status   → 系统状态子页（只读）
 *     filter   → 过滤器总览子页
 *     bl       → 用户黑名单列表 + 逐行移除
 *     yl       → 用户黄名单列表 + 逐行移除
 *     mu       → 用户屏蔽列表 + 逐行移除
 *
 * 输入数值/新增条目仍走原有斜杠命令（/black, /yellow, /mute, /filter_volume ...）。
 */
export class MenuCommandHandler {
  // 回调前缀
  private static readonly PREFIX = 'menu:';
  // 每页最多展示的列表条目（避免 Telegram inline keyboard 超出限制）
  private static readonly LIST_LIMIT = 20;

  constructor(
    private readonly userFilterService: IUserFilterService,
    private readonly filterManager: IAdvancedFilterManager,
  ) {}

  register(bot: Telegraf<BotContext>): void {
    bot.command('menu', async (ctx) => {
      try {
        const userId = String(ctx.from?.id ?? '');
        const view = await this.renderHome(userId);
        await ctx.reply(view.text, { parse_mode: 'Markdown', reply_markup: view.keyboard });
      } catch (error) {
        log.error('menu command failed', error);
        await ctx.reply('❌ 打开菜单失败');
      }
    });

    // 统一路由所有 menu:* 回调
    bot.action(/^menu:.+$/, async (ctx) => {
      const data = (ctx.callbackQuery as any)?.data as string | undefined;
      if (!data) {
        await ctx.answerCbQuery();
        return;
      }
      const userId = String(ctx.from?.id ?? '');
      try {
        await this.routeCallback(ctx, data, userId);
      } catch (error) {
        log.error('menu callback failed', { data, error });
        await ctx.answerCbQuery('❌ 操作失败').catch(() => {});
      }
    });
  }

  // ─────────── Callback 路由 ───────────

  private async routeCallback(ctx: BotContext, data: string, userId: string): Promise<void> {
    const rest = data.slice(MenuCommandHandler.PREFIX.length); // strip "menu:"

    // nav:<page>
    if (rest.startsWith('nav:')) {
      const page = rest.slice('nav:'.length);
      await ctx.answerCbQuery();
      await this.navigateTo(ctx, page, userId);
      return;
    }

    // toggle:<service>
    if (rest.startsWith('toggle:')) {
      const svc = rest.slice('toggle:'.length);
      const label = await this.applyToggle(svc);
      await ctx.answerCbQuery(label);
      await this.rerender(ctx, 'home', userId);
      return;
    }

    // rm:<type>:<symbol>
    if (rest.startsWith('rm:')) {
      const [type, symbol] = rest.slice('rm:'.length).split(':');
      if (!type || !symbol) {
        await ctx.answerCbQuery('❌ 参数错误');
        return;
      }
      const ok = await this.applyRemove(type, userId, symbol);
      await ctx.answerCbQuery(ok ? `🗑 已移除 ${symbol}` : '❌ 移除失败');
      // 停留在当前列表页
      await this.rerender(ctx, type, userId);
      return;
    }

    // refresh / close（保留首版兼容）
    if (rest === 'refresh') {
      await ctx.answerCbQuery('🔄 已刷新');
      await this.rerender(ctx, 'home', userId);
      return;
    }
    if (rest === 'close') {
      await ctx.answerCbQuery('已关闭');
      await ctx.deleteMessage().catch(() => {});
      return;
    }

    await ctx.answerCbQuery();
  }

  private async navigateTo(ctx: BotContext, page: string, userId: string): Promise<void> {
    await this.rerender(ctx, page, userId);
  }

  private async rerender(ctx: BotContext, page: string, userId: string): Promise<void> {
    const view = await this.buildView(page, userId);
    try {
      await ctx.editMessageText(view.text, {
        parse_mode: 'Markdown',
        reply_markup: view.keyboard,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('message is not modified')) {
        log.warn('menu rerender edit failed', { page, err: msg });
      }
    }
  }

  private async buildView(page: string, userId: string): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
    switch (page) {
      case 'status':
        return this.renderStatus();
      case 'filter':
        return this.renderFilter(userId);
      case 'bl':
        return this.renderList(userId, 'bl');
      case 'yl':
        return this.renderList(userId, 'yl');
      case 'mu':
        return this.renderList(userId, 'mu');
      case 'home':
      default:
        return this.renderHome(userId);
    }
  }

  // ─────────── Toggle 实现 ───────────

  private async applyToggle(svc: string): Promise<string> {
    if (svc === 'funding') {
      const next = !FundingAlertModel.isEnabled();
      FundingAlertModel.setEnabled(next);
      log.info(`menu: funding alert ${next ? 'enabled' : 'disabled'}`);
      return next ? '✅ 已开启' : '🛑 已关闭';
    }
    if (svc === 'potential') {
      const next = !PotentialAlertModel.isEnabled();
      PotentialAlertModel.setEnabled(next);
      log.info(`menu: potential alert ${next ? 'enabled' : 'disabled'}`);
      return next ? '✅ 已开启' : '🛑 已关闭';
    }
    if (svc === 'esp32') {
      await esp32NotificationService.ensureRow();
      const cfg = await esp32NotificationService.getConfig();
      const next = !cfg.enabled;
      await esp32NotificationService.setEnabled(next);
      log.info(`menu: esp32 ${next ? 'enabled' : 'disabled'}`);
      return next ? '✅ 已开启' : '🛑 已关闭';
    }
    return '❓ 未知开关';
  }

  // ─────────── 列表移除 ───────────

  private async applyRemove(type: string, userId: string, symbol: string): Promise<boolean> {
    try {
      if (type === 'bl') {
        await this.userFilterService.removeBlacklist(userId, symbol);
        return true;
      }
      if (type === 'yl') {
        await this.userFilterService.removeYellowlist(userId, symbol);
        return true;
      }
      if (type === 'mu') {
        await this.userFilterService.removeMute(userId, symbol);
        return true;
      }
    } catch (error) {
      log.error('menu remove failed', { type, userId, symbol, error });
    }
    return false;
  }

  // ─────────── 各页面渲染 ───────────

  private async renderHome(userId: string): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
    const fundingOn = FundingAlertModel.isEnabled();
    const potentialOn = PotentialAlertModel.isEnabled();
    let esp32On = false;
    try {
      await esp32NotificationService.ensureRow();
      esp32On = (await esp32NotificationService.getConfig()).enabled;
    } catch (error) {
      log.warn('menu home: failed to read esp32 config', error);
    }

    const badge = (on: boolean) => (on ? '✅ 开启' : '❌ 关闭');
    const flip = (on: boolean) => (on ? '关闭' : '开启');

    const text =
      `📋 *快捷菜单*\n` +
      `━━━━━━━━━━━━\n` +
      `🔔 负费率报警: ${badge(fundingOn)}\n` +
      `🎯 潜力币信号: ${badge(potentialOn)}\n` +
      `🔊 ESP32 语音: ${badge(esp32On)}\n` +
      `━━━━━━━━━━━━\n` +
      `点击切换开关；输入阈值/新增条目请继续用斜杠命令（/help）。\n` +
      `用户: \`${userId || '未知'}\``;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`🔔 ${flip(fundingOn)}负费率报警`, `${MenuCommandHandler.PREFIX}toggle:funding`)],
      [Markup.button.callback(`🎯 ${flip(potentialOn)}潜力币信号`, `${MenuCommandHandler.PREFIX}toggle:potential`)],
      [Markup.button.callback(`🔊 ${flip(esp32On)}ESP32 语音`, `${MenuCommandHandler.PREFIX}toggle:esp32`)],
      [
        Markup.button.callback('📊 系统状态', `${MenuCommandHandler.PREFIX}nav:status`),
        Markup.button.callback('🛡 过滤器', `${MenuCommandHandler.PREFIX}nav:filter`),
      ],
      [
        Markup.button.callback('🚫 黑名单', `${MenuCommandHandler.PREFIX}nav:bl`),
        Markup.button.callback('⚠ 黄名单', `${MenuCommandHandler.PREFIX}nav:yl`),
        Markup.button.callback('🔇 屏蔽', `${MenuCommandHandler.PREFIX}nav:mu`),
      ],
      [
        Markup.button.callback('🔄 刷新', `${MenuCommandHandler.PREFIX}refresh`),
        Markup.button.callback('❌ 关闭', `${MenuCommandHandler.PREFIX}close`),
      ],
    ]).reply_markup;

    return { text, keyboard };
  }

  private async renderStatus(): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
    // funding
    const fs = fundingAlertService.getStatus();
    const fundingLines = [
      `🔔 *负费率报警*`,
      `  状态: ${fs.enabled ? '✅ 开启' : '❌ 关闭'} / ${fs.running ? '运行中' : '未运行'}${fs.scanning ? ' / 扫描中' : ''}`,
      `  扫描间隔: ${fs.intervalMin} 分钟`,
      `  今日触发: ${fs.todayStats.total} 次`,
    ];
    if (fs.todayStats.total > 0) {
      for (const [type, cnt] of Object.entries(fs.todayStats.byType)) {
        fundingLines.push(`    · ${type}: ${cnt}`);
      }
    }

    // potential
    const ps = potentialAlertService.getStatus();
    const potentialLines = [
      ``,
      `🎯 *潜力币信号*`,
      `  状态: ${ps.enabled ? '✅ 开启' : '❌ 关闭'} / ${ps.running ? '运行中' : '未运行'}${ps.scanning ? ' / 扫描中' : ''}`,
    ];
    if ((ps as any).intervalMin !== undefined) {
      potentialLines.push(`  扫描间隔: ${(ps as any).intervalMin} 分钟`);
    }

    // esp32
    let esp32Lines: string[] = ['', '🔊 *ESP32 语音*'];
    try {
      await esp32NotificationService.ensureRow();
      const cfg = await esp32NotificationService.getConfig();
      esp32Lines.push(`  状态: ${cfg.enabled ? '✅ 开启' : '❌ 关闭'}`);
      if (Array.isArray(cfg.enabledTypes) && cfg.enabledTypes.length > 0) {
        esp32Lines.push(`  允许类型: ${cfg.enabledTypes.join(', ')}`);
      }
      if (cfg.cooldownSeconds !== undefined) {
        esp32Lines.push(`  冷却: ${cfg.cooldownSeconds}s`);
      }
      if (cfg.quietStart && cfg.quietEnd) {
        esp32Lines.push(`  静音时段: ${cfg.quietStart} - ${cfg.quietEnd}`);
      }
    } catch {
      esp32Lines.push(`  状态: ⚠ 无法读取`);
    }

    const text =
      `📊 *系统状态*\n━━━━━━━━━━━━\n` +
      [...fundingLines, ...potentialLines, ...esp32Lines].join('\n');

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🔄 刷新', `${MenuCommandHandler.PREFIX}nav:status`),
        Markup.button.callback('⬅ 返回', `${MenuCommandHandler.PREFIX}nav:home`),
      ],
    ]).reply_markup;

    return { text, keyboard };
  }

  private async renderFilter(userId: string): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
    let summaryText: string;
    try {
      const s = await this.filterManager.getFilterSummary(userId);
      summaryText =
        `*用户自定义过滤*\n` +
        `  🚫 黑名单: ${s.userFilters.blacklist}\n` +
        `  ⚠ 黄名单: ${s.userFilters.yellowlist}\n` +
        `  🔇 屏蔽: ${s.userFilters.mute}\n` +
        `\n*系统级过滤*\n` +
        `  已下架: ${s.systemFilters.delisted}\n` +
        `  系统黑名单: ${s.systemFilters.blacklist}\n` +
        `  系统黄名单: ${s.systemFilters.yellowlist}\n` +
        `\n📉 总过滤次数: ${s.totalFiltered}\n` +
        `🕐 近期过滤: ${s.recentlyFiltered}`;
    } catch (error) {
      log.warn('menu filter: summary failed', error);
      summaryText = '⚠ 无法读取过滤器汇总';
    }

    const text =
      `🛡 *过滤器*\n━━━━━━━━━━━━\n${summaryText}\n\n` +
      `_新增条目请用命令：/black <sym> | /yellow <sym> | /mute <sym> <时长>_\n` +
      `_调整阈值：/filter_volume <USDT金额>_`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🚫 黑名单列表', `${MenuCommandHandler.PREFIX}nav:bl`),
        Markup.button.callback('⚠ 黄名单列表', `${MenuCommandHandler.PREFIX}nav:yl`),
      ],
      [Markup.button.callback('🔇 屏蔽列表', `${MenuCommandHandler.PREFIX}nav:mu`)],
      [
        Markup.button.callback('🔄 刷新', `${MenuCommandHandler.PREFIX}nav:filter`),
        Markup.button.callback('⬅ 返回', `${MenuCommandHandler.PREFIX}nav:home`),
      ],
    ]).reply_markup;

    return { text, keyboard };
  }

  private async renderList(userId: string, type: 'bl' | 'yl' | 'mu'): Promise<{ text: string; keyboard: InlineKeyboardMarkup }> {
    const meta = this.listMeta(type);

    let rules: FilterRule[] = [];
    try {
      rules = await meta.fetch(this.userFilterService, userId);
    } catch (error) {
      log.error('menu list fetch failed', { type, error });
    }

    const shown = rules.slice(0, MenuCommandHandler.LIST_LIMIT);
    const lines: string[] = [`${meta.icon} *${meta.title}* (${rules.length})`, `━━━━━━━━━━━━`];
    if (rules.length === 0) {
      lines.push('_列表为空_');
    } else {
      for (let i = 0; i < shown.length; i++) {
        const r = shown[i];
        const reason = r.reason ? ` — ${r.reason}` : '';
        const remaining = r.remaining_time ? `  ⏳ ${r.remaining_time}` : '';
        lines.push(`${i + 1}. \`${r.symbol}\`${reason}${remaining}`);
      }
      if (rules.length > shown.length) {
        lines.push(`_…只显示前 ${MenuCommandHandler.LIST_LIMIT} 条，其余请用 /${meta.listCmd} 查看_`);
      }
    }

    const text = lines.join('\n');

    // 每行放 2 个移除按钮
    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (let i = 0; i < shown.length; i += 2) {
      const row: ReturnType<typeof Markup.button.callback>[] = [];
      for (const r of shown.slice(i, i + 2)) {
        const cbData = `${MenuCommandHandler.PREFIX}rm:${type}:${r.symbol}`;
        // callback_data 最长 64 bytes；symbol 太长时只能用斜杠命令移除
        if (cbData.length <= 64) {
          row.push(Markup.button.callback(`🗑 ${r.symbol}`, cbData));
        }
      }
      if (row.length > 0) rows.push(row);
    }
    rows.push([
      Markup.button.callback('🔄 刷新', `${MenuCommandHandler.PREFIX}nav:${type}`),
      Markup.button.callback('⬅ 返回', `${MenuCommandHandler.PREFIX}nav:home`),
    ]);

    return { text, keyboard: Markup.inlineKeyboard(rows).reply_markup };
  }

  private listMeta(type: 'bl' | 'yl' | 'mu') {
    if (type === 'bl') {
      return {
        title: '黑名单',
        icon: '🚫',
        listCmd: 'black_list',
        fetch: (svc: IUserFilterService, uid: string) => svc.getBlacklist(uid),
      };
    }
    if (type === 'yl') {
      return {
        title: '黄名单',
        icon: '⚠',
        listCmd: 'yellow_list',
        fetch: (svc: IUserFilterService, uid: string) => svc.getYellowlist(uid),
      };
    }
    return {
      title: '屏蔽列表',
      icon: '🔇',
      listCmd: 'mute_list',
      fetch: (svc: IUserFilterService, uid: string) => svc.getMuteList(uid),
    };
  }
}
