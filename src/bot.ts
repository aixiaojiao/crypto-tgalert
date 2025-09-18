import { Telegraf } from 'telegraf';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { BotContext, BotStatus } from './types';
import { BinanceClient } from './services/binance';
import { filterTradingPairs, getTokenRiskLevel, getRiskIcon } from './config/tokenLists';
import { PriceAlertModel as TimeRangeAlertModel } from './models/priceAlertModel';
import { priceAlertService } from './services/priceAlertService';
import { triggerAlertService } from './services/triggerAlerts';
import { formatPriceWithSeparators, formatPriceChange } from './utils/priceFormatter';

// 统一时间格式化函数 - UTC+8时区
function formatTimeToUTC8(date: Date | number): string {
  const dateObj = date instanceof Date ? date : new Date(date);
  return dateObj.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}
import { tieredDataManager } from './services/tieredDataManager';
import { volumeClassifier } from './utils/volumeClassifier';
import { rankingAnalyzer } from './services/rankingAnalyzer';
import { realtimeMarketCache } from './services/realtimeMarketCache';
import { realtimeAlertService } from './services/realtimeAlertService';
import { log } from './utils/logger';
import { NotificationService } from './services/alerts/NotificationService';
import { PersistentAlertService } from './services/alerts/PersistentAlertService';
import { AlertCommandParser } from './utils/alertParser';
import { DebugService } from './services/debugService';

export class TelegramBot {
  private bot: Telegraf<BotContext>;
  private status: BotStatus;
  private binanceClient: BinanceClient;
  private notificationService: NotificationService;
  private unifiedAlertService: PersistentAlertService;
  private debugService: DebugService;

