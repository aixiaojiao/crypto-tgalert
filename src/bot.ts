import { Telegraf } from 'telegraf';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { BotContext, BotStatus } from './types';
import { BinanceClient } from './services/binance';
import { filterTradingPairs, getTokenRiskLevel, getRiskIcon } from './config/tokenLists';

export class TelegramBot {
  private bot: Telegraf<BotContext>;
  private status: BotStatus;
  private binanceClient: BinanceClient;

  constructor() {
    this.bot = new Telegraf<BotContext>(config.telegram.botToken);
    this.binanceClient = new BinanceClient();
    this.status = {
      isRunning: false,
      startTime: new Date(),
      commandsProcessed: 0,
      errors: 0
    };

    this.setupMiddleware();
    this.setupCommands();
    this.setupErrorHandling();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 用户认证中间件
    this.bot.use(authMiddleware());
    
    // 命令计数中间件
    this.bot.use(async (ctx, next) => {
      this.status.commandsProcessed++;
      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : 'unknown';
      console.log(`📊 Processing command #${this.status.commandsProcessed}: ${messageText}`);
      await next();
    });
  }

  /**
   * 设置基础命令
   */
  private setupCommands(): void {
    // 开始命令
    this.bot.start(async (ctx) => {
      const user = ctx.from;
      const welcomeMessage = `
🚀 *欢迎使用 Crypto Alert Bot!*

👤 用户: ${user?.first_name} ${user?.username ? `(@${user.username})` : ''}
🆔 用户ID: ${user?.id}

📊 *可用功能:*
• 实时价格查询
• 价格提醒设置  
• Twitter账户监控
• 链上数据查询

💡 *基础命令:*
/help - 查看完整帮助
/status - 查看系统状态
/price btc - 查看BTC价格

🤖 机器人已准备就绪！
      `;
      
      await ctx.replyWithMarkdown(welcomeMessage);
    });

    // 帮助命令
    this.bot.help(async (ctx) => {
      const helpMessage = `
📖 <b>Crypto Alert Bot 帮助</b>

💰 <b>价格查询 (默认合约):</b>
/price btc - 查看BTC合约价格+资金费率+持仓量
/price eth - 查看ETH合约价格  
/price sol - 查看SOL合约价格

📊 <b>排行榜查询:</b>
/gainers - 24小时涨幅榜 TOP10
/losers - 24小时跌幅榜 TOP10
/funding - 资金费率排行榜 (负费率优先)
/oi24h - 24小时持仓量增长榜
/oi4h - 4小时持仓量增长榜
/oi1h - 1小时持仓量增长榜

⚡ <b>价格提醒:</b>
/alert btc &gt; 50000 - BTC超过50000时提醒
/alert eth &lt; 3000 - ETH低于3000时提醒
/alerts - 查看所有提醒
/remove_alert 1 - 删除提醒#1

🐦 <b>Twitter监控:</b>
/follow elonmusk - 关注用户推文
/unfollow elonmusk - 取消关注
/following - 查看关注列表

🔗 <b>链上查询:</b>
/tx hash - 查询交易详情
/address addr - 查询地址信息

⚙️ <b>系统:</b>
/status - 查看系统状态
/help - 查看帮助

💡 提示: 默认查询合约数据，包含资金费率和持仓量信息`;
      
      await ctx.reply(helpMessage, { parse_mode: 'HTML' });
    });

    // 价格查询命令 (默认查询合约)
    this.bot.command('price', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        
        if (!args || args.length === 0) {
          await ctx.reply('💡 请指定要查询的币种，例如: /price btc');
          return;
        }

        const symbol = args[0].toUpperCase();
        
        // 检查是否是已下架代币
        const testSymbol = symbol.includes('USDT') ? symbol : symbol + 'USDT';
        const riskLevel = getTokenRiskLevel(testSymbol);
        if (riskLevel === 'delisted' || riskLevel === 'blacklist') {
          await ctx.reply(`❌ ${symbol} 已被列入${riskLevel === 'delisted' ? '已下架' : '黑名单'}代币，不支持查询`);
          return;
        }
        
        await ctx.reply('🔍 正在查询价格...');

        // 优先查询合约数据
        let price: number | undefined;
        let stats: any | undefined;
        let fundingRate: any | undefined;
        let openInterest: any | undefined;
        let isContract = false;
        let actualSymbol = symbol;

        // 尝试不同的交易对后缀
        const suffixes = ['USDT', 'BUSD', 'BTC', 'ETH'];
        let found = false;

        for (const suffix of suffixes) {
          if (symbol.includes(suffix)) {
            actualSymbol = symbol;
            break;
          }
          
          actualSymbol = symbol + suffix;
          
          try {
            // 首先尝试合约
            [price, stats, fundingRate, openInterest] = await Promise.all([
              this.binanceClient.getFuturesPrice(actualSymbol),
              this.binanceClient.getFutures24hrStats(actualSymbol),
              this.binanceClient.getFundingRate(actualSymbol),
              this.binanceClient.getOpenInterest(actualSymbol)
            ]);
            isContract = true;
            found = true;
            break;
          } catch (futuresError) {
            // 如果合约失败，尝试现货
            try {
              price = await this.binanceClient.getPrice(actualSymbol);
              stats = await this.binanceClient.get24hrStats(actualSymbol);
              isContract = false;
              found = true;
              break;
            } catch (spotError) {
              // 继续尝试下一个后缀
              continue;
            }
          }
        }

        if (!found || !price || !stats) {
          throw new Error(`无法找到 ${symbol} 的价格数据，请检查币种名称是否正确`);
        }

        const changePercent = parseFloat(stats.priceChangePercent);
        const changeIcon = changePercent >= 0 ? '📈' : '📉';
        const changeColor = changePercent >= 0 ? '+' : '';

        let priceMessage = `
💰 *${symbol} ${isContract ? '合约' : '现货'}价格*

💵 当前价格: $${price.toLocaleString()}
${changeIcon} 24小时涨跌: ${changeColor}${changePercent.toFixed(2)}%
📊 24小时交易量: ${(parseFloat(stats.volume) / 1000000).toFixed(2)}M USDT
🔺 24小时最高: $${parseFloat(stats.highPrice).toLocaleString()}
🔻 24小时最低: $${parseFloat(stats.lowPrice).toLocaleString()}`;

        if (isContract && fundingRate && openInterest) {
          const fundingRatePercent = (parseFloat(fundingRate.fundingRate) * 100).toFixed(4);
          const fundingRateIcon = parseFloat(fundingRate.fundingRate) >= 0 ? '🟢' : '🔴';
          const openInterestValue = (parseFloat(openInterest.openInterest) / 1000000).toFixed(2);

          priceMessage += `

⚡ *合约数据:*
${fundingRateIcon} 资金费率: ${fundingRatePercent}%
📈 持仓量: ${openInterestValue}M USDT
⏰ 下次费率时间: ${new Date(fundingRate.fundingTime).toLocaleString('zh-CN')}`;
        }

        priceMessage += `

⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(priceMessage);
        
      } catch (error) {
        console.error('Price query error:', error);
        await ctx.reply('❌ 查询失败，请检查币种名称是否正确');
      }
    });

    // 状态命令
    this.bot.command('status', async (ctx) => {
      try {
        const uptime = Math.floor((Date.now() - this.status.startTime.getTime()) / 1000);
        const uptimeHours = Math.floor(uptime / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);
        
        // 测试Binance连接
        const btcPrice = await this.binanceClient.getPrice('BTCUSDT');
        
        const statusMessage = `
📊 *系统状态*

🟢 运行状态: ${this.status.isRunning ? '正常运行' : '未运行'}
⏱️ 运行时间: ${uptimeHours}h ${uptimeMinutes}m
📈 处理命令数: ${this.status.commandsProcessed}
❌ 错误次数: ${this.status.errors}
🕐 启动时间: ${this.status.startTime.toLocaleString('zh-CN')}

💰 *API状态:*
Binance: ✅ 连接正常 (BTC: $${btcPrice.toLocaleString()})

💾 *内存使用:*
${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB / ${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB

🤖 系统运行正常！
        `;
        
        await ctx.replyWithMarkdown(statusMessage);
      } catch (error) {
        await ctx.reply('❌ 获取系统状态时发生错误');
      }
    });

    // 24小时涨幅榜
    this.bot.command('gainers', async (ctx) => {
      try {
        await ctx.reply('📊 正在查询24小时涨幅榜...');

        const allStats = await this.binanceClient.getFutures24hrStatsMultiple();
        
        // 过滤交易对并按涨幅排序，取前10
        const validSymbols = filterTradingPairs(allStats.map(s => s.symbol));
        const gainers = allStats
          .filter(stat => {
            return parseFloat(stat.priceChangePercent) > 0 && 
                   validSymbols.includes(stat.symbol) &&
                   parseFloat(stat.volume) > 10000; // 过滤交易量过低的代币
          })
          .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
          .slice(0, 10);

        let message = `🚀 *24小时涨幅榜 TOP10*\n\n`;
        
        gainers.forEach((stat, index) => {
          const symbol = stat.symbol.replace('USDT', '');
          const change = parseFloat(stat.priceChangePercent).toFixed(2);
          const price = parseFloat(stat.lastPrice).toLocaleString();
          const riskLevel = getTokenRiskLevel(stat.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          message += `${index + 1}. ${riskIcon}**${symbol}** +${change}% ($${price})\n`;
        });

        message += `\n⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('Gainers query error:', error);
        await ctx.reply('❌ 查询涨幅榜失败');
      }
    });

    // 24小时跌幅榜
    this.bot.command('losers', async (ctx) => {
      try {
        await ctx.reply('📉 正在查询24小时跌幅榜...');

        const allStats = await this.binanceClient.getFutures24hrStatsMultiple();
        
        // 过滤交易对并按跌幅排序，取前10
        const validSymbols = filterTradingPairs(allStats.map(s => s.symbol));
        const losers = allStats
          .filter(stat => {
            return parseFloat(stat.priceChangePercent) < 0 && 
                   validSymbols.includes(stat.symbol) &&
                   parseFloat(stat.volume) > 10000; // 过滤交易量过低的代币
          })
          .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
          .slice(0, 10);

        let message = `📉 *24小时跌幅榜 TOP10*\n\n`;
        
        losers.forEach((stat, index) => {
          const symbol = stat.symbol.replace('USDT', '');
          const change = parseFloat(stat.priceChangePercent).toFixed(2);
          const price = parseFloat(stat.lastPrice).toLocaleString();
          const riskLevel = getTokenRiskLevel(stat.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          message += `${index + 1}. ${riskIcon}**${symbol}** ${change}% ($${price})\n`;
        });

        message += `\n⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('Losers query error:', error);
        await ctx.reply('❌ 查询跌幅榜失败');
      }
    });

    // 负费率排行榜
    this.bot.command('funding', async (ctx) => {
      try {
        await ctx.reply('⚡ 正在查询资金费率排行榜...');

        const fundingRates = await this.binanceClient.getAllFundingRates();
        console.log('Raw funding rates count:', fundingRates.length);
        console.log('Sample funding rates:', fundingRates.slice(0, 5));
        
        // 过滤交易对并去重
        const validSymbols = filterTradingPairs(fundingRates.map(r => r.symbol));
        console.log('Valid symbols count:', validSymbols.length);
        
        const filteredRates = fundingRates
          .filter(rate => validSymbols.includes(rate.symbol))
          .reduce((acc, rate) => {
            // 使用Map去重，保留第一个出现的
            const key = rate.symbol;
            if (!acc.has(key)) {
              acc.set(key, rate);
            } else {
              console.log(`Duplicate symbol found: ${key}`);
            }
            return acc;
          }, new Map());

        console.log('Filtered rates map size:', filteredRates.size);
        
        // 只显示负费率并排序
        const sortedRates = Array.from(filteredRates.values())
          .filter(rate => parseFloat(rate.fundingRate) < 0)
          .sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate))
          .slice(0, 15);

        console.log('Filtered and sorted rates:', sortedRates.length);
        
        let message = `⚡ *负费率排行榜*\n\n`;
        
        sortedRates.forEach((rate, index) => {
          const symbol = rate.symbol.replace('USDT', '');
          const fundingPercent = (parseFloat(rate.fundingRate) * 100).toFixed(4);
          const icon = parseFloat(rate.fundingRate) < 0 ? '🔴' : '🟢';
          message += `${index + 1}. ${icon} **${symbol}** ${fundingPercent}%\n`;
        });

        message += `\n💡 负费率(红色)表示空头支付多头\n`;
        message += `⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('Funding rates query error:', error);
        await ctx.reply('❌ 查询资金费率排行榜失败');
      }
    });

    // 持仓量增长榜 (24小时)
    this.bot.command('oi24h', async (ctx) => {
      try {
        await ctx.reply('📈 正在查询24小时持仓量增长榜...');

        // 获取活跃合约列表
        const symbols = await this.binanceClient.getFuturesTradingSymbols();
        
        // 过滤有效交易对，优先选择主要币种
        const validSymbols = filterTradingPairs(symbols);
        const majorSymbols = validSymbols
          .filter(s => ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'LTC', 'BCH', 'XRP', 'DOGE', 'ATOM'].some(major => s.startsWith(major)))
          .slice(0, 20);

        const oiPromises = majorSymbols.map(async symbol => {
          try {
            const oiStats = await this.binanceClient.getOpenInterestStats(symbol, '1h', 24);
            console.log(`OI Stats for ${symbol}:`, {
              length: oiStats.length,
              first: oiStats[0],
              last: oiStats[oiStats.length - 1]
            });
            
            if (oiStats.length >= 12) { // 至少需要12小时的数据
              const current = parseFloat(oiStats[0].sumOpenInterestValue);
              // 使用最后一个可用数据点，而不是固定索引
              const previousIndex = Math.min(23, oiStats.length - 1);
              const previous = parseFloat(oiStats[previousIndex].sumOpenInterestValue);
              
              if (current > 0 && previous > 0) {
                const change = ((current - previous) / previous) * 100;
                // 过滤异常数据
                if (Math.abs(change) < 500) {
                  return {
                    symbol: symbol.replace('USDT', ''),
                    change,
                    currentOI: current / 1000000,
                    dataPoints: oiStats.length
                  };
                }
              }
            }
            return null;
          } catch (error) {
            console.log(`OI Error for ${symbol}:`, error instanceof Error ? error.message : 'Unknown error');
            return null;
          }
        });

        const oiResults = (await Promise.all(oiPromises))
          .filter(result => result !== null)
          .sort((a, b) => (b as any).change - (a as any).change)
          .slice(0, 10);

        let message = `📈 *24小时持仓量增长榜*\n\n`;
        
        oiResults.forEach((result: any, index) => {
          const changeIcon = result.change >= 0 ? '📈' : '📉';
          message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
        });

        message += `\n⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('OI 24h query error:', error);
        await ctx.reply('❌ 查询24小时持仓量增长榜失败');
      }
    });

    // 持仓量增长榜 (4小时)
    this.bot.command('oi4h', async (ctx) => {
      try {
        await ctx.reply('📈 正在查询4小时持仓量增长榜...');

        const symbols = await this.binanceClient.getFuturesTradingSymbols();
        const filteredSymbols = filterTradingPairs(symbols);
        const majorSymbols = filteredSymbols.filter(s => 
          ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'LTC', 'BCH', 'XRP', 'DOGE', 'ATOM'].some(major => s.startsWith(major))
        ).slice(0, 20);

        const oiPromises = majorSymbols.map(async symbol => {
          try {
            const oiStats = await this.binanceClient.getOpenInterestStats(symbol, '1h', 4);
            
            if (oiStats.length >= 4) {
              const current = parseFloat(oiStats[0].sumOpenInterestValue);
              const previous = parseFloat(oiStats[3].sumOpenInterestValue);
              
              if (current > 0 && previous > 0) {
                const change = ((current - previous) / previous) * 100;
                // 过滤异常数据
                if (Math.abs(change) < 200) {
                  return {
                    symbol: symbol.replace('USDT', ''),
                    change,
                    currentOI: current / 1000000
                  };
                }
              }
            }
            return null;
          } catch (error) {
            return null;
          }
        });

        const oiResults = (await Promise.all(oiPromises))
          .filter(result => result !== null)
          .sort((a, b) => (b as any).change - (a as any).change)
          .slice(0, 10);

        let message = `📈 *4小时持仓量增长榜*\n\n`;
        
        oiResults.forEach((result: any, index) => {
          const changeIcon = result.change >= 0 ? '📈' : '📉';
          message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
        });

        message += `\n⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('OI 4h query error:', error);
        await ctx.reply('❌ 查询4小时持仓量增长榜失败');
      }
    });

    // 持仓量增长榜 (1小时)
    this.bot.command('oi1h', async (ctx) => {
      try {
        await ctx.reply('📈 正在查询1小时持仓量增长榜...');

        const symbols = await this.binanceClient.getFuturesTradingSymbols();
        const filteredSymbols = filterTradingPairs(symbols);
        const majorSymbols = filteredSymbols.filter(s => 
          ['BTC', 'ETH', 'BNB', 'ADA', 'SOL', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'LTC', 'BCH', 'XRP', 'DOGE', 'ATOM'].some(major => s.startsWith(major))
        ).slice(0, 20);

        // For 1-hour data, we need to get multiple data points within the hour
        const oiPromises = majorSymbols.map(async symbol => {
          try {
            // Get current open interest
            const currentOI = await this.binanceClient.getOpenInterest(symbol);
            // Get 1-hour historical data (if available)
            const oiStats = await this.binanceClient.getOpenInterestStats(symbol, '15m', 4);
            
            if (oiStats.length >= 2) {
              const current = parseFloat(currentOI.openInterest);
              const previous = parseFloat(oiStats[3].sumOpenInterest);
              const change = ((current - previous) / previous) * 100;
              return {
                symbol: symbol.replace('USDT', ''),
                change,
                currentOI: current / 1000000
              };
            }
            return null;
          } catch (error) {
            return null;
          }
        });

        const oiResults = (await Promise.all(oiPromises))
          .filter(result => result !== null)
          .sort((a, b) => (b as any).change - (a as any).change)
          .slice(0, 10);

        let message = `📈 *1小时持仓量增长榜*\n\n`;
        
        oiResults.forEach((result: any, index) => {
          const changeIcon = result.change >= 0 ? '📈' : '📉';
          message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
        });

        message += `\n⏰ 更新时间: ${new Date().toLocaleString('zh-CN')}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('OI 1h query error:', error);
        await ctx.reply('❌ 查询1小时持仓量增长榜失败');
      }
    });

    // 处理未知命令
    this.bot.on('text', async (ctx) => {
      const text = ctx.message?.text;
      
      if (!text) return;
      
      // 如果不是命令，提供友好提示
      if (!text.startsWith('/')) {
        await ctx.reply('💡 请使用 /help 查看可用命令，或直接发送 /price btc 查询价格');
        return;
      }
      
      // 未知命令
      await ctx.reply(`❓ 未知命令: ${text}\n使用 /help 查看所有可用命令`);
    });
  }

  /**
   * 设置机器人命令菜单
   */
  private async setupBotMenu(): Promise<void> {
    const commands = [
      { command: 'price', description: '查询加密货币价格 (例: /price btc)' },
      { command: 'gainers', description: '24小时涨幅榜 TOP10' },
      { command: 'losers', description: '24小时跌幅榜 TOP10' },
      { command: 'funding', description: '资金费率排行榜' },
      { command: 'oi24h', description: '24小时持仓量增长榜' },
      { command: 'oi4h', description: '4小时持仓量增长榜' },
      { command: 'oi1h', description: '1小时持仓量增长榜' },
      { command: 'status', description: '查看系统状态' },
      { command: 'help', description: '查看完整帮助文档' }
    ];

    try {
      await this.bot.telegram.setMyCommands(commands);
      console.log('✅ Bot commands menu set successfully');
      
      // 验证命令是否设置成功
      const setCommands = await this.bot.telegram.getMyCommands();
      console.log('📋 Current bot commands:', setCommands.length);
    } catch (error) {
      console.error('❌ Failed to set bot commands menu:', error);
      // 如果设置菜单失败，不影响机器人运行
    }
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    this.bot.catch((err, ctx) => {
      this.status.errors++;
      console.error('🚨 Bot error:', err);
      
      if (ctx) {
        ctx.reply('❌ 处理命令时发生错误，请稍后重试').catch(e => {
          console.error('Failed to send error message:', e);
        });
      }
    });

    // 优雅关闭
    process.once('SIGINT', () => this.stop('SIGINT'));
    process.once('SIGTERM', () => this.stop('SIGTERM'));
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Telegram bot...');
      
      this.status.isRunning = true;
      this.status.startTime = new Date();
      
      // Set up commands menu before launching
      await this.setupBotMenu();
      
      // Send startup notification to authorized user
      try {
        console.log('📤 Sending startup notification to user:', config.telegram.userId);
        await this.bot.telegram.sendMessage(config.telegram.userId, 'hello');
        console.log('✅ Startup notification sent successfully');
      } catch (error) {
        console.error('⚠️ Failed to send startup notification:', error);
      }
      
      console.log('✅ Telegram bot initialized successfully');
      console.log(`🤖 Bot username: @${this.bot.botInfo?.username}`);
      console.log(`👤 Authorized user: ${config.telegram.userId}`);
      
      // Launch bot (this will start the polling)
      await this.bot.launch();
      console.log('🎯 Telegram bot launched and polling started');
      
    } catch (error) {
      this.status.errors++;
      console.error('❌ Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * 停止机器人
   */
  async stop(reason?: string): Promise<void> {
    console.log(`🛑 Stopping bot${reason ? ` (${reason})` : ''}...`);
    
    this.status.isRunning = false;
    await this.bot.stop();
    
    console.log('✅ Bot stopped gracefully');
  }

  /**
   * 获取机器人实例
   */
  getBot(): Telegraf<BotContext> {
    return this.bot;
  }

  /**
   * 获取状态
   */
  getStatus(): BotStatus {
    return { ...this.status };
  }

  /**
   * 发送消息给授权用户
   */
  async sendToAuthorizedUser(message: string, options?: any): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(config.telegram.userId, message, options);
    } catch (error) {
      console.error('Failed to send message to authorized user:', error);
      throw error;
    }
  }
}