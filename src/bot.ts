import { Telegraf } from 'telegraf';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { BotContext, BotStatus } from './types';
import { BinanceClient } from './services/binance';
import { filterTradingPairs, getTokenRiskLevel, getRiskIcon } from './config/tokenLists';
import { PriceAlertModel } from './models/PriceAlert';
import { triggerAlertService } from './services/triggerAlerts';
import { TriggerAlertModel } from './models/TriggerAlert';
import { formatPriceWithSeparators, formatPriceChange } from './utils/priceFormatter';

// 统一时间格式化函数 - UTC+8时区
function formatTimeToUTC8(date: Date | number): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
import { tieredDataManager } from './services/tieredDataManager';
import { volumeClassifier } from './utils/volumeClassifier';
import { rankingAnalyzer } from './services/rankingAnalyzer';
import { DebugService } from './services/debugService';
import { realtimeMarketCache } from './services/realtimeMarketCache';
import { realtimeAlertService } from './services/realtimeAlertService';
import { log } from './utils/logger';

export class TelegramBot {
  private bot: Telegraf<BotContext>;
  private status: BotStatus;
  private binanceClient: BinanceClient;
  private debugService: DebugService;

  constructor() {
    this.bot = new Telegraf<BotContext>(config.telegram.botToken);
    this.binanceClient = new BinanceClient();
    this.debugService = new DebugService();
    this.status = {
      isRunning: false,
      startTime: new Date(),
      commandsProcessed: 0,
      errors: 0
    };

    this.setupMiddleware();
    this.setupCommands();
    this.setupErrorHandling();

    // Set telegram bot instance for trigger alerts
    triggerAlertService.setTelegramBot(this);

    // Initialize realtime market cache and alert service
    this.initializeRealtimeServices();
  }

