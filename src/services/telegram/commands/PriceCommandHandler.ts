import { BaseCommandHandler } from './BaseCommandHandler';
import { BotContext, CommandResult } from '../ICommandHandler';

export class PriceCommandHandler extends BaseCommandHandler {
  readonly command = 'price';
  readonly description = 'Get current price for a cryptocurrency symbol';
  readonly requiresAuth = false;

  constructor(
    formatter: any,
    logger: any,
    private binanceClient: any
  ) {
    super(formatter, logger);
  }

  async handle(ctx: BotContext, args: string[]): Promise<CommandResult> {
    return this.safeExecute(ctx, async () => {
      if (!this.validateArgs(args, 1, 1)) {
        return {
          success: false,
          message: `Usage: /${this.command} <symbol>\nExample: /${this.command} BTC`,
          shouldReply: true
        };
      }

      const symbol = this.normalizeSymbol(args[0]);

      if (!this.isValidSymbol(symbol)) {
        return {
          success: false,
          message: this.formatter.formatError(`Invalid symbol: ${symbol}`),
          shouldReply: true
        };
      }

      try {
        // 获取价格数据
        const stats = await this.binanceClient.get24hrStats(symbol);

        const marketData = {
          symbol,
          price: parseFloat(stats.lastPrice),
          priceChangePercent24h: parseFloat(stats.priceChangePercent),
          volume24h: parseFloat(stats.volume),
          high24h: parseFloat(stats.highPrice),
          low24h: parseFloat(stats.lowPrice)
        };

        return {
          success: true,
          message: this.formatter.formatMarketData(marketData),
          shouldReply: true
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('Invalid symbol')) {
          return {
            success: false,
            message: this.formatter.formatError(`Symbol ${symbol} not found`),
            shouldReply: true
          };
        }
        throw error;
      }
    });
  }

  getHelp(): string {
    return `/${this.command} <symbol> - ${this.description}

*Usage:*
• \`/${this.command} BTC\` - Get Bitcoin price
• \`/${this.command} ETH\` - Get Ethereum price
• \`/${this.command} ADAUSDT\` - Get ADA price

*Note:* USDT will be automatically added if not specified.`;
  }
}