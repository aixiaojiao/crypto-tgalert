import { IMessageFormatter } from './ICommandHandler';
export class MessageFormatter implements IMessageFormatter {

  formatPrice(symbol: string, price: number, change?: number): string {
    const formattedPrice = this.formatNumber(price);
    const changeText = change !== undefined ? this.formatPriceChange(change) : '';

    return `💰 ${symbol}: $${formattedPrice}${changeText}`;
  }

  formatAlert(alertData: any): string {
    const { symbol, type, currentValue, thresholdValue, triggeredAt } = alertData;

    return `🚨 *Alert Triggered*

📊 Symbol: *${symbol}*
📈 Type: ${type.replace('_', ' ').toUpperCase()}
💰 Current: ${this.formatNumber(currentValue)}
🎯 Threshold: ${this.formatNumber(thresholdValue)}
⏰ Time: ${this.formatDateTime(triggeredAt)}`;
  }

  formatMarketData(data: any): string {
    const { symbol, price, priceChange24h, volume24h, high24h, low24h } = data;

    return `📊 *${symbol}* Market Data

💰 Price: $${this.formatNumber(price)}
📈 24h Change: ${this.formatPriceChange(priceChange24h)}
📊 Volume: $${this.formatNumber(volume24h)}
⬆️ High: $${this.formatNumber(high24h)}
⬇️ Low: $${this.formatNumber(low24h)}

🕐 Updated: ${this.formatDateTime(new Date())}`;
  }

  formatError(error: Error | string): string {
    const message = error instanceof Error ? error.message : error;
    return `❌ Error: ${message}`;
  }

  formatList(items: any[], formatFn: (item: any) => string): string {
    if (items.length === 0) {
      return '📝 No items found.';
    }

    const formattedItems = items.map((item, index) =>
      `${index + 1}. ${formatFn(item)}`
    ).join('\n');

    return `📋 Results (${items.length} items):\n\n${formattedItems}`;
  }

  // 格式化帮助信息
  formatHelp(commands: Array<{ command: string; description: string }>): string {
    const commandList = commands.map(cmd =>
      `/${cmd.command} - ${cmd.description}`
    ).join('\n');

    return `🤖 *Available Commands:*

${commandList}

💡 Use /help [command] for detailed information about a specific command.`;
  }

  // 格式化状态信息
  formatStatus(status: any): string {
    const { isRunning, startTime, commandsProcessed, errors, uptime } = status;

    return `🤖 *Bot Status*

🟢 Status: ${isRunning ? 'Running' : 'Stopped'}
🚀 Started: ${this.formatDateTime(startTime)}
⏱️ Uptime: ${this.formatDuration(uptime)}
📊 Commands: ${commandsProcessed}
❌ Errors: ${errors}`;
  }

  // 格式化市场概览
  formatMarketOverview(markets: any[]): string {
    if (markets.length === 0) {
      return '📊 No market data available.';
    }

    const header = `📊 *Market Overview* (${markets.length} pairs)

`;

    const marketList = markets.map((market, index) => {
      const { symbol, price, priceChangePercent24h } = market;
      const changeIcon = priceChangePercent24h >= 0 ? '🟢' : '🔴';

      return `${index + 1}. ${changeIcon} *${symbol}*
   💰 $${this.formatNumber(price)}
   📈 ${this.formatPriceChange(priceChangePercent24h)}`;
    }).join('\n\n');

    return header + marketList;
  }

  // 格式化报警列表
  formatAlertList(alerts: any[]): string {
    if (alerts.length === 0) {
      return '📝 No alerts configured.';
    }

    const header = `🚨 *Your Alerts* (${alerts.length} total)

`;

    const alertList = alerts.map((alert, index) => {
      const { id, symbol, type, thresholds, enabled } = alert;
      const statusIcon = enabled ? '🟢' : '🔴';

      return `${index + 1}. ${statusIcon} *${symbol}* ${type.replace('_', ' ')}
   🎯 Threshold: ${this.formatNumber(thresholds.value)}
   🆔 ID: \`${id}\``;
    }).join('\n\n');

    return header + alertList;
  }

  // 格式化历史数据
  formatHistoricalHigh(data: any): string {
    const { symbol, timeframe, high, timestamp, daysSince } = data;

    return `📈 *${symbol}* Historical High (${timeframe})

🏆 Highest Price: $${this.formatNumber(high)}
📅 Date: ${this.formatDateTime(timestamp)}
⏰ Days Since: ${daysSince} days`;
  }

  // Private helper methods

  private formatNumber(num: number): string {
    if (num >= 1000000000) {
      return (num / 1000000000).toFixed(2) + 'B';
    } else if (num >= 1000000) {
      return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(2) + 'K';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else if (num >= 0.01) {
      return num.toFixed(4);
    } else {
      return num.toFixed(8);
    }
  }

  private formatPriceChange(change: number): string {
    const icon = change >= 0 ? '🟢' : '🔴';
    const sign = change >= 0 ? '+' : '';
    return ` ${icon} ${sign}${change.toFixed(2)}%`;
  }

  private formatDateTime(date: Date | number): string {
    const dateObj = date instanceof Date ? date : new Date(date);
    return dateObj.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  // Telegram特定的格式化方法
  formatTelegramMarkdown(text: string): string {
    // 转义Telegram Markdown特殊字符
    return text
      .replace(/\*/g, '\\*')
      .replace(/_/g, '\\_')
      .replace(/`/g, '\\`')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  formatInlineKeyboard(buttons: Array<{ text: string; data: string }>): any {
    return {
      reply_markup: {
        inline_keyboard: buttons.map(btn => [{
          text: btn.text,
          callback_data: btn.data
        }])
      }
    };
  }
}