  /**
   * 初始化实时市场数据缓存和推送服务
   */
  private async initializeRealtimeServices(): Promise<void> {
    try {
      // 初始化实时市场缓存
      log.info('Initializing realtime market cache...');
      await realtimeMarketCache.start();
      log.info('Realtime market cache initialized successfully');

      // 初始化实时推送服务
      log.info('Initializing realtime alert service...');
      realtimeAlertService.setTelegramBot(this);
      await realtimeAlertService.start();
      log.info('Realtime alert service initialized successfully');

    } catch (error) {
      log.error('Failed to initialize realtime services', error);
      log.warn('Bot will continue with REST API fallback');
    }
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
/gainers_period &lt;时间段&gt; [数量] - 自定义时间段涨幅榜
/losers - 24小时跌幅榜 TOP10
/funding - 资金费率排行榜 (负费率优先)
/oi24h - 24小时持仓量增长榜
/oi4h - 4小时持仓量增长榜
/oi1h - 1小时持仓量增长榜

📈 <b>时间段涨幅榜示例:</b>
/gainers_period 1h - 1小时涨幅榜前10
/gainers_period 5m 5 - 5分钟涨幅榜前5
支持: 5m, 15m, 30m, 1h, 4h, 12h, 3d, 1w

⚡ <b>价格提醒:</b>
/alert btc &gt; 50000 - BTC超过50000时提醒
/alert eth &lt; 3000 - ETH低于3000时提醒
/alerts - 查看所有提醒
/remove_alert 1 - 删除提醒#1

📢 <b>推送通知:</b>
/start_gainers_push - 启动涨幅榜推送
/stop_gainers_push - 停止涨幅榜推送
/start_funding_push - 启动负费率榜推送
/stop_funding_push - 停止负费率榜推送
/start_oi1h_push - 启动OI 1小时推送
/stop_oi1h_push - 停止OI 1小时推送
/start_oi4h_push - 启动OI 4小时推送
/stop_oi4h_push - 停止OI 4小时推送
/start_oi24h_push - 启动OI 24小时推送
/stop_oi24h_push - 停止OI 24小时推送
/push_status - 查看推送状态

🐦 <b>Twitter监控:</b>
/follow elonmusk - 关注用户推文
/unfollow elonmusk - 取消关注
/following - 查看关注列表

🔗 <b>链上查询:</b>
/tx hash - 查询交易详情
/address addr - 查询地址信息

⚙️ <b>系统:</b>
/status - 查看系统状态
/cache_status - 查看实时数据缓存状态
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
            // 首先尝试合约 (using tiered data manager for optimization)
            stats = await tieredDataManager.getTicker24hr(actualSymbol);
            if (stats) {
              price = parseFloat(stats.lastPrice);
              fundingRate = await tieredDataManager.getFundingRate(actualSymbol);
              openInterest = await this.binanceClient.getOpenInterest(actualSymbol);
              isContract = true;
              found = true;
              break;
            }
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

        // Format prices with proper precision
        const formattedPrice = await formatPriceWithSeparators(price, actualSymbol);
        const formattedHighPrice = await formatPriceWithSeparators(stats.highPrice, actualSymbol);
        const formattedLowPrice = await formatPriceWithSeparators(stats.lowPrice, actualSymbol);
        const formattedChangePercent = formatPriceChange(changePercent);

        let priceMessage = `
💰 *${symbol} ${isContract ? '合约' : '现货'}价格*

💵 当前价格: $${formattedPrice}
${changeIcon} 24小时涨跌: ${changeColor}${formattedChangePercent}%
📊 24小时交易量: ${(parseFloat(stats.volume) / 1000000).toFixed(2)}M USDT
🔺 24小时最高: $${formattedHighPrice}
🔻 24小时最低: $${formattedLowPrice}`;

        if (isContract && fundingRate && openInterest) {
          const fundingRatePercent = (parseFloat(fundingRate.fundingRate) * 100).toFixed(4);
          const fundingRateIcon = parseFloat(fundingRate.fundingRate) >= 0 ? '🟢' : '🔴';
          const openInterestValue = (parseFloat(openInterest.openInterest) / 1000000).toFixed(2);

          priceMessage += `

⚡ *合约数据:*
${fundingRateIcon} 资金费率: ${fundingRatePercent}%
📈 持仓量: ${openInterestValue}M USDT
⏰ 下次费率时间: ${formatTimeToUTC8(fundingRate.fundingTime)}`;
        }

        priceMessage += `

⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;

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
🕐 启动时间: ${formatTimeToUTC8(this.status.startTime)}

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

    // 缓存优化状态命令
    this.bot.command('cache_status', async (ctx) => {
      try {
        const cacheStatus = tieredDataManager.getCacheStatus();
        const refreshStats = tieredDataManager.getRefreshStats();
        const volumeStats = volumeClassifier.getVolumeStats();
        
        const statusMessage = `
📊 *缓存优化系统状态*

🔥 *热榜代币 (强制实时更新):*
数量: ${cacheStatus.hotRankingSymbols.count}
代币: ${cacheStatus.hotRankingSymbols.symbols.join(', ')}

📈 *数据缓存状态:*
• Ticker数据: ${cacheStatus.tickers.total} (高:${cacheStatus.tickers.byTier.high} 中:${cacheStatus.tickers.byTier.medium} 低:${cacheStatus.tickers.byTier.low})
• 资金费率: ${cacheStatus.funding.total} (高:${cacheStatus.funding.byTier.high} 中:${cacheStatus.funding.byTier.medium} 低:${cacheStatus.funding.byTier.low})
• 持仓量: ${cacheStatus.openInterest.total} (高:${cacheStatus.openInterest.byTier.high} 中:${cacheStatus.openInterest.byTier.medium} 低:${cacheStatus.openInterest.byTier.low})

💎 *交易量分层统计:*
• 高交易量 (>50M): ${volumeStats.high.count}个 (30秒更新)
• 中交易量 (10-50M): ${volumeStats.medium.count}个 (5分钟更新)  
• 低交易量 (<10M): ${volumeStats.low.count}个 (4小时更新)
• 总代币数: ${volumeStats.totalSymbols}个

⚡ *API调用优化:*
• 总API调用: ${refreshStats.totalApiCalls}
• 高频更新: ${refreshStats.high.updated}/${refreshStats.high.requested} (跳过:${refreshStats.high.skipped})
• 中频更新: ${refreshStats.medium.updated}/${refreshStats.medium.requested} (跳过:${refreshStats.medium.skipped})
• 低频更新: ${refreshStats.low.updated}/${refreshStats.low.requested} (跳过:${refreshStats.low.skipped})

⏰ 更新时间: ${formatTimeToUTC8(new Date())}
        `;
        
        await ctx.replyWithMarkdown(statusMessage);
      } catch (error) {
        console.error('Cache status error:', error);
        await ctx.reply('❌ 获取缓存状态时发生错误');
      }
    });

    // 24小时涨幅榜 - 优化版本使用实时缓存
    this.bot.command('gainers', async (ctx) => {
      try {
        await ctx.reply('📊 正在查询24小时涨幅榜...');

        let gainers;
        let dataSource = '';
        let queryTime = Date.now();

        // 优先使用实时缓存数据
        if (realtimeMarketCache.isReady()) {
          log.debug('Using realtime cache for gainers query');
          const realtimeGainers = realtimeMarketCache.getTopGainers(10, 10000);

          if (realtimeGainers.length > 0) {
            gainers = realtimeGainers.map(data => ({
              symbol: data.symbol,
              priceChangePercent: data.priceChangePercent.toString(),
              lastPrice: data.price.toString(),
              volume: data.volume.toString()
            }));
            dataSource = '⚡ 实时数据';
            log.info(`Gainers query served from realtime cache in ${Date.now() - queryTime}ms`);
          }
        }

        // Fallback 到 REST API
        if (!gainers || gainers.length === 0) {
          log.debug('Using REST API fallback for gainers query');
          dataSource = '📡 API数据';

          // 🔥 Trigger real-time ranking analysis to capture sudden movers
          await rankingAnalyzer.analyzeRankings('user-query');

          // Use tiered data manager for optimized data fetching
          const allSymbols = await this.binanceClient.getFuturesTradingSymbols();
          const validSymbols = filterTradingPairs(allSymbols);
          const allStatsMap = await tieredDataManager.getBatchTickers(validSymbols);
          const allStats = Array.from(allStatsMap.values());

          // 过滤交易对并按涨幅排序，取前10
          gainers = allStats
            .filter(stat => {
              return parseFloat(stat.priceChangePercent) > 0 &&
                     validSymbols.includes(stat.symbol) &&
                     parseFloat(stat.volume) > 10000; // 过滤交易量过低的代币
            })
            .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
            .slice(0, 10);

          log.info(`Gainers query served from REST API in ${Date.now() - queryTime}ms`);
        }

        let message = `🚀 *24小时涨幅榜 TOP10*\n\n`;
        
        const priceFormatPromises = gainers.map(async (stat, index) => {
          const symbol = stat.symbol.replace('USDT', '');
          const change = formatPriceChange(parseFloat(stat.priceChangePercent));
          const formattedPrice = await formatPriceWithSeparators(stat.lastPrice, stat.symbol);
          const riskLevel = getTokenRiskLevel(stat.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          return `${index + 1}. ${riskIcon}**${symbol}** +${change}% ($${formattedPrice})\n`;
        });

        const formattedEntries = await Promise.all(priceFormatPromises);
        formattedEntries.forEach(entry => {
          message += entry;
        });

        message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;
        message += `\n📊 数据来源: ${dataSource}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('Gainers query error:', error);
        await ctx.reply('❌ 查询涨幅榜失败');
      }
    });

    // 实时缓存状态命令
    this.bot.command('cache_status', async (ctx) => {
      try {
        const cacheStats = realtimeMarketCache.getStats();

        let statusMessage = `📊 *实时数据缓存状态*\n\n`;
        statusMessage += `🔌 连接状态: ${cacheStats.isConnected ? '✅ 已连接' : '❌ 未连接'}\n`;
        statusMessage += `📈 交易对数量: ${cacheStats.totalSymbols} / ${cacheStats.validSymbols}\n`;
        statusMessage += `🔄 数据更新次数: ${cacheStats.totalUpdates}\n`;
        statusMessage += `📦 平均更新大小: ${cacheStats.avgUpdateSize} 币种\n`;
        statusMessage += `⏰ 运行时间: ${cacheStats.uptimeFormatted}\n`;

        if (cacheStats.lastUpdateTime > 0) {
          const lastUpdateAgo = Math.round((Date.now() - cacheStats.lastUpdateTime) / 1000);
          statusMessage += `🕐 最后更新: ${lastUpdateAgo}秒前\n`;
        }

        statusMessage += `\n💡 实时缓存状态: ${realtimeMarketCache.isReady() ? '✅ 就绪' : '⏳ 准备中'}`;

        await ctx.replyWithMarkdown(statusMessage);
      } catch (error) {
        console.error('Cache status error:', error);
        await ctx.reply('❌ 获取缓存状态时发生错误');
      }
    });

    // 实时推送服务状态命令
    this.bot.command('realtime_status', async (ctx) => {
      try {
        const realtimeStatus = realtimeAlertService.getStatus();
        const cacheStatus = realtimeMarketCache.getStats();

        let statusMessage = `⚡ *实时推送服务状态*\n\n`;

        statusMessage += `🔄 服务状态: ${realtimeStatus.enabled ? '✅ 运行中' : '❌ 已停止'}\n`;
        statusMessage += `📊 数据源: ${cacheStatus.isConnected ? '✅ WebSocket连接正常' : '❌ WebSocket断开'}\n`;
        statusMessage += `💾 缓存状态: ${cacheStatus.totalSymbols > 0 ? `✅ ${cacheStatus.totalSymbols}个币种` : '⏳ 初始化中'}\n\n`;

        statusMessage += `🎯 *推送配置:*\n`;
        statusMessage += `• 新进入阈值: ${realtimeStatus.config.minGainPercent}%\n`;
        statusMessage += `• 变动阈值: ${realtimeStatus.config.majorMoveThreshold}位\n`;
        statusMessage += `• 冷却时间: ${realtimeStatus.config.pushCooldownMs / 1000 / 60}分钟\n`;
        statusMessage += `• 频率限制: ${realtimeStatus.config.maxPushPerSymbol}次/冷却期\n\n`;

        statusMessage += `📈 *推送统计:*\n`;
        statusMessage += `• 推送记录: ${realtimeStatus.totalPushRecords}个币种\n`;
        statusMessage += `• 冷却中: ${realtimeStatus.activeCooldowns}个币种\n`;

        if (realtimeStatus.cooldownSymbols.length > 0) {
          const symbols = realtimeStatus.cooldownSymbols.slice(0, 5).join(', ');
          statusMessage += `• 冷却币种: ${symbols}${realtimeStatus.cooldownSymbols.length > 5 ? '...' : ''}\n`;
        }

        statusMessage += `\n💡 实时推送${realtimeStatus.enabled ? '正常运行' : '等待启动'}`;

        await ctx.replyWithMarkdown(statusMessage);
      } catch (error) {
        console.error('Realtime status error:', error);
        await ctx.reply('❌ 获取实时推送状态时发生错误');
      }
    });

    // 时间段涨幅榜
    this.bot.command('gainers_period', async (ctx) => {
      try {
        const messageText = ctx.message?.text || '';
        const args = messageText.split(' ').slice(1); // Remove command name

        if (args.length === 0) {
          await ctx.replyWithMarkdown(
            `📊 *时间段涨幅榜使用说明*\n\n` +
            `用法: \`/gainers_period <时间段> [数量]\`\n\n` +
            `支持的时间段：\n` +
            `• \`5m\` - 5分钟\n` +
            `• \`15m\` - 15分钟\n` +
            `• \`30m\` - 30分钟\n` +
            `• \`1h\` - 1小时\n` +
            `• \`4h\` - 4小时\n` +
            `• \`12h\` - 12小时\n` +
            `• \`3d\` - 3天\n` +
            `• \`1w\` - 1周\n\n` +
            `示例：\n` +
            `\`/gainers_period 1h\` - 1小时涨幅榜前10\n` +
            `\`/gainers_period 5m 5\` - 5分钟涨幅榜前5\n` +
            `\`/gainers_period 3d 15\` - 3天涨幅榜前15`
          );
          return;
        }

        const period = args[0]?.toLowerCase();
        const limit = args[1] ? Math.min(Math.max(parseInt(args[1]), 1), 20) : 10;

        // Validate period
        const validPeriods = ['5m', '15m', '30m', '1h', '4h', '12h', '3d', '1w'];
        if (!validPeriods.includes(period)) {
          await ctx.reply(`❌ 不支持的时间段: ${period}\n支持的时间段: ${validPeriods.join(', ')}`);
          return;
        }

        // Get period display name
        const periodNames: { [key: string]: string } = {
          '5m': '5分钟',
          '15m': '15分钟',
          '30m': '30分钟',
          '1h': '1小时',
          '4h': '4小时',
          '12h': '12小时',
          '3d': '3天',
          '1w': '1周'
        };

        // 24小时数据提示使用更快的/gainers命令
        if (period === '1d' || period === '24h') {
          await ctx.reply(`💡 查询24小时数据建议使用 /gainers 命令，响应更快！\n📊 继续查询${periodNames[period]}涨幅榜...`);
        } else {
          await ctx.reply(`📊 正在查询${periodNames[period]}涨幅榜...`);
        }

        let queryTime = Date.now();

        // Get all futures symbols
        const allSymbols = await this.binanceClient.getFuturesTradingSymbols();
        const validSymbols = filterTradingPairs(allSymbols);

        // Get period stats
        const periodStats = await this.binanceClient.getFuturesPeriodStats(validSymbols, period);

        if (periodStats.length === 0) {
          await ctx.reply('❌ 未获取到数据，请稍后重试');
          return;
        }

        // Filter and sort by price change percentage (gainers only)
        const gainers = periodStats
          .filter(stat => stat.priceChangePercent > 0)
          .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
          .slice(0, limit);

        if (gainers.length === 0) {
          await ctx.reply(`📊 ${periodNames[period]}内暂无上涨的币种`);
          return;
        }

        let message = `🚀 *${periodNames[period]}涨幅榜 TOP${gainers.length}*\n\n`;

        const priceFormatPromises = gainers.map(async (stat, index) => {
          const symbol = stat.symbol.replace('USDT', '');
          const change = formatPriceChange(stat.priceChangePercent);
          const formattedPrice = await formatPriceWithSeparators(stat.currentPrice, stat.symbol);
          const riskLevel = getTokenRiskLevel(stat.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          return `${index + 1}. ${riskIcon}**${symbol}** +${change}% ($${formattedPrice})\n`;
        });

        const formattedEntries = await Promise.all(priceFormatPromises);
        formattedEntries.forEach(entry => {
          message += entry;
        });

        // Calculate time range for display
        const now = new Date();
        let intervalMs = 0;
        switch (period) {
          case '5m': intervalMs = 5 * 60 * 1000; break;
          case '15m': intervalMs = 15 * 60 * 1000; break;
          case '30m': intervalMs = 30 * 60 * 1000; break;
          case '1h': intervalMs = 60 * 60 * 1000; break;
          case '4h': intervalMs = 4 * 60 * 60 * 1000; break;
          case '12h': intervalMs = 12 * 60 * 60 * 1000; break;
          case '3d': intervalMs = 3 * 24 * 60 * 60 * 1000; break;
          case '1w': intervalMs = 7 * 24 * 60 * 60 * 1000; break;
        }

        const startTime = new Date(now.getTime() - intervalMs);
        const timeRange = `${formatTimeToUTC8(startTime).slice(5)} - ${formatTimeToUTC8(now).slice(5)}`;

        message += `\n🕐 统计时间: ${timeRange}`;
        message += `\n⏰ 查询时间: ${formatTimeToUTC8(new Date())}`;
        message += `\n📊 数据来源: 📡 K线数据`;
        message += `\n⚡ 查询耗时: ${Date.now() - queryTime}ms`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('Period gainers query error:', error);
        await ctx.reply('❌ 查询时间段涨幅榜失败，请稍后重试');
      }
    });

    // 24小时跌幅榜 - 优化版本使用实时缓存
    this.bot.command('losers', async (ctx) => {
      try {
        await ctx.reply('📉 正在查询24小时跌幅榜...');

        let losers;
        let dataSource = '';
        let queryTime = Date.now();

        // 优先使用实时缓存数据
        if (realtimeMarketCache.isReady()) {
          log.debug('Using realtime cache for losers query');
          const realtimeLosers = realtimeMarketCache.getTopLosers(10, 10000);

          if (realtimeLosers.length > 0) {
            losers = realtimeLosers.map(data => ({
              symbol: data.symbol,
              priceChangePercent: data.priceChangePercent.toString(),
              lastPrice: data.price.toString(),
              volume: data.volume.toString()
            }));
            dataSource = '⚡ 实时数据';
            log.info(`Losers query served from realtime cache in ${Date.now() - queryTime}ms`);
          }
        }

        // Fallback 到 REST API
        if (!losers || losers.length === 0) {
          log.debug('Using REST API fallback for losers query');
          dataSource = '📡 API数据';

          // 🔥 Trigger real-time ranking analysis to capture sudden movers
          await rankingAnalyzer.analyzeRankings('user-query');

          // Use tiered data manager for optimized data fetching
          const allSymbols = await this.binanceClient.getFuturesTradingSymbols();
          const validSymbols = filterTradingPairs(allSymbols);
          const allStatsMap = await tieredDataManager.getBatchTickers(validSymbols);
          const allStats = Array.from(allStatsMap.values());

          // 过滤交易对并按跌幅排序，取前10
          losers = allStats
            .filter(stat => {
              return parseFloat(stat.priceChangePercent) < 0 &&
                     validSymbols.includes(stat.symbol) &&
                     parseFloat(stat.volume) > 10000; // 过滤交易量过低的代币
            })
            .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
            .slice(0, 10);

          log.info(`Losers query served from REST API in ${Date.now() - queryTime}ms`);
        }

        let message = `📉 *24小时跌幅榜 TOP10*\n\n`;
        
        const priceFormatPromisesLosers = losers.map(async (stat, index) => {
          const symbol = stat.symbol.replace('USDT', '');
          const change = formatPriceChange(parseFloat(stat.priceChangePercent));
          const formattedPrice = await formatPriceWithSeparators(stat.lastPrice, stat.symbol);
          const riskLevel = getTokenRiskLevel(stat.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          return `${index + 1}. ${riskIcon}**${symbol}** ${change}% ($${formattedPrice})\n`;
        });

        const formattedEntriesLosers = await Promise.all(priceFormatPromisesLosers);
        formattedEntriesLosers.forEach(entry => {
          message += entry;
        });

        message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;
        message += `\n📊 数据来源: ${dataSource}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('Losers query error:', error);
        await ctx.reply('❌ 查询跌幅榜失败');
      }
    });

    // 负费率排行榜
    this.bot.command('funding', async (ctx) => {
      try {
        console.log('🚀 Starting funding rates query...');
        await ctx.reply('⚡ 正在查询资金费率排行榜...');

        // 🔥 Trigger real-time ranking analysis to capture sudden movers
        await rankingAnalyzer.analyzeRankings('user-query');

        console.log('📡 Calling getAllFundingRates...');
        const fundingRates = await this.binanceClient.getAllFundingRates();
        console.log('✅ Raw funding rates received:', fundingRates.length);
        console.log('📊 Sample funding rates:', JSON.stringify(fundingRates.slice(0, 3), null, 2));
        
        // 过滤交易对并去重
        console.log('🔍 Filtering trading pairs...');
        const allSymbols = fundingRates.map(r => r.symbol);
        console.log('📋 All symbols count:', allSymbols.length);
        
        const validSymbols = filterTradingPairs(allSymbols);
        console.log('✅ Valid symbols count:', validSymbols.length);
        console.log('📝 Sample valid symbols:', validSymbols.slice(0, 10));
        
        console.log('🔄 Deduplicating rates...');
        const filteredRates = fundingRates
          .filter(rate => validSymbols.includes(rate.symbol))
          .reduce((acc, rate) => {
            // 使用Map去重，保留第一个出现的
            const key = rate.symbol;
            if (!acc.has(key)) {
              acc.set(key, rate);
            } else {
              console.log(`⚠️ Duplicate symbol found: ${key}`);
            }
            return acc;
          }, new Map());

        console.log('✅ Filtered rates map size:', filteredRates.size);
        
        // 只显示负费率并排序
        console.log('📊 Filtering negative rates and sorting...');
        const allRates = Array.from(filteredRates.values());
        const negativeRates = allRates.filter(rate => parseFloat(rate.fundingRate) < 0);
        console.log('🔴 Negative rates count:', negativeRates.length);
        
        const sortedRates = negativeRates
          .sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate))
          .slice(0, 15);

        console.log('✅ Final sorted rates count:', sortedRates.length);
        console.log('📈 Top 5 negative rates:', sortedRates.slice(0, 5).map(r => `${r.symbol}: ${r.fundingRate}`));
        
        console.log('📝 Building message with prices...');
        let message = `⚡ *负费率排行榜*\n\n`;
        
        // Get prices for all symbols
        const pricePromises = sortedRates.map(async (rate, index) => {
          const symbol = rate.symbol.replace('USDT', '');
          const riskLevel = getTokenRiskLevel(rate.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          const fundingPercent = (parseFloat(rate.fundingRate) * 100).toFixed(4);
          const icon = parseFloat(rate.fundingRate) < 0 ? '🔴' : '🟢';
          
          // Get current price
          let priceText = '';
          try {
            const currentPrice = await this.binanceClient.getFuturesPrice(rate.symbol);
            const formattedPrice = await formatPriceWithSeparators(currentPrice, rate.symbol);
            priceText = ` ($${formattedPrice})`;
          } catch (error) {
            console.log(`❌ Failed to get price for ${rate.symbol}:`, error instanceof Error ? error.message : 'Unknown error');
            priceText = '';
          }
          
          return `${index + 1}. ${icon} ${riskIcon}**${symbol}** ${fundingPercent}%${priceText}\n`;
        });

        const formattedEntries = await Promise.all(pricePromises);
        formattedEntries.forEach(entry => {
          message += entry;
        });

        message += `\n💡 负费率(红色)表示空头支付多头\n`;
        message += `⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;

        console.log('📤 Sending response message...');
        await ctx.replyWithMarkdown(message);
        console.log('✅ Funding rates command completed successfully');
      } catch (error) {
        console.error('❌ Funding rates query error:', error);
        console.error('❌ Error details:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          name: error instanceof Error ? error.name : 'Unknown'
        });
        await ctx.reply('❌ 查询资金费率排行榜失败');
      }
    });

    // 持仓量增长榜 (24小时)
    this.bot.command('oi24h', async (ctx) => {
      try {
        await ctx.reply('📈 正在查询24小时持仓量增长榜...');

        // 获取活跃合约列表
        const symbols = await this.binanceClient.getFuturesTradingSymbols();
        
        // 过滤有效交易对，使用tokenLists.ts中的黑白名单
        const validSymbols = filterTradingPairs(symbols);

        // Use batch processing for better performance
        const oiData = await this.binanceClient.getBatchOpenInterestStats(
          validSymbols, 
          '1h', 
          24, // 24 data points for 24 hours
          30, // batch size (reduced)
          3000 // delay between batches (increased)
        );

        const oiResults = [];
        for (const [symbol, oiStats] of oiData.entries()) {
          if (oiStats && oiStats.length >= 12) { // 至少需要12小时的数据
            // 正确的时间顺序：oiStats[0] = 24小时前, oiStats[length-1] = 最新
            const current = parseFloat(oiStats[oiStats.length - 1].sumOpenInterestValue);
            const previous = parseFloat(oiStats[0].sumOpenInterestValue);
            
            if (current > 0 && previous > 0) {
              const change = ((current - previous) / previous) * 100;
              // 过滤异常数据
              if (Math.abs(change) < 500) {
                oiResults.push({
                  symbol: symbol.replace('USDT', ''),
                  change,
                  currentOI: current / 1000000,
                  dataPoints: oiStats.length
                });
              }
            }
          }
        }

        const sortedResults = oiResults
          .sort((a, b) => b.change - a.change)
          .slice(0, 10);

        let message = `📈 *24小时持仓量增长榜*\n\n`;
        
        sortedResults.forEach((result, index) => {
          const changeIcon = result.change >= 0 ? '📈' : '📉';
          message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
        });

        message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;
        message += `\n📊 成功查询 ${oiData.size}/${validSymbols.length} 个交易对`;

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
        const validSymbols = filterTradingPairs(symbols);

        // Use batch processing for better performance
        const oiData = await this.binanceClient.getBatchOpenInterestStats(
          validSymbols, 
          '1h', 
          4, // 4 data points for 4 hours (1h intervals)
          30, // batch size (reduced)
          3000 // delay between batches (increased)
        );

        const oiResults = [];
        for (const [symbol, oiStats] of oiData.entries()) {
          if (oiStats && oiStats.length >= 4) {
            // 正确的时间顺序：oiStats[0] = 4小时前, oiStats[length-1] = 最新
            const current = parseFloat(oiStats[oiStats.length - 1].sumOpenInterestValue);
            const previous = parseFloat(oiStats[0].sumOpenInterestValue);
            
            if (current > 0 && previous > 0) {
              const change = ((current - previous) / previous) * 100;
              // 过滤异常数据
              if (Math.abs(change) < 200) {
                oiResults.push({
                  symbol: symbol.replace('USDT', ''),
                  change,
                  currentOI: current / 1000000
                });
              }
            }
          }
        }

        const sortedResults = oiResults
          .sort((a, b) => b.change - a.change)
          .slice(0, 10);

        let message = `📈 *4小时持仓量增长榜*\n\n`;
        
        sortedResults.forEach((result, index) => {
          const changeIcon = result.change >= 0 ? '📈' : '📉';
          message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
        });

        message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;
        message += `\n📊 成功查询 ${oiData.size}/${validSymbols.length} 个交易对`;

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
        const validSymbols = filterTradingPairs(symbols);

        // Use batch processing for better performance
        const oiData = await this.binanceClient.getBatchOpenInterestStats(
          validSymbols, 
          '15m', 
          4, // 4 data points for 1 hour (15min intervals)
          30, // batch size (reduced)
          3000 // delay between batches (increased)
        );

        const oiResults = [];
        for (const [symbol, oiStats] of oiData.entries()) {
          if (oiStats && oiStats.length >= 4) {
            // 正确的时间顺序：oiStats[0] = 1小时前, oiStats[length-1] = 最新
            const current = parseFloat(oiStats[oiStats.length - 1].sumOpenInterestValue);
            const previous = parseFloat(oiStats[0].sumOpenInterestValue);
            
            if (current > 0 && previous > 0) {
              const change = ((current - previous) / previous) * 100;
              oiResults.push({
                symbol: symbol.replace('USDT', ''),
                change,
                currentOI: current / 1000000 // Convert to millions for readability
              });
            }
          }
        }

        const sortedResults = oiResults
          .sort((a, b) => b.change - a.change)
          .slice(0, 10);

        let message = `📈 *1小时持仓量增长榜*\n\n`;
        
        sortedResults.forEach((result, index) => {
          const changeIcon = result.change >= 0 ? '📈' : '📉';
          message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
        });

        message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;
        message += `\n📊 成功查询 ${oiData.size}/${validSymbols.length} 个交易对`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('OI 1h query error:', error);
        await ctx.reply('❌ 查询1小时持仓量增长榜失败');
      }
    });

    // 创建价格提醒命令
    this.bot.command('alert', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        
        if (!args || args.length < 3) {
          await ctx.reply('💡 请使用正确的格式:\n/alert btc > 50000\n/alert eth < 3000\n\n支持的操作符: >, <, >=, <=');
          return;
        }

        const symbol = args[0].toUpperCase();
        const operator = args[1];
        const value = parseFloat(args[2]);

        // 验证操作符
        if (!['>', '<', '>=', '<='].includes(operator)) {
          await ctx.reply('❌ 不支持的操作符，请使用: >, <, >=, <=');
          return;
        }

        // 验证数值
        if (isNaN(value) || value <= 0) {
          await ctx.reply('❌ 请输入有效的价格数值');
          return;
        }

        // 检查是否是已下架代币
        const testSymbol = symbol.includes('USDT') ? symbol : symbol + 'USDT';
        const riskLevel = getTokenRiskLevel(testSymbol);
        if (riskLevel === 'delisted' || riskLevel === 'blacklist') {
          await ctx.reply(`❌ ${symbol} 已被列入${riskLevel === 'delisted' ? '已下架' : '黑名单'}代币，不支持设置提醒`);
          return;
        }

        // 获取当前价格验证
        let currentPrice: number | undefined;
        let actualSymbol = symbol;
        const suffixes = ['USDT', 'BUSD', 'BTC', 'ETH'];
        let found = false;

        for (const suffix of suffixes) {
          if (symbol.includes(suffix)) {
            actualSymbol = symbol;
            break;
          }
          
          actualSymbol = symbol + suffix;
          
          try {
            // 优先尝试合约价格
            currentPrice = await this.binanceClient.getFuturesPrice(actualSymbol);
            found = true;
            break;
          } catch (futuresError) {
            try {
              currentPrice = await this.binanceClient.getPrice(actualSymbol);
              found = true;
              break;
            } catch (spotError) {
              continue;
            }
          }
        }

        if (!found || !currentPrice) {
          await ctx.reply(`❌ 无法找到 ${symbol} 的价格数据，请检查币种名称是否正确`);
          return;
        }

        // 转换操作符为数据库条件
        let condition: 'above' | 'below';
        if (operator === '>' || operator === '>=') {
          condition = 'above';
        } else {
          condition = 'below';
        }

        // 创建提醒
        const userId = ctx.from?.id.toString()!;
        const alertId = await PriceAlertModel.createAlert(userId, actualSymbol, condition, value);

        const riskIcon = getRiskIcon(riskLevel);
        const conditionText = operator === '>=' ? '≥' : operator === '<=' ? '≤' : operator;
        
        const alertMessage = `
✅ *价格提醒创建成功*

🔔 提醒ID: #${alertId}
${riskIcon} 币种: ${symbol}
📊 条件: 当价格 ${conditionText} $${value.toLocaleString()}
💰 当前价格: $${currentPrice.toLocaleString()}
⏰ 创建时间: ${formatTimeToUTC8(new Date())}

📱 触发时将通过机器人通知您`;

        await ctx.replyWithMarkdown(alertMessage);
        
      } catch (error) {
        console.error('Alert creation error:', error);
        await ctx.reply('❌ 创建价格提醒失败，请稍后重试');
      }
    });

    // 查看提醒列表命令
    this.bot.command('alerts', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        const alerts = await PriceAlertModel.getActiveAlerts(userId);

        if (alerts.length === 0) {
          await ctx.reply('📭 您还没有创建任何价格提醒\n\n💡 使用 /alert btc > 50000 创建提醒');
          return;
        }

        let message = `🔔 *您的活跃价格提醒 (${alerts.length}个)*\n\n`;

        // 获取当前价格来显示状态
        for (let i = 0; i < alerts.length; i++) {
          const alert = alerts[i];
          const symbol = alert.symbol.replace('USDT', '');
          const riskLevel = getTokenRiskLevel(alert.symbol);
          const riskIcon = getRiskIcon(riskLevel);
          
          let currentPrice: number | undefined;
          try {
            currentPrice = await this.binanceClient.getFuturesPrice(alert.symbol);
          } catch {
            try {
              currentPrice = await this.binanceClient.getPrice(alert.symbol);
            } catch {
              // 无法获取价格
            }
          }

          const conditionText = alert.condition === 'above' ? '>' : '<';
          const targetPrice = alert.value.toLocaleString();
          const currentPriceText = currentPrice ? `$${currentPrice.toLocaleString()}` : '获取失败';
          
          message += `${i + 1}. ${riskIcon}*${symbol}* (#${alert.id})\n`;
          message += `   条件: 价格 ${conditionText} $${targetPrice}\n`;
          message += `   当前: ${currentPriceText}\n`;
          message += `   创建: ${formatTimeToUTC8(new Date(alert.created_at))}\n\n`;
        }

        message += `💡 使用 /remove_alert <ID> 删除指定提醒\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;

        await ctx.reply(message);
        
      } catch (error) {
        console.error('Alerts list error:', error);
        await ctx.reply('❌ 获取提醒列表失败，请稍后重试');
      }
    });

    // OI 持仓量查询命令
    this.bot.command('oi', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        
        if (!args || args.length === 0) {
          await ctx.reply('💡 请指定代币符号，例如: /oi BTC 或 /oi ETHUSDT');
          return;
        }

        let symbol = args[0].toUpperCase();
        
        // 处理各种符号格式 - 为所有不完整的符号添加USDT后缀
        if (!symbol.includes('USDT') && !symbol.includes('BUSD')) {
          // 特殊处理：BTC和ETH需要添加USDT后缀
          if (symbol === 'BTC' || symbol === 'ETH') {
            symbol = `${symbol}USDT`;
          } else if (!symbol.endsWith('BTC') && !symbol.endsWith('ETH')) {
            // 对于其他不以BTC或ETH结尾的符号，添加USDT
            symbol = `${symbol}USDT`;
          }
        }

        // 检查代币风险级别
        const riskLevel = getTokenRiskLevel(symbol);
        if (riskLevel === 'blacklist') {
          await ctx.reply(`🚫 ${symbol} 已被列入黑名单，不支持查询`);
          return;
        }

        const riskIcon = getRiskIcon(riskLevel);
        
        // 获取当前价格
        let currentPrice: number | undefined;
        try {
          currentPrice = await this.binanceClient.getFuturesPrice(symbol);
        } catch {
          try {
            currentPrice = await this.binanceClient.getPrice(symbol);
          } catch {
            await ctx.reply(`❌ 无法获取 ${symbol} 的价格数据，请检查符号是否正确`);
            return;
          }
        }

        // 获取不同时间周期的OI数据
        const [oi1h, oi4h, oi24h] = await Promise.all([
          this.binanceClient.getOpenInterestStats(symbol, '15m', 4),  // 1小时
          this.binanceClient.getOpenInterestStats(symbol, '1h', 4),   // 4小时
          this.binanceClient.getOpenInterestStats(symbol, '1h', 24)   // 24小时
        ]);

        // 计算变化百分比
        const calculate1hChange = () => {
          if (oi1h.length < 2) return null;
          const current = parseFloat(oi1h[oi1h.length - 1].sumOpenInterestValue);
          const previous = parseFloat(oi1h[0].sumOpenInterestValue);
          return ((current - previous) / previous) * 100;
        };

        const calculate4hChange = () => {
          if (oi4h.length < 2) return null;
          const current = parseFloat(oi4h[oi4h.length - 1].sumOpenInterestValue);
          const previous = parseFloat(oi4h[0].sumOpenInterestValue);
          return ((current - previous) / previous) * 100;
        };

        const calculate24hChange = () => {
          if (oi24h.length < 2) return null;
          const current = parseFloat(oi24h[oi24h.length - 1].sumOpenInterestValue);
          const previous = parseFloat(oi24h[0].sumOpenInterestValue);
          return ((current - previous) / previous) * 100;
        };

        const change1h = calculate1hChange();
        const change4h = calculate4hChange();
        const change24h = calculate24hChange();

        // 获取当前OI值
        const currentOI = oi24h.length > 0 ? parseFloat(oi24h[oi24h.length - 1].sumOpenInterestValue) : 0;
        const formattedPrice = await formatPriceWithSeparators(currentPrice!, symbol);

        // 构建回复消息
        let message = `📊 *${symbol.replace('USDT', '')} OI持仓数据* ${riskIcon}\n\n`;
        message += `💰 当前价格: $${formattedPrice}\n`;
        message += `📊 当前持仓量: ${(currentOI / 1000000).toFixed(2)}M USDT\n\n`;

        message += `📈 *持仓变化趋势:*\n`;
        if (change1h !== null) {
          const icon1h = change1h >= 0 ? '📈' : '📉';
          message += `${icon1h} 1小时: ${change1h >= 0 ? '+' : ''}${change1h.toFixed(2)}%\n`;
        } else {
          message += `⚠️ 1小时: 数据不足\n`;
        }

        if (change4h !== null) {
          const icon4h = change4h >= 0 ? '📈' : '📉';
          message += `${icon4h} 4小时: ${change4h >= 0 ? '+' : ''}${change4h.toFixed(2)}%\n`;
        } else {
          message += `⚠️ 4小时: 数据不足\n`;
        }

        if (change24h !== null) {
          const icon24h = change24h >= 0 ? '📈' : '📉';
          message += `${icon24h} 24小时: ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%\n\n`;
        } else {
          message += `⚠️ 24小时: 数据不足\n\n`;
        }

        // 添加风险提示
        if (riskLevel === 'yellowlist') {
          message += `⚠️ *风险提示: 该代币波动性较高，请谨慎交易*\n\n`;
        }

        message += `⏰ 查询时间: ${formatTimeToUTC8(new Date())}`;

        await ctx.replyWithMarkdown(message);

      } catch (error) {
        console.error('OI query error:', error);
        await ctx.reply('❌ 获取OI数据失败，请稍后重试或检查代币符号是否正确');
      }
    });

    // 删除提醒命令
    this.bot.command('remove_alert', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        
        if (!args || args.length === 0) {
          await ctx.reply('💡 请指定要删除的提醒ID，例如: /remove_alert 5');
          return;
        }

        const alertId = parseInt(args[0]);
        
        if (isNaN(alertId) || alertId <= 0) {
          await ctx.reply('❌ 请输入有效的提醒ID数字');
          return;
        }

        // 验证提醒是否存在且属于当前用户
        const userId = ctx.from?.id.toString()!;
        const userAlerts = await PriceAlertModel.getActiveAlerts(userId);
        const alertToRemove = userAlerts.find(alert => alert.id === alertId);

        if (!alertToRemove) {
          await ctx.reply('❌ 未找到指定的提醒，请检查提醒ID是否正确');
          return;
        }

        // 删除提醒
        await PriceAlertModel.deactivateAlert(alertId);

        const symbol = alertToRemove.symbol.replace('USDT', '');
        const conditionText = alertToRemove.condition === 'above' ? '>' : '<';
        
        const confirmMessage = `
✅ *价格提醒删除成功*

🗑️ 已删除提醒: #${alertId}
💰 币种: ${symbol}
📊 条件: 价格 ${conditionText} $${alertToRemove.value.toLocaleString()}
⏰ 删除时间: ${formatTimeToUTC8(new Date())}`;

        await ctx.replyWithMarkdown(confirmMessage);
        
      } catch (error) {
        console.error('Remove alert error:', error);
        await ctx.reply('❌ 删除价格提醒失败，请稍后重试');
      }
    });

    // 启动涨幅榜推送
    this.bot.command('start_gainers_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Enable gainers alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'gainers', true);
        
        // 实时推送服务已在启动时自动启用，这里仅需确认状态
        const serviceStatus = realtimeAlertService.getStatus();

        const message = `🚀 *实时涨幅榜推送已启动*

📈 推送状态: ${serviceStatus.enabled ? '✅ 已启用' : '⚡ 启动中'}
⏰ 启动时间: ${formatTimeToUTC8(new Date())}

🎯 *智能推送策略:*
• 新进入前10且涨幅≥10%
• 排名变化≥3位
• 同一币种10分钟内最多推送2次

⚡ *实时响应:* 基于WebSocket数据流
📊 *数据源:* 币安期货实时数据

💡 您将在涨幅榜发生重要变化时立即收到推送
🛑 使用 /stop_gainers_push 停止推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Start gainers push error:', error);
        await ctx.reply('❌ 启动涨幅榜推送失败，请稍后重试');
      }
    });

    // 停止涨幅榜推送
    this.bot.command('stop_gainers_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Disable gainers alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'gainers', false);
        
        const message = `⏹️ *实时涨幅榜推送已停止*

📈 推送状态: 已关闭（仅对您关闭）
⏰ 停止时间: ${formatTimeToUTC8(new Date())}

💡 *说明:*
• 实时推送服务继续运行
• 您将不再收到涨幅榜推送通知
• 使用 /start_gainers_push 重新启动推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Stop gainers push error:', error);
        await ctx.reply('❌ 停止涨幅榜推送失败，请稍后重试');
      }
    });

    // 启动负费率推送
    this.bot.command('start_funding_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Enable funding alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'funding', true);
        
        // Start funding monitoring if not already running
        await triggerAlertService.startFundingMonitoring();
        
        const message = `✅ *负费率榜推送已启动*

💰 监控设置:
• 检查间隔: 1分钟 (测试模式)
• 推送条件: 新币进入前10或排名显著变化
• 状态: 已启用

💡 您将在负费率榜发生重要变化时收到推送通知
🛑 使用 /stop_funding_push 停止推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Start funding push error:', error);
        await ctx.reply('❌ 启动负费率推送失败，请稍后重试');
      }
    });

    // 停止负费率推送
    this.bot.command('stop_funding_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Disable funding alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'funding', false);
        
        const message = `⏹️ *负费率榜推送已停止*

💰 推送状态: 已关闭
⏰ 停止时间: ${formatTimeToUTC8(new Date())}

💡 使用 /start_funding_push 重新启动推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Stop funding push error:', error);
        await ctx.reply('❌ 停止负费率推送失败，请稍后重试');
      }
    });

    // 启动OI 1h推送
    this.bot.command('start_oi1h_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Enable OI 1h alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'oi1h', true);
        
        // Start OI 1h monitoring if not already running
        await triggerAlertService.startOI1hMonitoring();
        
        const message = `✅ *OI 1小时推送已启动*

📊 监控设置:
• 检查间隔: 3分钟
• 推送条件: 新币进入前10或持仓量显著变化 (>5%)
• 状态: 已启用

💡 您将在OI 1小时榜发生重要变化时收到推送通知

🛑 使用 /stop_oi1h_push 停止推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Start OI 1h push error:', error);
        await ctx.reply('❌ 启动OI 1小时推送失败，请稍后重试');
      }
    });

    // 停止OI 1h推送
    this.bot.command('stop_oi1h_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Disable OI 1h alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'oi1h', false);
        
        const message = `⏹️ *OI 1小时推送已停止*

📊 推送状态: 已关闭
⏰ 停止时间: ${formatTimeToUTC8(new Date())}

💡 使用 /start_oi1h_push 重新启动推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Stop OI 1h push error:', error);
        await ctx.reply('❌ 停止OI 1小时推送失败，请稍后重试');
      }
    });

    // 启动OI 4h推送
    this.bot.command('start_oi4h_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Enable OI 4h alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'oi4h', true);
        
        // Start OI 4h monitoring if not already running
        await triggerAlertService.startOI4hMonitoring();
        
        const message = `✅ *OI 4小时推送已启动*

📊 监控设置:
• 检查间隔: 15分钟
• 推送条件: 新币进入前10或持仓量显著变化 (>5%)
• 状态: 已启用

💡 您将在OI 4小时榜发生重要变化时收到推送通知

🛑 使用 /stop_oi4h_push 停止推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Start OI 4h push error:', error);
        await ctx.reply('❌ 启动OI 4小时推送失败，请稍后重试');
      }
    });

    // 停止OI 4h推送
    this.bot.command('stop_oi4h_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Disable OI 4h alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'oi4h', false);
        
        const message = `⏹️ *OI 4小时推送已停止*

📊 推送状态: 已关闭
⏰ 停止时间: ${formatTimeToUTC8(new Date())}

💡 使用 /start_oi4h_push 重新启动推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Stop OI 4h push error:', error);
        await ctx.reply('❌ 停止OI 4小时推送失败，请稍后重试');
      }
    });

    // 启动OI 24h推送
    this.bot.command('start_oi24h_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Enable OI 24h alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'oi24h', true);
        
        // Start OI 24h monitoring if not already running
        await triggerAlertService.startOI24hMonitoring();
        
        const message = `✅ *OI 24小时推送已启动*

📊 监控设置:
• 检查间隔: 30分钟
• 推送条件: 新币进入前10或持仓量显著变化 (>5%)
• 状态: 已启用

💡 您将在OI 24小时榜发生重要变化时收到推送通知

🛑 使用 /stop_oi24h_push 停止推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Start OI 24h push error:', error);
        await ctx.reply('❌ 启动OI 24小时推送失败，请稍后重试');
      }
    });

    // 停止OI 24h推送
    this.bot.command('stop_oi24h_push', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        
        // Disable OI 24h alerts for user
        await TriggerAlertModel.setTriggerAlert(userId, 'oi24h', false);
        
        const message = `⏹️ *OI 24小时推送已停止*

📊 推送状态: 已关闭
⏰ 停止时间: ${formatTimeToUTC8(new Date())}

💡 使用 /start_oi24h_push 重新启动推送`;

        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Stop OI 24h push error:', error);
        await ctx.reply('❌ 停止OI 24小时推送失败，请稍后重试');
      }
    });

    // 查看推送状态
    this.bot.command('push_status', async (ctx) => {
      try {
        const userId = ctx.from?.id.toString()!;
        const settings = await TriggerAlertModel.getTriggerAlertSettings(userId);
        const stats = triggerAlertService.getStats();
        
        const gainersEnabled = settings.find(s => s.alert_type === 'gainers')?.is_enabled || false;
        const fundingEnabled = settings.find(s => s.alert_type === 'funding')?.is_enabled || false;
        const oi1hEnabled = settings.find(s => s.alert_type === 'oi1h')?.is_enabled || false;
        const oi4hEnabled = settings.find(s => s.alert_type === 'oi4h')?.is_enabled || false;
        const oi24hEnabled = settings.find(s => s.alert_type === 'oi24h')?.is_enabled || false;
        
        let message = `📊 *推送状态总览*\n\n`;
        
        message += `📈 *涨幅榜推送:*\n`;
        message += `• 状态: ${gainersEnabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
        message += `• 监控: ${stats.gainersEnabled ? '🟢 运行中' : '🔴 未运行'}\n`;
        message += `• 最后检查: ${stats.gainersLastCheck ? formatTimeToUTC8(stats.gainersLastCheck) : '从未'}\n\n`;
        
        message += `💰 *负费率榜推送:*\n`;
        message += `• 状态: ${fundingEnabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
        message += `• 监控: ${stats.fundingEnabled ? '🟢 运行中' : '🔴 未运行'}\n`;
        message += `• 最后检查: ${stats.fundingLastCheck ? formatTimeToUTC8(stats.fundingLastCheck) : '从未'}\n\n`;
        
        message += `📊 *OI 1小时推送:*\n`;
        message += `• 状态: ${oi1hEnabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
        message += `• 监控: ${stats.oi1hEnabled ? '🟢 运行中' : '🔴 未运行'}\n`;
        message += `• 最后检查: ${stats.oi1hLastCheck ? formatTimeToUTC8(stats.oi1hLastCheck) : '从未'}\n\n`;
        
        message += `📊 *OI 4小时推送:*\n`;
        message += `• 状态: ${oi4hEnabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
        message += `• 监控: ${stats.oi4hEnabled ? '🟢 运行中' : '🔴 未运行'}\n`;
        message += `• 最后检查: ${stats.oi4hLastCheck ? formatTimeToUTC8(stats.oi4hLastCheck) : '从未'}\n\n`;
        
        message += `📊 *OI 24小时推送:*\n`;
        message += `• 状态: ${oi24hEnabled ? '✅ 已启用' : '❌ 已禁用'}\n`;
        message += `• 监控: ${stats.oi24hEnabled ? '🟢 运行中' : '🔴 未运行'}\n`;
        message += `• 最后检查: ${stats.oi24hLastCheck ? formatTimeToUTC8(stats.oi24hLastCheck) : '从未'}\n\n`;
        
        message += `⏰ 查询时间: ${formatTimeToUTC8(new Date())}`;
        
        await ctx.replyWithMarkdown(message);
        
      } catch (error) {
        console.error('Push status error:', error);
        await ctx.reply('❌ 获取推送状态失败，请稍后重试');
      }
    });

    // Debug命令 - 记录bug和优化建议
    this.bot.command('debug', async (ctx) => {
      try {
        const debugContent = ctx.message.text.replace('/debug', '').trim();
        
        if (!debugContent) {
          await ctx.reply(`🐛 *Debug 使用说明*

使用方法: \`/debug [你的问题描述]\`

例如:
• \`/debug oi4h推送超时问题，需要增加重试机制\`
• \`/debug 价格查询速度太慢\`
• \`/debug 建议添加止损功能\`

你的debug记录会被保存到日志文件中，用于后续分析和改进。`, 
            { parse_mode: 'Markdown' });
          return;
        }

        // 获取上一条消息作为上下文
        const previousMessage = await this.getPreviousMessage(ctx);
        
        // 保存debug记录
        const debugId = await this.debugService.saveDebugRecord({
          timestamp: new Date().toISOString(),
          userId: ctx.from?.id.toString() || 'unknown',
          previousMessage: previousMessage,
          debugContent: debugContent
        });

        await ctx.reply(`🐛 *Debug记录已保存!*

记录ID: \`${debugId}\`
内容: ${debugContent}

你的反馈将用于改进系统，感谢！`, { parse_mode: 'Markdown' });
        
      } catch (error) {
        console.error('Debug command error:', error);
        await ctx.reply('❌ 保存debug记录失败，请稍后重试');
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
   * 获取上一条消息作为debug上下文
   */
  private async getPreviousMessage(ctx: any): Promise<{ type: 'bot_response' | 'user_message'; content: string; messageId?: number }> {
    try {
      // 检查用户是否回复了某条消息
      if (ctx.message.reply_to_message) {
        const repliedMessage = ctx.message.reply_to_message;
        
        return {
          type: repliedMessage.from?.is_bot ? 'bot_response' : 'user_message',
          content: repliedMessage.text || repliedMessage.caption || '(消息内容为空)',
          messageId: repliedMessage.message_id
        };
      }
      
      // 如果没有回复消息，尝试推断上一条消息
      const currentMessageId = ctx.message.message_id;
      
      if (currentMessageId > 1) {
        return {
          type: 'bot_response',
          content: '(建议: 回复特定消息来使用 /debug 获取准确上下文)',
          messageId: currentMessageId - 1
        };
      }
      
      return {
        type: 'user_message',
        content: '(这是第一条消息)'
      };
    } catch (error) {
      console.error('Error getting previous message:', error);
      return {
        type: 'user_message',
        content: '(获取上一条消息失败)'
      };
    }
  }

  /**
   * 设置机器人命令菜单
   */
  private async setupBotMenu(): Promise<void> {
    const commands = [
      { command: 'price', description: '查询加密货币价格 (例: /price btc)' },
      { command: 'gainers', description: '24小时涨幅榜 TOP10' },
      { command: 'gainers_period', description: '自定义时间段涨幅榜 (例: /gainers_period 1h)' },
      { command: 'losers', description: '24小时跌幅榜 TOP10' },
      { command: 'funding', description: '资金费率排行榜' },
      { command: 'oi24h', description: '24小时持仓量增长榜' },
      { command: 'oi4h', description: '4小时持仓量增长榜' },
      { command: 'oi1h', description: '1小时持仓量增长榜' },
      { command: 'alert', description: '创建价格提醒 (例: /alert btc > 50000)' },
      { command: 'alerts', description: '查看所有活跃提醒' },
      { command: 'remove_alert', description: '删除指定提醒 (例: /remove_alert 5)' },
      { command: 'start_gainers_push', description: '启动涨幅榜推送通知' },
      { command: 'stop_gainers_push', description: '停止涨幅榜推送通知' },
      { command: 'start_funding_push', description: '启动负费率榜推送通知' },
      { command: 'stop_funding_push', description: '停止负费率榜推送通知' },
      { command: 'start_oi1h_push', description: '启动OI 1小时推送通知' },
      { command: 'stop_oi1h_push', description: '停止OI 1小时推送通知' },
      { command: 'start_oi4h_push', description: '启动OI 4小时推送通知' },
      { command: 'stop_oi4h_push', description: '停止OI 4小时推送通知' },
      { command: 'start_oi24h_push', description: '启动OI 24小时推送通知' },
      { command: 'stop_oi24h_push', description: '停止OI 24小时推送通知' },
      { command: 'push_status', description: '查看推送通知状态' },
      { command: 'status', description: '查看系统状态' },
      { command: 'cache_status', description: '查看实时数据缓存状态' },
      { command: 'debug', description: '记录bug和优化建议' },
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
      
      // Initialize debug service
      await this.debugService.initialize();
      console.log('🐛 Debug service initialized');
      
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
      const botInfo = await this.bot.telegram.getMe();
      console.log(`🤖 Bot username: @${botInfo.username}`);
      console.log(`👤 Authorized user: ${config.telegram.userId}`);
      
      // Launch bot (this will start the polling) - don't await to avoid blocking
      this.bot.launch();
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
   * 发送消息给指定用户
   */
  async sendMessage(userId: number, message: string, options?: any): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(userId, message, options);
    } catch (error) {
      console.error(`Failed to send message to user ${userId}:`, error);
      throw error;
    }
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

  /**
   * 获取授权用户ID
   */
  getAuthorizedUserId(): number | null {
    try {
      return parseInt(config.telegram.userId, 10);
    } catch {
      return null;
    }
  }
}