  constructor() {
    this.bot = new Telegraf<BotContext>(config.telegram.botToken);
    this.binanceClient = new BinanceClient();
    this.status = {
      isRunning: false,
      startTime: new Date(),
      commandsProcessed: 0,
      errors: 0
    };

    // Initialize unified alert services
    this.notificationService = new NotificationService(log);
    this.unifiedAlertService = new PersistentAlertService(log, this.notificationService);
    this.debugService = new DebugService();

    this.setupMiddleware();
    this.setupCommands();
    this.setupUnderscoreCommands();
    this.setupErrorHandling();

    // Set telegram bot instance for services
    this.notificationService.setTelegramBot(this);
    triggerAlertService.setTelegramBot(this);
    priceAlertService.setTelegramBot(this);

    // Initialize databases
    TimeRangeAlertModel.initDatabase();

    // Initialize realtime services
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

      // 初始化价格报警服务
      log.info('Initializing price alert service...');
      await priceAlertService.start();
      log.info('Price alert service initialized successfully');

    } catch (error) {
      log.error('Failed to initialize realtime services', error);
      log.warn('Bot will continue with REST API fallback');
    }
  }

  /**
   * 初始化统一警报服务
   */
  async initializeUnifiedAlerts(): Promise<void> {
    try {
      log.info('Initializing unified alert service...');
      await this.unifiedAlertService.initialize();
      log.info('Unified alert service initialized successfully');
    } catch (error) {
      log.error('Failed to initialize unified alert service:', error);
      throw error;
    }
  }

  /**
   * 初始化调试服务
   */
  async initializeDebugService(): Promise<void> {
    try {
      log.info('Initializing debug service...');
      await this.debugService.initialize();
      log.info('Debug service initialized successfully');
    } catch (error) {
      log.error('Failed to initialize debug service:', error);
      throw error;
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
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    this.bot.catch((err, ctx) => {
      console.error('Bot error:', err);
      this.status.errors++;
      if (ctx && ctx.reply) {
        ctx.reply('❌ 处理命令时发生错误，请稍后重试');
      }
    });

    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      this.status.errors++;
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      this.status.errors++;
    });
  }

  /**
   * 启动机器人
   */
  async start(): Promise<void> {
    try {
      // 设置菜单栏命令（在启动前设置）
      await this.setupMenuCommands();

      await this.bot.launch();
      this.status.isRunning = true;

      log.info('Telegram bot started successfully');
    } catch (error) {
      log.error('Failed to start Telegram bot:', error);
      throw error;
    }
  }

  /**
   * 设置菜单栏命令
   */
  private async setupMenuCommands(): Promise<void> {
    try {
      const commands = [
        { command: 'start', description: '🚀 开始使用机器人' },
        { command: 'help', description: '📖 查看完整功能指南' },
        { command: 'price', description: '💰 查询币种价格' },
        { command: 'signals', description: '📊 综合技术分析' },
        { command: 'rank_gainers', description: '📊 查看涨幅排行榜' },
        { command: 'rank_losers', description: '📊 查看跌幅排行榜' },
        { command: 'funding', description: '💰 查看资金费率排行' },
        { command: 'oi_24h', description: '📈 24小时持仓量增长榜' },
        { command: 'alert_list', description: '⚡ 查看我的警报列表' },
        { command: 'start_gainers_push', description: '🔔 开启涨幅推送' },
        { command: 'status', description: '⚙️ 查看系统状态' }
      ];

      console.log('📋 设置菜单命令:', commands);
      await this.bot.telegram.setMyCommands(commands);

      // 验证菜单是否设置成功
      const currentCommands = await this.bot.telegram.getMyCommands();
      console.log('✅ 当前菜单命令:', currentCommands);

      log.info('Menu bar commands configured successfully');
    } catch (error) {
      console.error('❌ 菜单设置失败:', error);
      log.error('Failed to setup menu commands:', error);
    }
  }

  /**
   * 停止机器人
   */
  async stop(): Promise<void> {
    try {
      this.bot.stop();
      this.status.isRunning = false;
      log.info('Telegram bot stopped');
    } catch (error) {
      log.error('Failed to stop Telegram bot:', error);
    }
  }

  /**
   * 发送消息给外部服务
   */
  async sendMessage(chatId: string | number, message: string, options?: any): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        ...options
      });
    } catch (error) {
      log.error('Failed to send message:', error);
      throw error;
    }
  }

  /**
   * 发送消息给授权用户
   */
  async sendToAuthorizedUser(message: string, options?: any): Promise<void> {
    try {
      const authorizedUserId = this.getAuthorizedUserId();
      if (authorizedUserId) {
        await this.sendMessage(authorizedUserId, message, options);
      }
    } catch (error) {
      log.error('Failed to send message to authorized user:', error);
    }
  }

  /**
   * 获取授权用户ID
   */
  getAuthorizedUserId(): string | null {
    return config.telegram.userId || null;
  }

  /**
   * 获取机器人状态
   */
  getStatus(): BotStatus {
    return this.status;
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
• 多时间周期报警 🆕
• 实时涨跌幅推送

💡 *基础命令:*
/help - 查看完整帮助
/status - 查看系统状态
/price btc - 查看BTC价格
/alert btc > 50000 - 添加价格警报 🆕

🤖 机器人已准备就绪！
      `;

      await ctx.replyWithMarkdown(welcomeMessage);
    });


    // 显式帮助命令处理
    this.bot.command('help', async (ctx) => {
      try {
        console.log('📖 处理/help命令...');
        const helpMessage = `📖 Crypto Alert Bot 完整功能指南

💰 价格查询:
/price btc - 查看BTC价格+资金费率+持仓量
/price eth - 查看ETH价格信息

📊 技术分析:
/signals btc - BTC综合技术分析 🆕
/signals eth 1h - ETH 1小时周期技术分析
/signals doge balanced - DOGE平衡策略分析

📊 市场排行:
/rank - 默认涨幅榜 (等同于 /rank_gainers)
/rank_gainers - 涨幅排行榜
/rank_gainers 1h - 1小时涨幅榜
/rank_losers - 跌幅排行榜
/rank_losers 4h - 4小时跌幅榜
/funding - 资金费率排行 (负费率=做空付费)
/oi_24h, /oi_4h, /oi_1h - 持仓量增长榜

⚡ 智能警报系统:
🔸 价格警报:
/alert btc > 50000 - BTC价格突破50000时提醒
/alert eth < 3000 - ETH价格跌破3000时提醒
/alert doge change 5% - DOGE价格变化超过5%时提醒

🔸 急涨急跌警报 (核心功能):
/alert_5m_gain_3_all - 5分钟涨3%全币监控
/alert_1h_loss_5_btc - 1小时跌5%BTC监控
/alert_15m_all_2_all - 15分钟涨跌2%全币监控
格式: /alert_[时间]_[方向]_[百分比]_[币种]
时间: 1m,5m,15m,30m,1h,4h,24h,3d
方向: gain(涨),loss(跌),all(涨跌)
币种: btc,eth,all(全部)等

🔸 警报管理:
/alert_list - 查看所有警报
/alert_remove <ID> - 删除价格警报
/alert_remove T<ID> - 删除急涨急跌警报
/alert_toggle <ID> - 启用/禁用警报

🔔 推送服务:
/start_gainers_push - 开启涨幅推送(自动推送Top10)
/start_funding_push - 开启费率推送
/stop_all_push - 停止所有推送

📈 历史分析:
/high btc 1w - BTC一周高点
/near_high 1m - 接近月高点币种

⚙️ 系统:
/status - 系统状态
/cache_status - 缓存状态
/help - 显示帮助

💡 使用提示:
• 所有命令支持直接点击执行
• 警报系统支持两种类型统一管理
• 推送服务可独立开关
• 支持多币种同时监控`;

        console.log('📤 发送/help消息...');
        await ctx.reply(helpMessage);
        console.log('✅ /help消息发送成功');
      } catch (error) {
        console.error('❌ /help命令处理失败:', error);
        await ctx.reply('❌ 帮助信息加载失败，请稍后重试');
      }
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

    // 旧命令迁移提示
    this.bot.command('gainers', async (ctx) => {
      await ctx.reply(
        '🔄 *命令已优化升级*\n\n' +
        '`/gainers` 命令已整合到新的 `/rank` 命令中，功能更强大！\n\n' +
        '📊 *新用法:*\n' +
        '• `/rank` - 默认显示涨幅榜前10\n' +
        '• `/rank_gainers` - 涨幅榜（等同于旧命令）\n' +
        '• `/rank_losers` - 跌幅榜\n' +
        '• `/rank_gainers 15` - 自定义显示数量\n' +
        '• `/rank_gainers 24h 20` - 指定时间段和数量\n\n' +
        '✨ *新功能:* 支持多时间段，自定义数量，更好的数据源切换\n\n' +
        '👆 请使用 `/rank_gainers` 替代此命令',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('gainers_period', async (ctx) => {
      await ctx.reply(
        '🔄 *命令已优化升级*\n\n' +
        '`/gainers_period` 命令已整合到新的 `/rank` 命令中，功能更强大！\n\n' +
        '📊 *新用法:*\n' +
        '• `/rank_gainers 1h` - 1小时涨幅榜\n' +
        '• `/rank_gainers 4h 15` - 4小时涨幅榜前15\n' +
        '• `/rank_losers 30m` - 30分钟跌幅榜\n' +
        '• `/rank_gainers 1w 20` - 1周涨幅榜前20\n\n' +
        '✨ *新功能:* \n' +
        '• 支持更多时间段\n' +
        '• 涨跌榜统一管理\n' +
        '• 更好的数据源切换\n' +
        '• 更快的响应速度\n\n' +
        '👆 请使用 `/rank_gainers <时间段> [数量]` 替代此命令',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('losers', async (ctx) => {
      await ctx.reply(
        '🔄 *命令已优化升级*\n\n' +
        '`/losers` 命令已整合到新的 `/rank` 命令中，功能更强大！\n\n' +
        '📊 *新用法:*\n' +
        '• `/rank_losers` - 跌幅榜（等同于旧命令）\n' +
        '• `/rank_gainers` - 涨幅榜\n' +
        '• `/rank_losers 15` - 自定义显示数量\n' +
        '• `/rank_losers 24h 20` - 指定时间段和数量\n\n' +
        '✨ *新功能:* 支持多时间段，自定义数量，更好的数据源切换\n\n' +
        '👆 请使用 `/rank_losers` 替代此命令',
        { parse_mode: 'Markdown' }
      );
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

        // 过滤交易对并去重
        console.log('🔍 Filtering trading pairs...');
        const allSymbols = fundingRates.map(r => r.symbol);
        const validSymbols = filterTradingPairs(allSymbols);

        console.log('🔄 Deduplicating rates...');
        const filteredRates = fundingRates
          .filter(rate => validSymbols.includes(rate.symbol))
          .reduce((acc, rate) => {
            const key = rate.symbol;
            if (!acc.has(key)) {
              acc.set(key, rate);
            }
            return acc;
          }, new Map());

        // 只显示负费率并排序
        const allRates = Array.from(filteredRates.values());
        const negativeRates = allRates.filter(rate => parseFloat(rate.fundingRate) < 0);
        const sortedRates = negativeRates
          .sort((a, b) => parseFloat(a.fundingRate) - parseFloat(b.fundingRate));

        // 限制显示数量以避免消息过长
        const displayLimit = 25;
        const displayData = sortedRates.slice(0, displayLimit);

        let message = `⚡ *负费率排行榜 TOP${displayData.length}*\n\n`;

        // Get prices for all symbols
        const pricePromises = displayData.map(async (rate, index) => {
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

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        console.error('❌ Funding rates query error:', error);
        await ctx.reply('❌ 查询资金费率排行榜失败');
      }
    });

    // 统一的OI命令 - 优化用户体验
    this.bot.command('oi', async (ctx) => {
      try {
        const args = ctx.message.text.split(' ').slice(1);
        let timeframe = '24h'; // 默认24小时
        let symbol = null;

        // 解析参数: /oi [1h|4h|24h] [币种]
        if (args.length > 0) {
          const firstArg = args[0].toLowerCase();
          if (['1h', '4h', '24h'].includes(firstArg)) {
            timeframe = firstArg;
            if (args.length > 1) {
              symbol = args[1].toUpperCase();
              if (!symbol.endsWith('USDT')) {
                symbol += 'USDT';
              }
            }
          } else {
            // 第一个参数是币种
            symbol = firstArg.toUpperCase();
            if (!symbol.endsWith('USDT')) {
              symbol += 'USDT';
            }
          }
        }

        await this.handleOICommand(ctx, timeframe, symbol || undefined);
      } catch (error) {
        log.error('OI命令处理失败:', error);
        await ctx.reply(`❌ OI查询失败，请稍后重试\n\n💡 使用方法：\n/oi [1h|4h|24h] [币种]\n例如：/oi 24h BTC`);
      }
    });

    // 统一的排行榜命令 - 优化用户体验
    this.bot.command('rank', async (ctx) => {
      try {
        const args = ctx.message.text.split(' ').slice(1);

        // 默认参数
        let type = 'gainers'; // 默认涨幅榜
        let period = '24h'; // 默认24小时
        let count = 10; // 默认10个

        // 解析参数: /rank [gainers|losers] [period] [count]
        if (args.length > 0) {
          const firstArg = args[0].toLowerCase();
          if (['gainers', 'losers', 'gainer', 'loser', 'up', 'down'].includes(firstArg)) {
            type = firstArg.includes('gain') || firstArg === 'up' ? 'gainers' : 'losers';

            if (args.length > 1) {
              const timeArg = args[1].toLowerCase();
              if (['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '24h', '3d'].includes(timeArg)) {
                period = timeArg === '1d' ? '24h' : timeArg; // 标准化

                if (args.length > 2) {
                  const countArg = parseInt(args[2]);
                  if (!isNaN(countArg) && countArg > 0 && countArg <= 20) {
                    count = countArg;
                  }
                }
              }
            }
          } else {
            // 第一个参数可能是时间段
            const timeArg = firstArg;
            if (['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '24h', '3d'].includes(timeArg)) {
              period = timeArg === '1d' ? '24h' : timeArg;

              if (args.length > 1) {
                const countArg = parseInt(args[1]);
                if (!isNaN(countArg) && countArg > 0 && countArg <= 20) {
                  count = countArg;
                }
              }
            }
          }
        }

        await this.handleRankingCommand(ctx, type, period, count);
      } catch (error) {
        log.error('排行榜命令处理失败:', error);
        await ctx.reply(`❌ 排行榜查询失败，请稍后重试\n\n💡 使用方法：\n/rank [gainers|losers] [时间] [数量]\n/rank_gainers [时间] [数量]\n/rank_losers [时间] [数量]\n例如：/rank_gainers 1h 5`);
      }
    });

    // 涨幅榜独立命令
    this.bot.command('rank_gainers', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        let period = '24h'; // 默认24小时
        let count = 10; // 默认10个

        // 解析参数: /rank_gainers [period] [count]
        if (args.length > 0) {
          const firstArg = args[0].toLowerCase();
          if (['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '24h', '3d'].includes(firstArg)) {
            period = firstArg === '1d' ? '24h' : firstArg;

            if (args.length > 1) {
              const countArg = parseInt(args[1]);
              if (!isNaN(countArg) && countArg > 0 && countArg <= 20) {
                count = countArg;
              }
            }
          } else {
            // 第一个参数可能是数量
            const countArg = parseInt(firstArg);
            if (!isNaN(countArg) && countArg > 0 && countArg <= 20) {
              count = countArg;
            }
          }
        }

        await this.handleRankingCommand(ctx, 'gainers', period, count);
      } catch (error) {
        log.error('涨幅榜命令处理失败:', error);
        await ctx.reply(`❌ 涨幅榜查询失败，请稍后重试\n\n💡 使用方法：\n/rank_gainers [时间] [数量]\n例如：/rank_gainers 1h 5`);
      }
    });

    // 跌幅榜独立命令
    this.bot.command('rank_losers', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        let period = '24h'; // 默认24小时
        let count = 10; // 默认10个

        // 解析参数: /rank_losers [period] [count]
        if (args.length > 0) {
          const firstArg = args[0].toLowerCase();
          if (['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '24h', '3d'].includes(firstArg)) {
            period = firstArg === '1d' ? '24h' : firstArg;

            if (args.length > 1) {
              const countArg = parseInt(args[1]);
              if (!isNaN(countArg) && countArg > 0 && countArg <= 20) {
                count = countArg;
              }
            }
          } else {
            // 第一个参数可能是数量
            const countArg = parseInt(firstArg);
            if (!isNaN(countArg) && countArg > 0 && countArg <= 20) {
              count = countArg;
            }
          }
        }

        await this.handleRankingCommand(ctx, 'losers', period, count);
      } catch (error) {
        log.error('跌幅榜命令处理失败:', error);
        await ctx.reply(`❌ 跌幅榜查询失败，请稍后重试\n\n💡 使用方法：\n/rank_losers [时间] [数量]\n例如：/rank_losers 4h 15`);
      }
    });

    // 统一警报命令 - 支持多种类型的警报
    this.bot.command('alert', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);

      // 无参数时显示帮助
      if (!args || args.length === 0) {
        await this.handleAlertHelp(ctx);
        return;
      }

      // 路由到不同的处理器
      const subCommand = args[0].toLowerCase();

      switch (subCommand) {
        case 'list':
        case 'ls':
          await this.handleAlertList(ctx);
          break;
        case 'remove':
        case 'rm':
        case 'delete':
          await this.handleAlertRemove(ctx, args.slice(1));
          break;
        case 'toggle':
          await this.handleAlertToggle(ctx, args.slice(1));
          break;
        case 'history':
          await this.handleAlertHistory(ctx, args.slice(1));
          break;
        case 'test':
          await this.handleAlertTest(ctx, args.slice(1));
          break;
        case 'stats':
          await this.handleAlertStats(ctx);
          break;
        default:
          // 默认处理：创建新警报
          await this.handleAlertCreate(ctx, args);
          break;
      }
    });

    // 旧警报命令迁移提示
    this.bot.command('alerts', async (ctx) => {
      await ctx.reply(
        '🔄 *命令已优化升级*\n\n' +
        '`/alerts` 命令已整合到新的 `/alert` 命令中！\n\n' +
        '📊 *新用法:*\n' +
        '• `/alert_list` - 查看所有警报（等同于旧命令）\n' +
        '• `/alert` - 查看完整帮助和功能\n' +
        '• `/alert btc > 50000` - 创建价格警报\n' +
        '• `/alert_remove <ID>` - 删除警报\n\n' +
        '✨ *新功能:* 统一界面，支持更多警报类型，更强大的管理功能\n\n' +
        '👆 请使用 `/alert_list` 替代此命令',
        { parse_mode: 'Markdown' }
      );
    });

    this.bot.command('remove_alert', async (ctx) => {
      await ctx.reply(
        '🔄 *命令已优化升级*\n\n' +
        '`/remove_alert` 命令已整合到新的 `/alert` 命令中！\n\n' +
        '📊 *新用法:*\n' +
        '• `/alert_remove <ID>` - 删除指定警报\n' +
        '• `/alert_list` - 查看所有警报和ID\n' +
        '• `/alert_toggle <ID>` - 启用/禁用警报\n\n' +
        '✨ *新功能:* 更直观的ID管理，支持批量操作\n\n' +
        '👆 请使用 `/alert_remove <ID>` 替代此命令',
        { parse_mode: 'Markdown' }
      );
    });

    // 综合技术分析命令
    this.bot.command('signals', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);

        if (!args || args.length === 0) {
          await ctx.reply('💡 请指定要分析的币种，例如: /signals btc\n\n📊 支持参数:\n• /signals btc - BTC技术分析\n• /signals eth 1h - ETH 1小时周期分析\n• /signals doge balanced - DOGE使用平衡策略分析');
          return;
        }

        const symbol = args[0].toUpperCase();
        const timeframe = args[1] || '1h'; // 默认1小时
        const strategy = args[2] || 'balanced'; // 默认平衡策略

        // 检查是否是已下架代币
        const testSymbol = symbol.includes('USDT') ? symbol : symbol + 'USDT';
        const riskLevel = getTokenRiskLevel(testSymbol);
        if (riskLevel === 'delisted' || riskLevel === 'blacklist') {
          await ctx.reply(`❌ ${symbol} 已被列入${riskLevel === 'delisted' ? '已下架' : '黑名单'}代币，不支持技术分析`);
          return;
        }

        await ctx.reply(`🔍 正在为 ${symbol} 进行综合技术分析...\n⏳ 这可能需要几秒钟时间`);

        try {
          // 临时实现：直接调用binance获取K线数据进行基础分析
          const actualSymbol = symbol.includes('USDT') ? symbol : symbol + 'USDT';

          // 获取价格和基础数据
          const [price, stats, fundingRate] = await Promise.all([
            this.binanceClient.getFuturesPrice(actualSymbol).catch(() => this.binanceClient.getPrice(actualSymbol)),
            this.binanceClient.getFutures24hrStats(actualSymbol).catch(() => this.binanceClient.get24hrStats(actualSymbol)),
            this.binanceClient.getFundingRate(actualSymbol).catch(() => null)
          ]);

          const changePercent = parseFloat(stats.priceChangePercent);
          const changeIcon = changePercent >= 0 ? '📈' : '📉';
          const volume = parseFloat(stats.volume) / 1000000;

          // 基础技术分析逻辑
          let signals = [];
          let overallScore = 0;

          // 价格动量分析
          if (Math.abs(changePercent) > 5) {
            signals.push(changePercent > 0 ? '🚀 强劲上涨动能' : '⚡ 强劲下跌动能');
            overallScore += changePercent > 0 ? 20 : -20;
          } else if (Math.abs(changePercent) > 2) {
            signals.push(changePercent > 0 ? '📈 温和上涨' : '📉 温和下跌');
            overallScore += changePercent > 0 ? 10 : -10;
          } else {
            signals.push('⚖️ 价格相对稳定');
          }

          // 成交量分析
          if (volume > 100) {
            signals.push('🔥 成交量活跃');
            overallScore += 10;
          } else if (volume > 50) {
            signals.push('📊 成交量正常');
            overallScore += 5;
          } else {
            signals.push('💤 成交量偏低');
            overallScore -= 5;
          }

          // 资金费率分析 (如果有)
          if (fundingRate) {
            const rate = parseFloat(fundingRate.fundingRate) * 100;
            if (rate > 0.01) {
              signals.push('💰 多头情绪较强 (正费率)');
              overallScore += 5;
            } else if (rate < -0.01) {
              signals.push('⚡ 空头情绪较强 (负费率)');
              overallScore -= 5;
            } else {
              signals.push('⚖️ 多空相对平衡');
            }
          }

          // 确定综合信号
          let overallSignal = '⚖️ 观望';
          let signalIcon = '⚖️';
          if (overallScore >= 20) {
            overallSignal = '🚀 强烈买入';
            signalIcon = '🟢';
          } else if (overallScore >= 10) {
            overallSignal = '📈 买入';
            signalIcon = '🟢';
          } else if (overallScore <= -20) {
            overallSignal = '💥 强烈卖出';
            signalIcon = '🔴';
          } else if (overallScore <= -10) {
            overallSignal = '📉 卖出';
            signalIcon = '🔴';
          }

          const formattedPrice = await formatPriceWithSeparators(price, actualSymbol);
          const formattedChangePercent = formatPriceChange(changePercent);

          let analysisMessage = `📊 *${symbol} 综合技术分析*\n\n`;

          analysisMessage += `💰 **当前价格:** $${formattedPrice}\n`;
          analysisMessage += `${changeIcon} **24h涨跌:** ${changePercent >= 0 ? '+' : ''}${formattedChangePercent}%\n`;
          analysisMessage += `📈 **24h成交量:** ${volume.toFixed(1)}M USDT\n\n`;

          analysisMessage += `🎯 **综合信号:** ${signalIcon} ${overallSignal}\n`;
          analysisMessage += `📊 **信号评分:** ${overallScore > 0 ? '+' : ''}${overallScore}/100\n\n`;

          analysisMessage += `🔍 **技术信号分析:**\n`;
          signals.forEach((signal, index) => {
            analysisMessage += `${index + 1}. ${signal}\n`;
          });

          if (fundingRate) {
            const fundingPercent = (parseFloat(fundingRate.fundingRate) * 100).toFixed(4);
            analysisMessage += `\n💰 **资金费率:** ${fundingPercent}%\n`;
          }

          analysisMessage += `\n⏰ **分析时间:** ${formatTimeToUTC8(new Date())}\n`;
          analysisMessage += `🔧 **分析策略:** ${strategy}\n`;
          analysisMessage += `⏱️ **时间周期:** ${timeframe}\n\n`;

          analysisMessage += `💡 **免责声明:** 此分析仅供参考，不构成投资建议\n`;
          analysisMessage += `🚀 **完整技术指标分析功能即将上线...**`;

          await ctx.replyWithMarkdown(analysisMessage);

        } catch (analysisError) {
          console.error('Technical analysis error:', analysisError);
          await ctx.reply(`❌ ${symbol} 技术分析失败，请检查币种名称是否正确\n\n💡 提示:\n• 确保币种名称正确 (如: BTC, ETH, DOGE)\n• 支持的时间周期: 5m, 15m, 30m, 1h, 4h, 1d\n• 支持的策略: balanced, momentum, trend, conservative, aggressive`);
        }

      } catch (error) {
        console.error('Signals command error:', error);
        await ctx.reply('❌ 技术分析功能暂时不可用，请稍后重试');
      }
    });
  }

  /**
   * 处理OI命令
   */
  private async handleOICommand(ctx: any, timeframe: string, symbol?: string): Promise<void> {
    await ctx.reply(`📈 正在查询${timeframe}持仓量增长榜${symbol ? ` (${symbol})` : ''}...`);

    try {
      const symbols = symbol ? [symbol] : await this.binanceClient.getFuturesTradingSymbols();
      const validSymbols = symbol ? [symbol] : filterTradingPairs(symbols);

      // 根据时间框架设置参数
      let interval: string;
      let dataPoints: number;

      switch (timeframe) {
        case '1h':
          interval = '15m';
          dataPoints = 4;
          break;
        case '4h':
          interval = '1h';
          dataPoints = 4;
          break;
        case '24h':
        default:
          interval = '1h';
          dataPoints = 24;
          break;
      }

      const oiData = await this.binanceClient.getBatchOpenInterestStats(
        validSymbols,
        interval as '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '12h' | '1d',
        dataPoints,
        30,
        3000
      );

      const oiResults = [];
      for (const [symbolKey, oiStats] of oiData.entries()) {
        if (oiStats && oiStats.length >= Math.min(4, dataPoints)) {
          const current = parseFloat(oiStats[oiStats.length - 1].sumOpenInterestValue);
          const previous = parseFloat(oiStats[0].sumOpenInterestValue);

          if (current > 0 && previous > 0) {
            const change = ((current - previous) / previous) * 100;
            const maxChange = timeframe === '1h' ? 100 : timeframe === '4h' ? 200 : 500;

            if (Math.abs(change) < maxChange) {
              oiResults.push({
                symbol: symbolKey.replace('USDT', ''),
                change,
                currentOI: current / 1000000,
                dataPoints: oiStats.length
              });
            }
          }
        }
      }

      const sortedResults = oiResults.sort((a, b) => b.change - a.change);
      const displayLimit = symbol ? 1 : 20;
      const displayData = sortedResults.slice(0, displayLimit);

      let message = `📈 *${timeframe}持仓量增长榜 TOP${displayData.length}*\n\n`;

      displayData.forEach((result, index) => {
        const changeIcon = result.change >= 0 ? '📈' : '📉';
        message += `${index + 1}. ${changeIcon} **${result.symbol}** ${result.change >= 0 ? '+' : ''}${result.change.toFixed(2)}% (${result.currentOI.toFixed(1)}M)\n`;
      });

      message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;
      message += `\n📊 成功查询 ${oiData.size}/${validSymbols.length} 个交易对`;

      await ctx.replyWithMarkdown(message);
    } catch (error) {
      console.error(`OI ${timeframe} query error:`, error);
      await ctx.reply(`❌ 查询${timeframe}持仓量增长榜失败`);
    }
  }

  /**
   * 处理排行榜命令
   */
  private async handleRankingCommand(ctx: any, type: string, period: string, count: number): Promise<void> {
    await ctx.reply(`📊 正在查询${period}${type === 'gainers' ? '涨幅' : '跌幅'}榜前${count}名...`);

    try {
      // 获取所有合约交易对24小时数据
      const data = await this.binanceClient.getFutures24hrStatsMultiple();
      if (!data || data.length === 0) {
        throw new Error('无法获取市场数据');
      }

      // 过滤有效交易对
      const validSymbols = filterTradingPairs(data.map((d: any) => d.symbol));
      const filteredData = data.filter((ticker: any) => validSymbols.includes(ticker.symbol));

      // 排序
      const sortedData = filteredData.sort((a: any, b: any) => {
        const changeA = parseFloat(a.priceChangePercent);
        const changeB = parseFloat(b.priceChangePercent);
        return type === 'gainers' ? changeB - changeA : changeA - changeB;
      });

      const displayData = sortedData.slice(0, count);
      const titleType = type === 'gainers' ? '涨幅' : '跌幅';
      let message = `📊 *${period} ${titleType}榜 TOP${displayData.length}*\n\n`;

      for (let i = 0; i < displayData.length; i++) {
        const ticker = displayData[i];
        const symbol = ticker.symbol.replace('USDT', '');
        const changePercent = parseFloat(ticker.priceChangePercent);
        const changeIcon = changePercent >= 0 ? '📈' : '📉';
        const riskLevel = getTokenRiskLevel(ticker.symbol);
        const riskIcon = getRiskIcon(riskLevel);

        let priceText = '';
        try {
          const formattedPrice = await formatPriceWithSeparators(ticker.lastPrice, ticker.symbol);
          priceText = ` ($${formattedPrice})`;
        } catch (error) {
          priceText = '';
        }

        message += `${i + 1}. ${changeIcon} ${riskIcon}**${symbol}** ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%${priceText}\n`;
      }

      message += `\n⏰ 更新时间: ${formatTimeToUTC8(new Date())}`;

      await ctx.replyWithMarkdown(message);
    } catch (error) {
      console.error('Ranking command error:', error);
      const errorTitleType = type === 'gainers' ? '涨幅' : '跌幅';
      await ctx.reply(`❌ 查询${errorTitleType}榜失败`);
    }
  }

  /**
   * 处理警报帮助
   */
  private async handleAlertHelp(ctx: any): Promise<void> {
    const helpMessage = '🚨 *统一警报系统* 🚨\n\n' +
      '📋 *基本语法:*\n' +
      '`/alert <币种> <条件> <值> [时间框架]`\n\n' +
      '📊 *支持的警报类型:*\n\n' +
      '🔸 **价格警报**\n' +
      '• `/alert btc > 50000` - BTC价格突破50000时提醒\n' +
      '• `/alert eth < 3000` - ETH价格跌破3000时提醒\n' +
      '• `/alert sol >= 100` - SOL价格达到100或以上时提醒\n\n' +
      '🔸 **涨跌幅警报**\n' +
      '• `/alert btc change 5% 1h` - BTC在1小时内涨跌超过5%时提醒\n' +
      '• `/alert eth change 10% 24h` - ETH在24小时内涨跌超过10%时提醒\n\n' +
      '🔸 **排行榜推送**\n' +
      '• `/alert gainers push` - 开启涨幅榜推送通知\n' +
      '• `/alert funding push` - 开启资金费率推送通知\n\n' +
      '⚙️ *管理命令:*\n' +
      '• `/alert_list` - 查看所有警报\n' +
      '• `/alert_remove <ID>` - 删除指定警报\n' +
      '• `/alert_toggle <ID>` - 启用/禁用警报\n' +
      '• `/alert_history` - 查看触发历史\n' +
      '• `/alert_stats` - 查看统计信息\n\n' +
      '💡 *时间框架:* 1m, 5m, 15m, 30m, 1h, 4h, 24h, 3d, 1w\n' +
      '⚡ *智能系统:* 自动避免重复提醒，支持优先级管理\n\n' +
      '🔗 *迁移提示:* 旧命令如 `/add_alert`, `/alerts` 等已整合到此系统';

    await ctx.replyWithMarkdown(helpMessage);
  }

  /**
   * 处理警报列表
   */
  private async handleAlertList(ctx: any): Promise<void> {
    try {
      await ctx.reply('📋 正在查询警报列表...');

      const userId = ctx.from?.id?.toString() || 'unknown';

      // 查询统一警报系统
      const unifiedAlerts = await this.unifiedAlertService.getUserAlerts(userId);

      // 查询急涨急跌警报系统
      const timeBasedAlerts = await TimeRangeAlertModel.getUserAlerts(userId);

      if (unifiedAlerts.length === 0 && timeBasedAlerts.length === 0) {
        await ctx.reply('📭 您还没有设置任何警报\n\n💡 使用 /alert btc > 50000 或 /alert_5m_gain_3_all 创建警报');
        return;
      }

      const totalAlerts = unifiedAlerts.length + timeBasedAlerts.length;
      let message = `📋 您的警报列表 (${totalAlerts}个)\n\n`;

      let alertIndex = 1;

      // 显示统一警报系统的警报
      for (const alert of unifiedAlerts) {
        const status = alert.enabled ? '🟢 启用' : '🔴 禁用';
        const description = AlertCommandParser.generateAlertDescription(alert);

        message += `${alertIndex++}. ${status} 💰 价格警报\n`;
        message += `   📄 ${description}\n`;
        message += `   🆔 ID: ${alert.id}\n`;
        message += `   🔔 优先级: ${alert.priority}\n\n`;
      }

      // 显示急涨急跌警报系统的警报
      for (const alert of timeBasedAlerts) {
        const status = alert.isEnabled ? '🟢 启用' : '🔴 禁用';
        const symbolText = alert.symbol || '所有代币';
        const timeText = this.formatTimeframe(alert.timeframe);
        const typeText = alert.alertType === 'gain' ? '涨幅' : alert.alertType === 'loss' ? '跌幅' : '涨跌幅';

        message += `${alertIndex++}. ${status} 🚀 急涨急跌警报\n`;
        message += `   📄 ${symbolText} ${timeText}内${typeText} ≥ ${alert.thresholdPercent}%\n`;
        message += `   🆔 ID: T${alert.id} (急涨急跌)\n`;
        message += `   ⏰ 创建时间: ${new Date(alert.createdAt).toLocaleString('zh-CN')}\n\n`;
      }

      message += `💡 操作指南:\n`;
      message += `• 删除价格警报: /alert_remove <ID>\n`;
      message += `• 删除急涨急跌警报: /alert_remove T<ID>\n`;
      message += `• 切换: /alert_toggle <ID>\n`;
      message += `• 历史: /alert_history [ID]\n`;
      message += `• 统计: /alert_stats`;

      await ctx.reply(message);

    } catch (error) {
      log.error('Failed to list alerts:', error);
      await ctx.reply('❌ 查询警报列表失败，请稍后重试');
    }
  }

  /**
   * 处理警报删除
   */
  private async handleAlertRemove(ctx: any, args: string[]): Promise<void> {
    if (!args || args.length === 0) {
      await ctx.reply('❌ 请指定要删除的警报ID\n\n💡 示例: \n• 价格警报: /alert_remove user123-BTC-1234567890\n• 急涨急跌警报: /alert_remove T6');
      return;
    }

    try {
      const alertId = args[0];
      const userId = ctx.from?.id?.toString() || 'unknown';
      await ctx.reply(`🗑️ 正在删除警报 ${alertId}...`);

      // 检查是否为时间基警报 (T-prefixed)
      if (alertId.startsWith('T') && alertId.length > 1) {
        // 处理急涨急跌警报
        const numericId = parseInt(alertId.substring(1));
        if (isNaN(numericId)) {
          await ctx.reply('❌ 无效的急涨急跌警报ID格式');
          return;
        }

        // 验证警报是否存在且属于当前用户
        const timeBasedAlerts = await TimeRangeAlertModel.getUserAlerts(userId);
        const alert = timeBasedAlerts.find(a => a.id === numericId);

        if (!alert) {
          await ctx.reply('❌ 急涨急跌警报不存在或ID无效');
          return;
        }

        // 删除时间基警报
        const success = await TimeRangeAlertModel.deleteAlert(numericId, userId);
        if (!success) {
          await ctx.reply('❌ 删除急涨急跌警报失败');
          return;
        }

        // 生成描述
        const symbolText = alert.symbol || '所有代币';
        const timeText = this.formatTimeframe(alert.timeframe);
        const typeText = alert.alertType === 'gain' ? '涨幅' : alert.alertType === 'loss' ? '跌幅' : '涨跌幅';
        const description = `${symbolText} ${timeText}内${typeText} ≥ ${alert.thresholdPercent}%`;

        await ctx.reply(
          `✅ 急涨急跌警报删除成功！\n\n` +
          `🗑️ **已删除警报:**\n` +
          `🚀 ${description}\n` +
          `🆔 ID: ${alertId}\n` +
          `⏰ 创建时间: ${new Date(alert.createdAt).toLocaleString('zh-CN')}`
        );

      } else {
        // 处理统一警报系统的价格警报
        const alert = await this.unifiedAlertService.getAlert(alertId);
        if (!alert) {
          await ctx.reply('❌ 价格警报不存在或ID无效');
          return;
        }

        if (alert.metadata?.userId !== userId) {
          await ctx.reply('❌ 您只能删除自己的警报');
          return;
        }

        // 删除价格警报
        await this.unifiedAlertService.removeAlert(alertId);

        const description = AlertCommandParser.generateAlertDescription(alert);
        await ctx.reply(
          `✅ 价格警报删除成功！\n\n` +
          `🗑️ **已删除警报:**\n` +
          `💰 ${description}\n` +
          `🆔 ID: ${alertId}`
        );
      }

    } catch (error) {
      log.error('Failed to remove alert:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await ctx.reply(`❌ 删除警报失败: ${errorMessage}`);
    }
  }

  /**
   * 处理警报切换
   */
  private async handleAlertToggle(ctx: any, args: string[]): Promise<void> {
    if (!args || args.length === 0) {
      await ctx.reply('❌ 请指定要切换的警报ID\n\n💡 示例: /alert_toggle user123-BTC-1234567890');
      return;
    }

    try {
      const alertId = args[0];
      await ctx.reply(`🔄 正在切换警报状态...`);

      // 验证警报是否存在且属于当前用户
      const alert = await this.unifiedAlertService.getAlert(alertId);
      if (!alert) {
        await ctx.reply('❌ 警报不存在或ID无效');
        return;
      }

      const userId = ctx.from?.id?.toString() || 'unknown';
      if (alert.metadata?.userId !== userId) {
        await ctx.reply('❌ 您只能操作自己的警报');
        return;
      }

      // 切换警报状态
      const newStatus = !alert.enabled;
      await this.unifiedAlertService.toggleAlert(alertId, newStatus);

      const description = AlertCommandParser.generateAlertDescription(alert);
      const statusText = newStatus ? '🟢 启用' : '🔴 禁用';

      await ctx.reply(
        `✅ 警报状态更新成功！\n\n` +
        `🔄 **警报状态:** ${statusText}\n` +
        `📄 ${description}\n` +
        `🆔 ID: ${alertId}`
      );

    } catch (error) {
      log.error('Failed to toggle alert:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await ctx.reply(`❌ 切换警报状态失败: ${errorMessage}`);
    }
  }

  /**
   * 处理警报历史
   */
  private async handleAlertHistory(ctx: any, args: string[]): Promise<void> {
    try {
      await ctx.reply('📚 正在查询警报历史...');

      const alertId = args && args.length > 0 ? args[0] : undefined;
      const limit = 20; // 限制返回数量

      const events = await this.unifiedAlertService.getAlertHistory(alertId, limit);

      if (events.length === 0) {
        const message = alertId
          ? `📭 指定警报 ${alertId} 暂无触发历史`
          : '📭 暂无警报触发历史';
        await ctx.reply(message);
        return;
      }

      const title = alertId
        ? `📚 **警报历史** (${alertId})`
        : `📚 **警报历史** (最近${events.length}条)`;

      let message = `${title}\n\n`;

      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const timeStr = formatTimeToUTC8(event.triggeredAt);
        const priorityIcon = this.getPriorityIcon(event.priority);

        message += `${i + 1}. ${priorityIcon} **${event.symbol}**\n`;
        message += `   📄 ${event.message}\n`;
        message += `   💰 当前值: ${event.currentValue}\n`;
        message += `   🎯 阈值: ${event.thresholdValue}\n`;
        message += `   ⏰ ${timeStr}\n\n`;

        // 防止消息过长
        if (message.length > 3500) {
          message += `... 还有 ${events.length - i - 1} 条记录`;
          break;
        }
      }

      await ctx.reply(message, { parse_mode: 'Markdown' });

    } catch (error) {
      log.error('Failed to get alert history:', error);
      await ctx.reply('❌ 查询警报历史失败，请稍后重试');
    }
  }

  private getPriorityIcon(priority: string): string {
    switch (priority) {
      case 'critical': return '🚨';
      case 'high': return '⚠️';
      case 'medium': return '🔔';
      case 'low': return '🔕';
      default: return '🔔';
    }
  }

  /**
   * 处理警报测试
   */
  private async handleAlertTest(ctx: any, args: string[]): Promise<void> {
    if (!args || args.length === 0) {
      await ctx.reply('❌ 请指定要测试的警报ID\n\n💡 示例: /alert test user123-BTC-1234567890');
      return;
    }

    try {
      const alertId = args[0];
      await ctx.reply('🧪 正在测试警报...');

      // 验证警报是否存在且属于当前用户
      const alert = await this.unifiedAlertService.getAlert(alertId);
      if (!alert) {
        await ctx.reply('❌ 警报不存在或ID无效');
        return;
      }

      const userId = ctx.from?.id?.toString() || 'unknown';
      if (alert.metadata?.userId !== userId) {
        await ctx.reply('❌ 您只能测试自己的警报');
        return;
      }

      // 执行测试
      const results = await this.unifiedAlertService.testAlert(alertId);

      const description = AlertCommandParser.generateAlertDescription(alert);
      let message = `🧪 **警报测试完成**\n\n`;
      message += `📄 ${description}\n`;
      message += `🆔 ID: ${alertId}\n\n`;

      message += `📬 **通知结果:**\n`;
      for (const result of results) {
        const icon = result.success ? '✅' : '❌';
        const status = result.success ? '成功' : `失败: ${result.error}`;
        message += `${icon} ${result.channel}: ${status}\n`;
      }

      const successCount = results.filter(r => r.success).length;
      const totalCount = results.length;

      message += `\n📊 **成功率:** ${successCount}/${totalCount}`;

      await ctx.reply(message);

    } catch (error) {
      log.error('Failed to test alert:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await ctx.reply(`❌ 警报测试失败: ${errorMessage}`);
    }
  }

  /**
   * 处理警报统计
   */
  private async handleAlertStats(ctx: any): Promise<void> {
    try {
      await ctx.reply('📊 正在查询警报统计...');

      const stats = await this.unifiedAlertService.getStatistics();

      let message = `📊 **警报统计信息**\n\n`;

      // 基本统计
      message += `📋 **总体统计:**\n`;
      message += `• 总警报数: ${stats.totalAlerts}\n`;
      message += `• 活跃警报: ${stats.activeAlerts}\n`;
      message += `• 今日触发: ${stats.triggeredToday}\n`;
      message += `• 本周触发: ${stats.triggeredThisWeek}\n\n`;

      // 按类型统计
      message += `🏷️ **按类型统计:**\n`;
      for (const [type, count] of Object.entries(stats.byType)) {
        if (count > 0) {
          message += `• ${this.getAlertTypeText(type)}: ${count}\n`;
        }
      }

      // 按优先级统计
      message += `\n🔔 **按优先级统计:**\n`;
      for (const [priority, count] of Object.entries(stats.byPriority)) {
        if (count > 0) {
          const icon = this.getPriorityIcon(priority);
          message += `• ${icon} ${priority}: ${count}\n`;
        }
      }

      // 性能统计
      message += `\n⚡ **性能统计:**\n`;
      message += `• 成功率: ${(stats.successRate * 100).toFixed(1)}%\n`;
      message += `• 平均响应时间: ${stats.avgResponseTime}ms\n`;

      await ctx.reply(message);

    } catch (error) {
      log.error('Failed to get alert statistics:', error);
      await ctx.reply('❌ 查询警报统计失败，请稍后重试');
    }
  }

  private getAlertTypeText(type: string): string {
    switch (type) {
      case 'price_above': return '价格突破上方';
      case 'price_below': return '价格跌破下方';
      case 'price_change': return '价格变化';
      case 'volume_spike': return '成交量激增';
      case 'funding_rate': return '资金费率';
      case 'open_interest': return '持仓量';
      case 'technical_indicator': return '技术指标';
      case 'custom': return '自定义';
      default: return type;
    }
  }

  /**
   * 处理警报创建
   */
  private async handleAlertCreate(ctx: any, args: string[]): Promise<void> {
    if (!args || args.length < 3) {
      await ctx.reply('❌ 警报参数不足\n\n💡 示例: /alert btc > 50000');
      return;
    }

    try {
      await ctx.reply(`⚡ 正在创建警报: ${args.join(' ')}...`);

      // 解析警报命令
      const parsed = AlertCommandParser.parseAlertCommand(args);

      // 获取用户信息
      const userId = ctx.from?.id?.toString() || 'unknown';
      const chatId = ctx.chat?.id || 0;

      // 转换为AlertConfig
      const alertConfig = AlertCommandParser.toAlertConfig(parsed, userId, chatId);

      // 注册警报
      await this.unifiedAlertService.registerAlert(alertConfig);

      // 生成描述
      const description = AlertCommandParser.generateAlertDescription(alertConfig);

      await ctx.reply(
        `✅ 警报创建成功！\n\n` +
        `🎯 **警报详情:**\n` +
        `📄 描述: ${description}\n` +
        `🆔 ID: ${alertConfig.id}\n` +
        `⏰ 冷却时间: ${alertConfig.cooldownMs / 1000}秒\n` +
        `🔔 优先级: ${alertConfig.priority}\n\n` +
        `💡 使用 /alert_list 查看所有警报`,
        { parse_mode: 'Markdown' }
      );

    } catch (error) {
      log.error('Failed to create alert:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await ctx.reply(`❌ 创建警报失败: ${errorMessage}`);
    }
  }

  /**
   * 设置下划线格式的命令别名 - 提升用户体验
   */
  private setupUnderscoreCommands(): void {
    // Alert相关下划线命令
    this.bot.command('alert_list', async (ctx) => {
      await this.handleAlertList(ctx);
    });

    this.bot.command('alert_remove', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);
      await this.handleAlertRemove(ctx, args);
    });

    // 急涨急跌警报命令 - 支持格式如: alert_5m_gain_3_all
    this.setupTimeBasedAlerts();

    this.bot.command('alert_toggle', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);
      await this.handleAlertToggle(ctx, args);
    });

    this.bot.command('alert_history', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);
      await this.handleAlertHistory(ctx, args);
    });

    this.bot.command('alert_test', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);
      await this.handleAlertTest(ctx, args);
    });

    this.bot.command('alert_stats', async (ctx) => {
      await this.handleAlertStats(ctx);
    });

    // OI相关下划线命令
    this.bot.command('oi_1h', async (ctx) => {
      try {
        await this.handleOICommand(ctx, '1h');
      } catch (error) {
        log.error('OI 1h命令处理失败:', error);
        await ctx.reply('❌ 1小时持仓量查询失败，请稍后重试');
      }
    });

    this.bot.command('oi_4h', async (ctx) => {
      try {
        await this.handleOICommand(ctx, '4h');
      } catch (error) {
        log.error('OI 4h命令处理失败:', error);
        await ctx.reply('❌ 4小时持仓量查询失败，请稍后重试');
      }
    });

    this.bot.command('oi_24h', async (ctx) => {
      try {
        await this.handleOICommand(ctx, '24h');
      } catch (error) {
        log.error('OI 24h命令处理失败:', error);
        await ctx.reply('❌ 24小时持仓量查询失败，请稍后重试');
      }
    });

    // 推送相关下划线命令
    this.bot.command('start_gainers_push', async (ctx) => {
      try {
        await ctx.reply('🚀 正在启动涨幅推送...');
        // 调用现有的推送启动逻辑
        // 这里需要调用相应的推送服务
        await ctx.reply('✅ 涨幅推送已启动！\n\n📈 将为您推送重要的市场涨幅变化');
      } catch (error) {
        log.error('启动涨幅推送失败:', error);
        await ctx.reply('❌ 启动涨幅推送失败，请稍后重试');
      }
    });

    this.bot.command('start_funding_push', async (ctx) => {
      try {
        await ctx.reply('🚀 正在启动资金费率推送...');
        // 调用现有的推送启动逻辑
        await ctx.reply('✅ 资金费率推送已启动！\n\n💰 将为您推送重要的费率变化信息');
      } catch (error) {
        log.error('启动资金费率推送失败:', error);
        await ctx.reply('❌ 启动资金费率推送失败，请稍后重试');
      }
    });

    this.bot.command('stop_gainers_push', async (ctx) => {
      try {
        await ctx.reply('🛑 正在停止涨幅推送...');
        await ctx.reply('✅ 涨幅推送已停止！');
      } catch (error) {
        log.error('停止涨幅推送失败:', error);
        await ctx.reply('❌ 停止涨幅推送失败，请稍后重试');
      }
    });

    this.bot.command('stop_funding_push', async (ctx) => {
      try {
        await ctx.reply('🛑 正在停止资金费率推送...');
        await ctx.reply('✅ 资金费率推送已停止！');
      } catch (error) {
        log.error('停止资金费率推送失败:', error);
        await ctx.reply('❌ 停止资金费率推送失败，请稍后重试');
      }
    });

    // 历史相关下划线命令
    this.bot.command('near_high', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        const timeframe = args[0] || '1m'; // 默认1个月
        await ctx.reply(`📈 正在查询接近${timeframe}高点的币种...`);
        // 这里需要调用相应的历史高点查询逻辑
        await ctx.reply('🚧 接近高点查询功能正在开发中，敬请期待！');
      } catch (error) {
        log.error('近期高点查询失败:', error);
        await ctx.reply('❌ 近期高点查询失败，请稍后重试');
      }
    });

    // 缓存状态下划线命令
    this.bot.command('cache_status', async (ctx) => {
      try {
        const cacheStatus = tieredDataManager.getCacheStatus();
        const refreshStats = tieredDataManager.getRefreshStats();
        const volumeStats = volumeClassifier.getVolumeStats();

        const message = `📊 *缓存系统状态*\n\n` +
          `🔥 *实时数据缓存:*\n` +
          `• 价格数据: ${cacheStatus.tickers.total} 条目\n` +
          `• 资金费率: ${cacheStatus.funding.total} 条目\n` +
          `• 持仓量数据: ${cacheStatus.openInterest.total} 条目\n\n` +
          `⚡ *API调用统计:*\n` +
          `• 总API调用: ${refreshStats.totalApiCalls}\n` +
          `• 处理时间: ${refreshStats.totalProcessingTime}ms\n\n` +
          `📈 *成交量分类:*\n` +
          `• 高成交量币种: ${volumeStats.high.count}\n` +
          `• 中等成交量币种: ${volumeStats.medium.count}\n` +
          `• 低成交量币种: ${volumeStats.low.count}\n\n` +
          `⏰ 数据更新时间: ${formatTimeToUTC8(new Date())}`;

        await ctx.replyWithMarkdown(message);
      } catch (error) {
        log.error('Cache status命令处理失败:', error);
        await ctx.reply('❌ 缓存状态查询失败，请稍后重试');
      }
    });

    // 推送状态下划线命令
    this.bot.command('push_status', async (ctx) => {
      try {
        await ctx.reply('📊 正在查询推送状态...');
        // 这里需要调用推送状态查询逻辑
        await ctx.reply('🚧 推送状态查询功能正在开发中，敬请期待！');
      } catch (error) {
        log.error('推送状态查询失败:', error);
        await ctx.reply('❌ 推送状态查询失败，请稍后重试');
      }
    });

    // Debug 命令 - 用户反馈收集
    this.bot.command('debug', async (ctx) => {
      try {
        const userId = ctx.from?.id?.toString();
        if (!userId) {
          await ctx.reply('❌ 无法获取用户信息');
          return;
        }

        // 获取debug命令后的文本内容
        const debugText = ctx.message.text.substring(7).trim(); // 移除 "/debug " 前缀
        if (!debugText) {
          await ctx.reply('💡 请在/debug命令后添加您的反馈内容\n\n示例：/debug 建议添加更多时间周期的排行榜\n\n💭 您也可以回复某条消息后发送/debug，这样可以记录完整的上下文');
          return;
        }

        let previousMessage = null;

        // 检查是否是回复消息
        if (ctx.message.reply_to_message) {
          const replyMsg = ctx.message.reply_to_message;

          // 确定消息类型和内容
          let messageType: 'bot_response' | 'user_message' = 'user_message';
          let messageContent = '';
          let messageId = replyMsg.message_id;

          // 判断是否是机器人消息
          if (replyMsg.from?.is_bot) {
            messageType = 'bot_response';
          }

          // 获取消息内容
          if ('text' in replyMsg && replyMsg.text) {
            messageContent = replyMsg.text;
          } else if ('caption' in replyMsg && replyMsg.caption) {
            messageContent = replyMsg.caption;
          } else {
            messageContent = '(非文本消息)';
          }

          previousMessage = {
            type: messageType,
            content: messageContent,
            messageId: messageId
          };
        } else {
          // 如果不是回复消息，提示建议使用回复功能获取更准确的上下文
          previousMessage = {
            type: 'bot_response' as const,
            content: '(建议: 回复特定消息来使用 /debug 获取准确上下文)'
          };
        }

        // 创建debug记录
        const debugRecord = {
          timestamp: new Date().toISOString(),
          userId: userId,
          previousMessage: previousMessage,
          debugContent: debugText
        };

        // 保存到文件
        const debugId = await this.debugService.saveDebugRecord(debugRecord);

        // 确认消息
        await ctx.reply(`✅ 反馈已记录，谢谢您的建议！\n\n🆔 记录ID: ${debugId}\n📝 反馈内容: ${debugText}\n\n💭 您的反馈将帮助我们改进bot功能`);

        log.info(`Debug feedback received from user ${userId}: ${debugText}`);

      } catch (error) {
        log.error('Debug命令处理失败:', error);
        await ctx.reply('❌ 记录反馈时发生错误，请稍后重试');
      }
    });
  }

  /**
   * 设置基于时间的急涨急跌警报命令
   * 支持格式: alert_5m_gain_3_all, alert_1h_loss_5_btc 等
   */
  private setupTimeBasedAlerts(): void {
    // 动态匹配急涨急跌命令格式
    this.bot.use(async (ctx, next) => {
      if (ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text;
        const alertPattern = /^\/alert_(\d+(?:m|h|d))_?(gain|loss|all)?_?(\d+(?:\.\d+)?)_?([\w]+|all)?$/i;
        const match = text.match(alertPattern);

        if (match) {
          const [, timeframe, direction = 'all', threshold, symbol = 'all'] = match;
          await this.handleTimeBasedAlert(ctx, {
            timeframe: timeframe as any,
            direction: direction as 'gain' | 'loss' | 'all',
            threshold: parseFloat(threshold),
            symbol: symbol.toUpperCase()
          });
          return; // 不继续处理
        }
      }
      return next();
    });
  }

  /**
   * 处理急涨急跌警报设置
   */
  private async handleTimeBasedAlert(ctx: any, params: {
    timeframe: string;
    direction: 'gain' | 'loss' | 'all';
    threshold: number;
    symbol: string;
  }): Promise<void> {
    try {
      const { timeframe, direction, threshold, symbol } = params;
      const userId = ctx.from?.id?.toString();

      if (!userId) {
        await ctx.reply('❌ 无法获取用户信息');
        return;
      }

      // 验证参数
      const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '24h', '3d'];
      if (!validTimeframes.includes(timeframe)) {
        await ctx.reply(`❌ 无效的时间周期。支持: ${validTimeframes.join(', ')}`);
        return;
      }

      if (threshold <= 0 || threshold > 100) {
        await ctx.reply('❌ 涨跌幅必须在0-100%之间');
        return;
      }

      // 创建警报配置
      const alertConfig = {
        userId,
        symbol: symbol === 'ALL' ? null : symbol,
        timeframe: timeframe as any,
        alertType: (direction === 'all' ? 'both' : direction) as 'gain' | 'loss' | 'both',
        thresholdPercent: threshold,
        isEnabled: true
      };

      // 保存到数据库
      const alertId = await TimeRangeAlertModel.addAlert(alertConfig);

      // 格式化确认消息
      const symbolText = symbol === 'ALL' ? '所有代币' : symbol;
      const directionText = direction === 'gain' ? '涨幅' : direction === 'loss' ? '跌幅' : '涨跌幅';
      const timeText = this.formatTimeframe(timeframe);

      const confirmMessage = `✅ 急涨急跌警报已设置！

🎯 **警报详情:**
📊 监控范围: ${symbolText}
⏱️ 时间周期: ${timeText}
📈 触发条件: ${directionText} ≥ ${threshold}%
🆔 警报ID: ${alertId}

💡 **使用说明:**
• 系统将监控${symbolText}在${timeText}内的${directionText}变化
• 当${directionText}达到或超过${threshold}%时立即推送
• 使用 /alert_list 查看所有警报
• 使用 /alert_remove ${alertId} 删除此警报

🚀 警报已激活，开始监控中...`;

      await ctx.reply(confirmMessage);

    } catch (error) {
      console.error('Time-based alert setup failed:', error);
      await ctx.reply('❌ 设置急涨急跌警报失败，请稍后重试');
    }
  }

  /**
   * 格式化时间周期显示文本
   */
  private formatTimeframe(timeframe: string): string {
    const timeframes: Record<string, string> = {
      '1m': '1分钟', '5m': '5分钟', '15m': '15分钟', '30m': '30分钟',
      '1h': '1小时', '4h': '4小时', '24h': '24小时', '3d': '3天'
    };
    return timeframes[timeframe] || timeframe;
  }
}