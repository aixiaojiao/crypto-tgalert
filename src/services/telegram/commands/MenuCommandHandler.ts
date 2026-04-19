import { Telegraf, Markup } from 'telegraf';
import { BotContext } from '../ICommandHandler';
import { log } from '../../../utils/logger';
import { FundingAlertModel } from '../../../models/fundingAlertModel';
import { PotentialAlertModel } from '../../../models/potentialAlertModel';
import { esp32NotificationService } from '../../esp32';

/**
 * Inline keyboard 菜单
 *
 * 增量式 UI：仅新增 /menu 命令和回调处理，不改动任何现有命令。
 * 首版只覆盖"开关"类操作（负费率报警、潜力币信号、ESP32 语音），
 * 输入数值类（阈值、币种）仍通过原有斜杠命令。
 */
export class MenuCommandHandler {
  private static readonly CB = {
    TOGGLE_FUNDING: 'menu:toggle:funding',
    TOGGLE_POTENTIAL: 'menu:toggle:potential',
    TOGGLE_ESP32: 'menu:toggle:esp32',
    REFRESH: 'menu:refresh',
    CLOSE: 'menu:close',
  };

  register(bot: Telegraf<BotContext>): void {
    bot.command('menu', async (ctx) => {
      try {
        const { text, keyboard } = await this.renderHome();
        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
      } catch (error) {
        log.error('menu command failed', error);
        await ctx.reply('❌ 打开菜单失败');
      }
    });

    bot.action(MenuCommandHandler.CB.TOGGLE_FUNDING, async (ctx) => {
      try {
        const next = !FundingAlertModel.isEnabled();
        FundingAlertModel.setEnabled(next);
        log.info(`menu: funding alert ${next ? 'enabled' : 'disabled'}`);
        await ctx.answerCbQuery(next ? '✅ 已开启' : '🛑 已关闭');
        await this.refresh(ctx);
      } catch (error) {
        log.error('menu toggle funding failed', error);
        await ctx.answerCbQuery('❌ 切换失败');
      }
    });

    bot.action(MenuCommandHandler.CB.TOGGLE_POTENTIAL, async (ctx) => {
      try {
        const next = !PotentialAlertModel.isEnabled();
        PotentialAlertModel.setEnabled(next);
        log.info(`menu: potential alert ${next ? 'enabled' : 'disabled'}`);
        await ctx.answerCbQuery(next ? '✅ 已开启' : '🛑 已关闭');
        await this.refresh(ctx);
      } catch (error) {
        log.error('menu toggle potential failed', error);
        await ctx.answerCbQuery('❌ 切换失败');
      }
    });

    bot.action(MenuCommandHandler.CB.TOGGLE_ESP32, async (ctx) => {
      try {
        await esp32NotificationService.ensureRow();
        const cfg = await esp32NotificationService.getConfig();
        const next = !cfg.enabled;
        await esp32NotificationService.setEnabled(next);
        log.info(`menu: esp32 ${next ? 'enabled' : 'disabled'}`);
        await ctx.answerCbQuery(next ? '✅ 已开启' : '🛑 已关闭');
        await this.refresh(ctx);
      } catch (error) {
        log.error('menu toggle esp32 failed', error);
        await ctx.answerCbQuery('❌ 切换失败');
      }
    });

    bot.action(MenuCommandHandler.CB.REFRESH, async (ctx) => {
      try {
        await ctx.answerCbQuery('🔄 已刷新');
        await this.refresh(ctx);
      } catch (error) {
        log.error('menu refresh failed', error);
        await ctx.answerCbQuery('❌ 刷新失败');
      }
    });

    bot.action(MenuCommandHandler.CB.CLOSE, async (ctx) => {
      try {
        await ctx.answerCbQuery('已关闭');
        await ctx.deleteMessage().catch(() => { /* 消息过老无法删时忽略 */ });
      } catch (error) {
        log.error('menu close failed', error);
      }
    });
  }

  private async refresh(ctx: BotContext): Promise<void> {
    const { text, keyboard } = await this.renderHome();
    try {
      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      // Telegram 对相同内容的 edit 会报 "message is not modified"，忽略
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('message is not modified')) {
        log.warn('menu refresh edit failed', { err: msg });
      }
    }
  }

  private async renderHome(): Promise<{ text: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> }> {
    const fundingOn = FundingAlertModel.isEnabled();
    const potentialOn = PotentialAlertModel.isEnabled();

    let esp32On = false;
    try {
      await esp32NotificationService.ensureRow();
      const cfg = await esp32NotificationService.getConfig();
      esp32On = cfg.enabled;
    } catch (error) {
      log.warn('menu: failed to read esp32 config', error);
    }

    const badge = (on: boolean) => (on ? '✅ 开启' : '❌ 关闭');
    const toggleLabel = (on: boolean) => (on ? '关闭' : '开启');

    const text =
      `📋 *快捷菜单*\n` +
      `━━━━━━━━━━━━\n` +
      `🔔 负费率报警: ${badge(fundingOn)}\n` +
      `🎯 潜力币信号: ${badge(potentialOn)}\n` +
      `🔊 ESP32 语音: ${badge(esp32On)}\n` +
      `━━━━━━━━━━━━\n` +
      `点击下方按钮切换；其他设置请继续使用原有命令（/help 可查）。`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`🔔 ${toggleLabel(fundingOn)}负费率报警`, MenuCommandHandler.CB.TOGGLE_FUNDING),
      ],
      [
        Markup.button.callback(`🎯 ${toggleLabel(potentialOn)}潜力币信号`, MenuCommandHandler.CB.TOGGLE_POTENTIAL),
      ],
      [
        Markup.button.callback(`🔊 ${toggleLabel(esp32On)}ESP32 语音`, MenuCommandHandler.CB.TOGGLE_ESP32),
      ],
      [
        Markup.button.callback('🔄 刷新', MenuCommandHandler.CB.REFRESH),
        Markup.button.callback('❌ 关闭', MenuCommandHandler.CB.CLOSE),
      ],
    ]);

    return { text, keyboard };
  }
}
