import { Telegraf } from 'telegraf';
import { config } from './config';
import { authMiddleware } from './middleware/auth';
import { BotContext, BotStatus } from './types';
import { BinanceClient, binanceClient } from './services/binance';
import { filterTradingPairs, getTokenRiskLevel, getRiskIcon } from './config/tokenLists';
import { PriceAlertModel as TimeRangeAlertModel } from './models/priceAlertModel';
import { AlertIdManager, AlertIdType } from './services/alerts/AlertIdManager';
import { priceAlertService } from './services/priceAlertService';
import { potentialAlertService } from './services/potentialAlertService';
import { PotentialAlertModel } from './models/potentialAlertModel';
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
import { startBusinessOperation, endBusinessOperation } from './utils/businessMonitor';
import { log } from './utils/logger';
import { NotificationService } from './services/alerts/NotificationService';
import { PersistentAlertService } from './services/alerts/PersistentAlertService';
import { AlertCommandParser } from './utils/alertParser';
import { DebugService } from './services/debugService';
import { resolve } from './core/container';
import { SERVICE_IDENTIFIERS } from './core/container/decorators';
import { BlacklistCommandHandler } from './services/telegram/commands/BlacklistCommandHandler';
import { YellowlistCommandHandler } from './services/telegram/commands/YellowlistCommandHandler';
import { MuteCommandHandler } from './services/telegram/commands/MuteCommandHandler';
import { FilterCommandHandler } from './services/telegram/commands/FilterCommandHandler';
import { historicalHighCache } from './services/historicalHighCacheV2';

export class TelegramBot {
  private bot: Telegraf<BotContext>;
  private status: BotStatus;
  private binanceClient: BinanceClient;
  private notificationService: NotificationService;
  private unifiedAlertService: PersistentAlertService;
  private debugService: DebugService;
  private blacklistCommandHandler: BlacklistCommandHandler;
  private yellowlistCommandHandler: YellowlistCommandHandler;
  private muteCommandHandler: MuteCommandHandler;
  private filterCommandHandler: FilterCommandHandler;

  constructor() {
    this.bot = new Telegraf<BotContext>(config.telegram.botToken);
    this.binanceClient = binanceClient;
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

    // Initialize filter command handlers
    const filterManager = resolve(SERVICE_IDENTIFIERS.ADVANCED_FILTER_MANAGER) as any;
    const userFilterService = resolve(SERVICE_IDENTIFIERS.USER_FILTER_SERVICE) as any;
    this.blacklistCommandHandler = new BlacklistCommandHandler(null, log, filterManager, userFilterService);
    this.yellowlistCommandHandler = new YellowlistCommandHandler(null, log, filterManager, userFilterService);
    this.muteCommandHandler = new MuteCommandHandler(null, log, filterManager, userFilterService);
    this.filterCommandHandler = new FilterCommandHandler(null, log, filterManager, userFilterService);

    this.setupMiddleware();
    this.setupCommands();
    this.setupUnderscoreCommands();
    this.setupErrorHandling();

    // Set telegram bot instance for services
    this.notificationService.setTelegramBot(this);
    priceAlertService.setTelegramBot(this);

    // Initialize databases
    TimeRangeAlertModel.initDatabase();

    // 注意：实时服务初始化已移到 initializeRealtimeServices()，
    // 必须在 app.start() 中显式 await 调用，避免静默失败
  }

  /**
   * 初始化实时市场数据缓存和推送服务
   * 必须在启动流程中显式 await 调用
   */
  async initializeRealtimeServices(): Promise<void> {
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
    // 处理未知命令和文本消息
    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message.text;

      // 如果是以 / 开头的命令但没有被处理，说明是未知命令
      if (text.startsWith('/')) {
        const command = text.split(' ')[0].substring(1).toLowerCase();

        // 记录未知命令使用情况
        log.warn('Unknown command received', {
          command,
          fullText: text,
          userId: ctx.from?.id
        });

        // 提供友好的错误提示
        let helpMessage = `❓ **未知命令:** \`${command}\`

🤖 **可用命令分类:**
💰 **价格查询**: \`/price\` \`/signals\`
📊 **排行榜**: \`/rank\` \`/rank_gainers\` \`/rank_losers\` \`/funding\` \`/oi_24h\`
⚡ **警报系统**: \`/alert\` \`/alert_bt\` \`/alert_list\` \`/alert_5m_gain_3_all\`
🎯 **潜力信号**: \`/potential\` \`/potential_on\` \`/potential_off\` \`/potential_status\`
📈 **历史分析**: \`/high\` \`/high near\`
🛡️ **过滤管理**: \`/filter_settings\` \`/blacklist_list\` \`/mute_list\`
⚙️ **系统状态**: \`/status\` \`/cache_status\`
📖 **完整列表**: \`/help\`

💡 **提示:**
• 命令格式错误？请使用 \`/help\` 查看正确用法
• 找不到想要的功能？输入 \`/debug 功能建议\` 反馈给我们

🔍 **相似命令建议:**`;

        // 简单的命令建议逻辑
        const suggestions = this.getSimilarCommands(command);
        if (suggestions.length > 0) {
          helpMessage += '\n' + suggestions.map(cmd => `• \`/${cmd}\``).join('\n');
        }

        await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
        return;
      }

      // 对于非命令文本，继续处理
      await next();
    });

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
   * 获取相似命令建议
   */
  private getSimilarCommands(unknownCommand: string): string[] {
    const availableCommands = [
      'help', 'start', 'price', 'status', 'rank', 'oi', 'alert', 'signals',
      'debug', 'blacklist_list', 'mute_list', 'filter_settings', 'funding', 'cache_status', 'cache_update', 'high'
    ];

    // 简单的相似度匹配
    const suggestions: string[] = [];

    for (const cmd of availableCommands) {
      // 包含关系匹配
      if (cmd.includes(unknownCommand) || unknownCommand.includes(cmd)) {
        suggestions.push(cmd);
      }
      // 前缀匹配
      else if (cmd.startsWith(unknownCommand.substring(0, 3)) && unknownCommand.length > 2) {
        suggestions.push(cmd);
      }
    }

    // 常见拼写错误修正
    const corrections: Record<string, string> = {
      'prise': 'price',
      'pricd': 'price',
      'pric': 'price',
      'stat': 'status',
      'statu': 'status',
      'hep': 'help',
      'halp': 'help',
      'alrt': 'alert',
      'aler': 'alert',
      'blacklistlist': 'blacklist_list',
      'mutelist': 'mute_list',
      'blacklist': 'blacklist_list',
      'mute': 'mute_list',
      'filter': 'filter_settings'
    };

    if (corrections[unknownCommand]) {
      suggestions.unshift(corrections[unknownCommand]);
    }

    // 去重并限制数量
    return [...new Set(suggestions)].slice(0, 3);
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
        { command: 'alert_bt', description: '🚀 历史突破警报' },
        { command: 'potential', description: '🎯 手动扫描潜力币信号' },
        { command: 'potential_on', description: '🎯 开启潜力币自动推送' },
        { command: 'potential_off', description: '🎯 关闭潜力币自动推送' },
        { command: 'potential_status', description: '🎯 潜力币推送状态' },
        { command: 'blacklist_add', description: '🛡️ 添加个人黑名单' },
        { command: 'blacklist_remove', description: '🛡️ 移除黑名单' },
        { command: 'blacklist_list', description: '🛡️ 查看过滤规则' },
        { command: 'yellowlist_add', description: '⚠️ 添加个人黄名单' },
        { command: 'yellowlist_remove', description: '⚠️ 移除黄名单' },
        { command: 'yellowlist_list', description: '⚠️ 查看黄名单规则' },
        { command: 'yellowlist_clear', description: '⚠️ 清空黄名单' },
        { command: 'mute_add', description: '🔇 临时屏蔽代币' },
        { command: 'mute_remove', description: '🔇 解除屏蔽' },
        { command: 'mute_list', description: '🔇 查看屏蔽列表' },
        { command: 'mute_clear', description: '🔇 清空所有屏蔽' },
        { command: 'filter_settings', description: '⚙️ 过滤设置管理' },
        { command: 'filter_volume', description: '⚙️ 设置交易量阈值' },
        { command: 'filter_auto', description: '⚙️ 启用/禁用自动过滤' },
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
      const sendOptions: any = { ...options };
      // 只有在没有明确设置parse_mode时才使用默认的Markdown
      if (!options?.hasOwnProperty('parse_mode')) {
        sendOptions.parse_mode = 'Markdown';
      } else if (sendOptions.parse_mode === null) {
        // 明确设置为null时删除parse_mode
        delete sendOptions.parse_mode;
      }

      await this.bot.telegram.sendMessage(chatId, message, sendOptions);
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
  /**
   * 带业务监控的命令处理包装器
   */
  private commandWithMonitoring(command: string, handler: (ctx: any) => Promise<void>) {
    return async (ctx: any) => {
      const operationId = startBusinessOperation('command_execution', {
        command,
        userId: ctx.from?.id,
        username: ctx.from?.username
      });

      try {
        await handler(ctx);
        endBusinessOperation(operationId, true);
      } catch (error) {
        endBusinessOperation(operationId, false, error instanceof Error ? error.message : String(error));
        throw error;
      }
    };
  }

  private setupCommands(): void {
    // 开始命令
    this.bot.start(this.commandWithMonitoring('start', async (ctx) => {
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

🛡️ *过滤管理:*
/blacklist_add doge - 添加DOGE到黑名单
/yellowlist_add doge - 添加DOGE到黄名单(谨慎交易)
/mute_add shib 2h - 临时屏蔽SHIB 2小时
/blacklist_list - 查看所有过滤规则
/filter_settings - 查看过滤设置
/filter_auto on - 启用自动过滤

🤖 机器人已准备就绪！
      `;

      await ctx.replyWithMarkdown(welcomeMessage);
    }));


    // 显式帮助命令处理
    this.bot.command('help', this.commandWithMonitoring('help', async (ctx) => {
      try {
        console.log('📖 处理/help命令...');
        const helpMessage = this.generateHelpContent();

        console.log('📤 发送/help消息...');
        await ctx.reply(helpMessage);
        console.log('✅ /help消息发送成功');
      } catch (error) {
        console.error('❌ /help命令处理失败:', error);
        await ctx.reply('❌ 帮助信息加载失败，请稍后重试');
      }
    }));

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

        // 获取多时间框架数据
        const timeframes = ['5m', '1h', '4h', '1d', '1w'];
        const timeframeData: { [key: string]: any } = {};

        try {
          // 获取多时间框架K线数据
          for (const tf of timeframes) {
            try {
              const interval = tf === '5m' ? '5m' : tf === '1h' ? '1h' : tf === '4h' ? '4h' : tf === '1d' ? '1d' : '1w';
              const klines = await this.binanceClient.getFuturesKlines({
                symbol: actualSymbol,
                interval: interval as any,
                limit: 2
              });
              if (klines && klines.length >= 2) {
                const prevClose = parseFloat(klines[0].close); // 前一根K线收盘价
                const currentPrice = price || parseFloat(klines[1].close); // 当前价格或最新收盘价
                const changePercent = ((currentPrice - prevClose) / prevClose) * 100;
                timeframeData[tf] = {
                  change: changePercent,
                  icon: changePercent >= 0 ? '📈' : '📉',
                  sign: changePercent >= 0 ? '+' : '-'
                };
              }
            } catch (tfError: any) {
              // 单个时间框架失败不影响其他
              console.log(`Failed to get ${tf} data for ${actualSymbol}:`, tfError?.message || tfError);
            }
          }
        } catch (multiFrameError: any) {
          console.log('Multi-timeframe data collection failed:', multiFrameError?.message || multiFrameError);
        }

        // 检查完整的风险状态（系统级 + 个人级）
        const userId = ctx.from?.id?.toString();
        let riskIcon = '';
        if (userId) {
          try {
            // 检查系统级风险
            const systemRiskLevel = getTokenRiskLevel(actualSymbol);
            const systemRiskIcon = getRiskIcon(systemRiskLevel);

            // 检查个人黄名单
            const filterManager = resolve(SERVICE_IDENTIFIERS.ADVANCED_FILTER_MANAGER) as any;
            const userYellowlist = await filterManager?.getUserFilters(userId, 'yellowlist') || [];
            const isInUserYellowlist = userYellowlist.some((filter: any) => filter.symbol === actualSymbol);

            // 优先级：系统级风险 > 个人黄名单
            if (systemRiskIcon) {
              riskIcon = systemRiskIcon + ' ';
            } else if (isInUserYellowlist) {
              riskIcon = '⚠️ ';
            }
          } catch (riskError: any) {
            console.log('Risk check failed:', riskError?.message || riskError);
          }
        }

        let priceMessage = `
💰 *${riskIcon}${symbol} ${isContract ? '合约' : '现货'}价格*

💵 当前价格: $${formattedPrice}
${changeIcon} 24小时涨跌: ${changeColor}${formattedChangePercent}%
📊 24小时交易量: ${(parseFloat(stats.volume) / 1000000).toFixed(2)}M USDT
🔺 24小时最高: $${formattedHighPrice}
🔻 24小时最低: $${formattedLowPrice}`;

        // 添加多时间框架数据
        if (Object.keys(timeframeData).length > 0) {
          priceMessage += `\n\n📊 *多时间框架涨跌:*\n`;
          const timeframeLabels = { '5m': '5分钟', '1h': '1小时', '4h': '4小时', '1d': '1天', '1w': '1周' };

          for (const tf of timeframes) {
            if (timeframeData[tf]) {
              const data = timeframeData[tf];
              const label = timeframeLabels[tf as keyof typeof timeframeLabels] || tf;
              priceMessage += `${data.icon} ${label}: ${data.sign}${formatPriceChange(Math.abs(data.change))}%\n`;
            }
          }
        }

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

    // 缓存系统状态命令（合并所有缓存状态）
    this.bot.command('cache_status', async (ctx) => {
      try {
        const cacheStatus = tieredDataManager.getCacheStatus();
        const refreshStats = tieredDataManager.getRefreshStats();
        const volumeStats = volumeClassifier.getVolumeStats();

        // 获取历史高价缓存状态
        const highCacheStatus = historicalHighCache.getCacheStatus();

        let statusMessage = `
📊 *缓存系统状态*

📈 *实时数据缓存:*
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
`;

        // 添加历史高价缓存状态
        if (highCacheStatus.totalEntries > 0) {
          const avgAgeHours = Math.floor(highCacheStatus.averageAge / (60 * 60 * 1000));
          const healthEmoji = highCacheStatus.cacheHealthy ? '✅' : '⚠️';
          statusMessage += `
📊 *历史高价缓存:*
• 总条目数: ${highCacheStatus.totalEntries.toLocaleString()}
• 数据健康: ${healthEmoji} ${highCacheStatus.cacheHealthy ? '健康' : '需要更新'}
• 平均年龄: ${avgAgeHours} 小时
• 最旧数据: ${new Date(highCacheStatus.oldestUpdate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
• 最新数据: ${new Date(highCacheStatus.newestUpdate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
`;

          if (!highCacheStatus.cacheHealthy) {
            statusMessage += `• 💡 建议: 使用 /cache_update 更新数据\n`;
          }
        } else {
          statusMessage += `
📊 *历史高价缓存:*
• ❌ 未初始化或无数据
`;
        }

        statusMessage += `\n⏰ 查询时间: ${formatTimeToUTC8(new Date())}`;

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

    // ==================== 潜力币信号推送命令 ====================
    // 信号定义：1h 窗口内 价格↑≥5% + OI↑≥20% + Funding 负/下降/松动
    this.bot.command('potential_status', async (ctx) => {
      try {
        const status = potentialAlertService.getStatus();
        const icon = status.enabled ? '🟢' : '🔴';
        let msg = `${icon} *潜力币信号推送*\n\n`;
        msg += `• 服务运行: ${status.running ? '✅' : '❌'}\n`;
        msg += `• 推送开关: ${status.enabled ? '启用' : '禁用'}\n`;
        msg += `• 扫描间隔: ${status.intervalMin} 分钟\n`;
        msg += `• 正在扫描: ${status.scanning ? '是' : '否'}\n\n`;
        msg += `📊 *今日统计:*\n`;
        msg += `  总触发: ${status.todayStats.total} 次\n`;
        msg += `  L1 极强: ${status.todayStats.byLevel[1] || 0}\n`;
        msg += `  L2 强: ${status.todayStats.byLevel[2] || 0}\n`;
        msg += `  L3 一般: ${status.todayStats.byLevel[3] || 0}\n\n`;
        msg += `💡 命令：\n`;
        msg += `\`/potential_on\` - 开启推送\n`;
        msg += `\`/potential_off\` - 关闭推送\n`;
        msg += `\`/potential\` - 立即手动扫描一次`;
        await ctx.replyWithMarkdown(msg);
      } catch (error) {
        log.error('potential_status command failed', error);
        await ctx.reply('❌ 查询状态失败');
      }
    });

    this.bot.command('potential_on', async (ctx) => {
      try {
        PotentialAlertModel.setEnabled(true);
        await ctx.reply('✅ 潜力币信号推送已开启\n\n下次扫描将在 10 分钟内触发\n使用 /potential 可立即手动扫描');
        log.info('PotentialAlertService enabled by user');
      } catch (error) {
        log.error('potential_on command failed', error);
        await ctx.reply('❌ 开启失败');
      }
    });

    this.bot.command('potential_off', async (ctx) => {
      try {
        PotentialAlertModel.setEnabled(false);
        await ctx.reply('🛑 潜力币信号推送已关闭\n\n定时扫描任务仍在运行但会直接跳过，再开启用 /potential_on');
        log.info('PotentialAlertService disabled by user');
      } catch (error) {
        log.error('potential_off command failed', error);
        await ctx.reply('❌ 关闭失败');
      }
    });

    this.bot.command('potential', async (ctx) => {
      try {
        await ctx.reply('🔍 正在扫描市场，这可能需要 30-60 秒...');
        const results = await potentialAlertService.manualScan();
        if (results.length === 0) {
          await ctx.reply('ℹ️ 当前市场没有满足潜力信号的币种');
          return;
        }
        // 按等级从高到低排序
        results.sort((a, b) => a.level - b.level);
        // 汇总改为纯文本（避免 Markdown 实体解析错误），用 emoji 区分等级
        let summary = `🎯 手动扫描结果：共 ${results.length} 个候选\n\n`;
        for (const r of results) {
          const icon = r.level === 1 ? '🚨' : r.level === 2 ? '⚡' : '📍';
          const name = r.symbol.replace('USDT', '');
          summary += `${icon} L${r.level} ${name} | 价${r.priceChange1h.toFixed(1)}% OI${r.oiChange1h.toFixed(1)}% 费率${(r.fundingRate8h * 100).toFixed(3)}%`;
          if (r.fundingIntervalHours !== 8) summary += ` ⚠️${r.fundingIntervalHours}h`;
          summary += `\n`;
        }
        summary += `\n💡 开启自动推送用 /potential_on`;
        await ctx.reply(summary);
      } catch (error) {
        log.error('potential command failed', error);
        await ctx.reply('❌ 手动扫描失败: ' + (error instanceof Error ? error.message : '未知错误'));
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
    try {
      // 优先使用 WebSocket 实时缓存数据，避免 REST API 调用触发频率限制
      const rankings = type === 'gainers'
        ? realtimeMarketCache.getTopGainers(count, 10000)
        : realtimeMarketCache.getTopLosers(count, 10000);

      if (!rankings || rankings.length === 0) {
        await ctx.reply(`❌ 实时数据尚未就绪，请稍后重试`);
        return;
      }

      const titleType = type === 'gainers' ? '涨幅' : '跌幅';
      let message = `📊 *${period} ${titleType}榜 TOP${rankings.length}*\n\n`;

      for (let i = 0; i < rankings.length; i++) {
        const ticker = rankings[i];
        const symbol = ticker.symbol.replace('USDT', '');
        const changePercent = ticker.priceChangePercent;
        const changeIcon = changePercent >= 0 ? '📈' : '📉';

        let priceText = '';
        try {
          const formattedPrice = await formatPriceWithSeparators(String(ticker.price), ticker.symbol);
          priceText = ` ($${formattedPrice})`;
        } catch (error) {
          priceText = '';
        }

        message += `${i + 1}. ${changeIcon} ${ticker.riskIcon}**${symbol}** ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%${priceText}\n`;
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
      '🔸 **历史突破警报 (重要功能)** 🚀\n' +
      '• `/alert_bt` - 全币种历史新高突破 (默认)\n' +
      '• `/alert_bt btc` - BTC历史新高突破\n' +
      '• `/alert_bt eth 1w` - ETH一周高点突破\n' +
      '• `/alert_bt all 1m` - 全币种一月高点突破\n' +
      '• 支持时间框架: 1w, 1m, 6m, 1y, all(历史)\n' +
      '• 缺省值: symbol=all(全币种), timeframe=all(历史)\n\n' +
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

      // 初始化ID管理器
      await AlertIdManager.initialize();

      // 查询统一警报系统
      const unifiedAlerts = await this.unifiedAlertService.getUserAlerts(userId);

      // 查询急涨急跌警报系统
      const timeBasedAlerts = await TimeRangeAlertModel.getUserAlerts(userId);

      if (unifiedAlerts.length === 0 && timeBasedAlerts.length === 0) {
        await ctx.reply('📭 您还没有设置任何警报\n\n💡 使用 /alert btc > 50000 或 /alert_5m_gain_3_all 创建警报');
        return;
      }

      const totalAlerts = unifiedAlerts.length + timeBasedAlerts.length;
      const activeAlerts = unifiedAlerts.filter(a => a.enabled).length + timeBasedAlerts.filter(a => a.isEnabled).length;

      let message = `📋 您的警报列表 (${totalAlerts}个)\n\n`;
      message += `📊 **统计**: 总计${totalAlerts}个, 活跃${activeAlerts}个, 暂停${totalAlerts - activeAlerts}个\n\n`;

      let alertIndex = 1;

      // 显示统一警报系统的警报
      for (const alert of unifiedAlerts) {
        const status = alert.enabled ? '🟢 启用' : '🔴 禁用';
        const description = AlertCommandParser.generateAlertDescription(alert);

        // 获取或生成简化ID
        let displayId = await AlertIdManager.findIdByOriginal(alert.id);
        if (!displayId) {
          // 如果没有简化ID，为现有警报创建一个
          const idType = AlertIdManager.getIdTypeFromAlertType(alert.type);
          displayId = await AlertIdManager.migrateExistingId(alert.id, idType, userId);
        }

        // 获取真实的统计数据
        const stats = await TimeRangeAlertModel.getAlertStats(parseInt(alert.id));

        message += `${alertIndex++}. ${status} 💰 价格警报\n`;
        message += `   📄 ${description}\n`;
        message += `   📊 触发统计: 今日${stats.todayTriggers}次, 本周${stats.weekTriggers}次, 历史${stats.totalTriggers}次\n`;
        message += `   🚫 屏蔽统计: 今日${stats.todayBlocked}次, 本周${stats.weekBlocked}次, 历史${stats.totalBlocked}次\n`;
        message += `   🆔 ID: ${displayId}\n`;
        message += `   🔔 优先级: ${alert.priority}\n\n`;
      }

      // 显示急涨急跌警报系统的警报
      for (const alert of timeBasedAlerts) {
        const status = alert.isEnabled ? '🟢 启用' : '🔴 禁用';
        const symbolText = alert.symbol || '所有代币';
        const timeText = this.formatTimeframe(alert.timeframe);
        const typeText = alert.alertType === 'gain' ? '涨幅' : alert.alertType === 'loss' ? '跌幅' : '涨跌幅';

        // 对于急涨急跌警报，创建或获取对应的简化ID
        const alertIdString = `T${alert.id}`;
        let displayId = await AlertIdManager.findIdByOriginal(alertIdString);
        if (!displayId) {
          displayId = await AlertIdManager.migrateExistingId(alertIdString, AlertIdType.PUMP_DUMP, userId);
        }

        // 获取真实的统计数据
        const timeStats = await TimeRangeAlertModel.getAlertStats(alert.id!);

        message += `${alertIndex++}. ${status} 🚀 急涨急跌警报\n`;
        message += `   📄 ${symbolText} ${timeText}内${typeText} ≥ ${alert.thresholdPercent}%\n`;
        message += `   📊 触发统计: 今日${timeStats.todayTriggers}次, 本周${timeStats.weekTriggers}次, 历史${timeStats.totalTriggers}次\n`;
        message += `   🚫 屏蔽统计: 今日${timeStats.todayBlocked}次, 本周${timeStats.weekBlocked}次, 历史${timeStats.totalBlocked}次\n`;
        message += `   🆔 ID: ${displayId}\n`;
        message += `   ⏰ 创建时间: ${new Date(alert.createdAt).toLocaleString('zh-CN')}\n\n`;
      }

      message += `💡 操作指南:\n`;
      message += `• 删除警报: /alert_remove <ID>\n`;
      message += `• 示例: /alert_remove P1 或 /alert_remove B2 或 /alert_remove T3\n`;
      message += `• 切换: /alert_toggle <ID>\n`;
      message += `• 历史: /alert_history [ID]\n`;
      message += `• 创建新警报: /alert btc > 50000 或 /alert_5m_gain_3_all`;

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
      await ctx.reply('❌ 请指定要删除的警报ID\n\n💡 示例: \n• 价格警报: /alert_remove P1\n• 突破警报: /alert_remove B2\n• 急涨急跌警报: /alert_remove T6');
      return;
    }

    try {
      const inputId = args[0];
      const userId = ctx.from?.id?.toString() || 'unknown';
      await ctx.reply(`🗑️ 正在删除警报 ${inputId}...`);

      // 初始化ID管理器
      await AlertIdManager.initialize();

      // 解析ID格式
      const parsedId = AlertIdManager.parseId(inputId);

      if (parsedId) {
        // 新的简化ID格式 (P1, B2, T3等)
        if (parsedId.type === 'T') {
          // 急涨急跌警报
          const numericId = parsedId.sequence;

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

          // 删除ID管理器中的记录
          await AlertIdManager.removeId(inputId);

          // 生成描述
          const symbolText = alert.symbol || '所有代币';
          const timeText = this.formatTimeframe(alert.timeframe);
          const typeText = alert.alertType === 'gain' ? '涨幅' : alert.alertType === 'loss' ? '跌幅' : '涨跌幅';
          const description = `${symbolText} ${timeText}内${typeText} ≥ ${alert.thresholdPercent}%`;

          await ctx.reply(
            `✅ 急涨急跌警报删除成功！\n\n` +
            `🗑️ **已删除警报:**\n` +
            `🚀 ${description}\n` +
            `🆔 ID: ${inputId}\n` +
            `⏰ 创建时间: ${new Date(alert.createdAt).toLocaleString('zh-CN')}`
          );

        } else {
          // 价格警报、突破警报等统一警报系统
          // 先尝试直接查找
          let alert = await this.unifiedAlertService.getAlert(inputId);

          if (!alert) {
            // 如果找不到，尝试查找是否有对应的原始ID
            const originalId = await AlertIdManager.findOriginalById(inputId);
            if (originalId) {
              alert = await this.unifiedAlertService.getAlert(originalId);
            }
          }

          if (!alert) {
            await ctx.reply('❌ 警报不存在或ID无效');
            return;
          }

          if (alert.metadata?.userId !== userId) {
            await ctx.reply('❌ 您只能删除自己的警报');
            return;
          }

          // 删除警报（使用实际的ID）
          await this.unifiedAlertService.removeAlert(alert.id);

          // 删除ID管理器中的记录
          await AlertIdManager.removeId(inputId);

          const description = AlertCommandParser.generateAlertDescription(alert);
          await ctx.reply(
            `✅ 警报删除成功！\n\n` +
            `🗑️ **已删除警报:**\n` +
            `💰 ${description}\n` +
            `🆔 ID: ${inputId}`
          );
        }

      } else {
        // 旧的复杂ID格式或T开头的急涨急跌警报（向后兼容）
        if (inputId.startsWith('T') && inputId.length > 1) {
          // 急涨急跌警报的旧格式处理
          const numericId = parseInt(inputId.substring(1));
          if (isNaN(numericId)) {
            await ctx.reply('❌ 无效的急涨急跌警报ID格式');
            return;
          }

          const timeBasedAlerts = await TimeRangeAlertModel.getUserAlerts(userId);
          const alert = timeBasedAlerts.find(a => a.id === numericId);

          if (!alert) {
            await ctx.reply('❌ 急涨急跌警报不存在或ID无效');
            return;
          }

          const success = await TimeRangeAlertModel.deleteAlert(numericId, userId);
          if (!success) {
            await ctx.reply('❌ 删除急涨急跌警报失败');
            return;
          }

          const symbolText = alert.symbol || '所有代币';
          const timeText = this.formatTimeframe(alert.timeframe);
          const typeText = alert.alertType === 'gain' ? '涨幅' : alert.alertType === 'loss' ? '跌幅' : '涨跌幅';
          const description = `${symbolText} ${timeText}内${typeText} ≥ ${alert.thresholdPercent}%`;

          await ctx.reply(
            `✅ 急涨急跌警报删除成功！\n\n` +
            `🗑️ **已删除警报:**\n` +
            `🚀 ${description}\n` +
            `🆔 ID: ${inputId}\n` +
            `⏰ 创建时间: ${new Date(alert.createdAt).toLocaleString('zh-CN')}`
          );

        } else {
          // 价格警报、突破警报的旧复杂ID格式
          const alert = await this.unifiedAlertService.getAlert(inputId);
          if (!alert) {
            await ctx.reply('❌ 警报不存在或ID无效');
            return;
          }

          if (alert.metadata?.userId !== userId) {
            await ctx.reply('❌ 您只能删除自己的警报');
            return;
          }

          await this.unifiedAlertService.removeAlert(inputId);

          const description = AlertCommandParser.generateAlertDescription(alert);
          await ctx.reply(
            `✅ 警报删除成功！\n\n` +
            `🗑️ **已删除警报:**\n` +
            `💰 ${description}\n` +
            `🆔 ID: ${inputId}`
          );
        }
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
        const countNum = Number(count);
        if (countNum > 0) {
          message += `• ${this.getAlertTypeText(type)}: ${countNum}\n`;
        }
      }

      // 按优先级统计
      message += `\n🔔 **按优先级统计:**\n`;
      for (const [priority, count] of Object.entries(stats.byPriority)) {
        const countNum = Number(count);
        if (countNum > 0) {
          const icon = this.getPriorityIcon(priority);
          message += `• ${icon} ${priority}: ${countNum}\n`;
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
      case 'breakthrough': return '历史突破警报';
      case 'multi_breakthrough': return '全币种突破警报';
      case 'custom': return '自定义';
      default: return type;
    }
  }

  /**
   * HTML转义函数，防止特殊字符破坏HTML格式
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /**
   * 生成帮助内容（统一的help文档）
   */
  public generateHelpContent(): string {
    return `📖 Crypto Alert Bot 完整功能指南

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

🔸 突破警报 (重要功能) 🚀:
/alert_bt - 全币种历史新高突破 (默认)
/alert_bt btc - BTC历史新高突破
/alert_bt eth 1w - ETH一周高点突破
/alert_bt all 1m - 全币种一月高点突破

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

🎯 潜力币信号 (24h窗口):
信号定义: 价格↑ + OI↑ + Funding↓/负/松动 = 聪明钱入场信号
/potential - 立即手动扫描一次当前市场
/potential_on - 开启后台自动推送 (每10分钟)
/potential_off - 关闭自动推送
/potential_status - 查看推送状态和今日统计
触发条件: 24h价格 ≥+5%, 24h OI ≥+20%, Funding 负/下降/松动
等级: L1(funding≤-0.5%) / L2(≤-0.1%) / L3(其他)
冷却: 同级2小时; 等级升高立即推
自动过滤: 系统黑名单 + 个人黑黄/mute名单

📈 历史分析:
/high btc 1w - BTC一周高点
/high near 1m - 接近月高点币种 🆕
/high near - 接近历史高点币种 🆕

🛡️ 过滤管理:
🔒 黑名单(完全屏蔽):
/blacklist_add <symbol> - 添加个人黑名单
/blacklist_remove <symbol> - 移除黑名单
/blacklist_list - 查看过滤规则状态

⚠️ 黄名单(警告标记):
/yellowlist_add <symbol> [reason] - 添加个人黄名单
/yellowlist_remove <symbol> - 移除黄名单
/yellowlist_list - 查看黄名单规则状态
/yellowlist_clear - 清空个人黄名单

🔇 临时屏蔽(定时解除):
/mute_add <symbol> <duration> - 临时屏蔽代币
/mute_remove <symbol> - 解除屏蔽
/mute_list - 查看屏蔽列表
/mute_clear - 清空所有屏蔽

⚙️ 过滤设置:
/filter_settings - 查看过滤设置
/filter_volume <amount> - 设置交易量阈值
/filter_auto on/off - 启用/禁用自动过滤

⚙️ 系统:
/status - 系统状态
/cache_status - 所有缓存系统状态
/cache_update - 更新缓存数据 (管理员)
/help - 显示帮助

💡 使用提示:
• 所有命令支持直接点击执行
• 警报系统支持两种类型统一管理
• 推送服务可独立开关
• 支持多币种同时监控`;
  }

  /**
   * 处理警报创建
   */
  private async handleAlertCreate(ctx: any, args: string[]): Promise<void> {
    if (!args || args.length < 2) {
      await ctx.reply('❌ 警报参数不足\n\n💡 示例:\n• /alert btc > 50000\n• /alert breakthrough btc 1w\n• /alert bt all 1m');
      return;
    }

    // 检查是否为突破警报，需要特殊处理参数数量
    const isBreakthroughAlert = args[0].toLowerCase() === 'breakthrough' || args[0].toLowerCase() === 'bt';
    if (!isBreakthroughAlert && args.length < 3) {
      await ctx.reply('❌ 价格警报参数不足\n\n💡 示例: /alert btc > 50000');
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
      const alertConfig = await AlertCommandParser.toAlertConfig(parsed, userId, chatId);

      // 注册警报
      await this.unifiedAlertService.registerAlert(alertConfig);

      // 生成描述
      const description = AlertCommandParser.generateAlertDescription(alertConfig);

      await ctx.reply(
        `✅ 警报创建成功！\n\n` +
        `🎯 <b>警报详情:</b>\n` +
        `📄 描述: ${this.escapeHtml(description)}\n` +
        `🆔 ID: <code>${this.escapeHtml(alertConfig.id)}</code>\n` +
        `⏰ 冷却时间: ${alertConfig.cooldownMs / 1000}秒\n` +
        `🔔 优先级: ${alertConfig.priority}\n\n` +
        `💡 使用 /alert_list 查看所有警报`,
        { parse_mode: 'HTML' }
      );

    } catch (error) {
      log.error('Failed to create alert:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await ctx.reply(`❌ 创建警报失败: ${errorMessage}`);
    }
  }

  /**
   * 处理突破警报创建
   */
  private async handleBreakthroughAlert(ctx: any, args: string[]): Promise<void> {
    try {
      // 设置缺省值：symbol = 'all', timeframe = 'all'
      let symbol = 'all';
      let timeframe = 'all';

      // 解析参数
      if (args && args.length >= 1) {
        symbol = args[0];
        if (args.length >= 2) {
          timeframe = args[1];
        }
      }

      await ctx.reply(`⚡ 正在创建突破警报: ${symbol} ${timeframe}...`);

      // 构造breakthrough格式的参数
      const breakthroughArgs = ['breakthrough', symbol, timeframe];

      // 解析警报命令
      const parsed = AlertCommandParser.parseAlertCommand(breakthroughArgs);
      const userId = ctx.from?.id?.toString() || '';
      const chatId = ctx.chat?.id || 0;

      // 生成警报配置
      const alertConfig = await AlertCommandParser.toAlertConfig(parsed, userId, chatId);

      // 注册警报
      await this.unifiedAlertService.registerAlert(alertConfig);

      // 生成描述
      const description = AlertCommandParser.generateAlertDescription(alertConfig);

      await ctx.reply(
        `✅ 突破警报创建成功！\n\n` +
        `🎯 <b>警报详情:</b>\n` +
        `📄 描述: ${this.escapeHtml(description)}\n` +
        `🆔 ID: <code>${this.escapeHtml(alertConfig.id)}</code>\n` +
        `⏰ 冷却时间: ${alertConfig.cooldownMs / 1000}秒\n` +
        `🔔 优先级: ${alertConfig.priority}\n\n` +
        `💡 使用 /alert_list 查看所有警报\n\n` +
        `🚀 <b>使用说明:</b>\n` +
        `• /alert_bt - 全币种历史突破 (默认)\n` +
        `• /alert_bt btc - BTC历史突破\n` +
        `• /alert_bt eth 1w - ETH一周突破\n` +
        `• /alert_bt all 1m - 全币种一个月突破`,
        { parse_mode: 'HTML' }
      );

    } catch (error) {
      log.error('Failed to create breakthrough alert:', error);
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      await ctx.reply(`❌ 创建突破警报失败: ${errorMessage}`);
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

    // 突破警报下划线命令
    this.bot.command('alert_bt', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);
      await this.handleBreakthroughAlert(ctx, args);
    });

    this.bot.command('alert_breakthrough', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1);
      await this.handleBreakthroughAlert(ctx, args);
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

    // 历史相关下划线命令
    this.bot.command('high', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);

        if (args.length === 0) {
          const helpMessage = `**📊 历史高价查询命令帮助**

**代币查询:**
• \`/high <symbol>\` - 查看代币历史最高价
• \`/high <symbol> <timeframe>\` - 查看指定时间框架历史高价
• \`/high <timeframe> all\` - 查看该时间框架排名

**接近高点查询(新功能):**
• \`/high near\` - 查看接近历史高点的币种
• \`/high near <timeframe>\` - 查看接近指定时间框架高点的币种
• \`/high list <timeframe>\` - 同上(别名)

**示例:**
• \`/high sol\` - SOL的历史最高价
• \`/high btc 1m\` - BTC的1个月历史高价
• \`/high 1w all\` - 1周历史高价排名
• \`/high near\` - 最接近历史高点的币种
• \`/high near 1m\` - 最接近1个月高点的币种

**时间框架:**
\`1w\` (1周) | \`1m\` (1个月) | \`6m\` (6个月) | \`1y\` (1年) | \`all\` (全部历史)`;

          await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
          return;
        }

        const firstArg = args[0].toLowerCase();
        const secondArg = args[1]?.toLowerCase();

        // 新功能：/high near [timeframe] - 查看接近高点的币种
        if (firstArg === 'near' || firstArg === 'list') {
          const timeframe = secondArg || 'all'; // 默认历史高点
          return this.handleNearHighCommand(ctx, timeframe);
        }

        const symbol = firstArg;
        const param = secondArg;

        // 特殊处理 "all" 命令：/high sol all
        if (param === 'all') {
          const timeframe = symbol;
          const validTimeframes = ['1w', '1m', '6m', '1y', 'all'];

          if (!validTimeframes.includes(timeframe)) {
            await ctx.reply(`❌ 排名查询的时间框架无效: ${timeframe}\\n有效选项: ${validTimeframes.join(', ')}`, { parse_mode: 'Markdown' });
            return;
          }

          await ctx.reply('📊 正在查询历史高价排名...');

          // 获取排名数据（限制前20个）
          const rankings = historicalHighCache.getRankingByProximityToHigh(timeframe, 20);

          if (rankings.length === 0) {
            await ctx.reply(`❌ 时间框架 ${timeframe} 暂无排名数据`);
            return;
          }

          // 格式化排名消息
          const timeframeNames: Record<string, string> = {
            '1w': '1周',
            '1m': '1个月',
            '6m': '6个月',
            '1y': '1年',
            'all': '历史'
          };

          let message = `📊 **${timeframeNames[timeframe]}历史高价排名 TOP${Math.min(rankings.length, 15)}**\n\n`;
          message += `_按需要涨幅由小到大排序_\n\n`;

          rankings.slice(0, 15).forEach((item: any, index: number) => {
            const symbolName = item.symbol.replace('USDT', '');
            const emoji = item.neededGainPercent === 0 ? '🚀' : index < 3 ? '🔥' : '📈';
            const gainText = item.neededGainPercent === 0
              ? `新高🎉`
              : `需涨${item.neededGainPercent.toFixed(1)}%`;

            message += `${emoji} **${index + 1}. ${symbolName}** ${gainText}\n`;
            message += `   $${item.currentPrice.toFixed(6)} (最高: $${item.highPrice.toFixed(6)})\n\n`;
          });

          if (rankings.length > 15) {
            message += `_... 还有 ${rankings.length - 15} 个代币_\n\n`;
          }

          // 添加缓存时间显示 - 取第一个代币的缓存时间作为代表
          if (rankings.length > 0 && rankings[0].lastUpdated) {
            const cacheUpdateTime = new Date(rankings[0].lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            message += `\n🕒 **数据时间**: ${cacheUpdateTime}`;
          }

          await ctx.reply(message, { parse_mode: 'Markdown' });

        } else {
          // 处理单个代币查询：/high sol 或 /high sol 1w
          const timeframe = param || 'all'; // 默认历史全部
          const validTimeframes = ['1w', '1m', '6m', '1y', 'all'];

          if (!validTimeframes.includes(timeframe)) {
            await ctx.reply(`❌ 无效的时间框架: ${timeframe}\\n有效选项: ${validTimeframes.join(', ')}`, { parse_mode: 'Markdown' });
            return;
          }

          // 标准化代币符号
          let normalizedSymbol = symbol.toUpperCase();
          if (!normalizedSymbol.endsWith('USDT') && !normalizedSymbol.endsWith('USD')) {
            normalizedSymbol = normalizedSymbol + 'USDT';
          }

          await ctx.reply(`📈 正在查询 ${normalizedSymbol} 的${timeframe === 'all' ? '历史最高价' : timeframe + '高价'}...`);

          // 查询历史高价数据
          const data = historicalHighCache.queryHistoricalHigh(normalizedSymbol, timeframe);

          if (!data) {
            await ctx.reply(`❌ 未找到 ${normalizedSymbol} 的历史高价数据 (${timeframe})`);
            return;
          }

          // 格式化响应消息
          const {
            currentPrice,
            highPrice,
            highTimestamp,
            neededGainPercent
          } = data;

          const timeframeNames: Record<string, string> = {
            '1w': '1周',
            '1m': '1个月',
            '6m': '6个月',
            '1y': '1年',
            'all': '历史'
          };

          const highDate = new Date(highTimestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          const distanceEmoji = neededGainPercent === 0 ? '🚀' : '📊';

          let message = `${distanceEmoji} **${normalizedSymbol} - ${timeframeNames[timeframe]}历史高价分析**\n\n`;
          message += `💰 **当前价格**: $${currentPrice.toFixed(6)}\n`;
          message += `🎯 **历史最高**: $${highPrice.toFixed(6)} (${highDate})\n`;

          if (neededGainPercent === 0) {
            message += `🎉 **已创新高**: 当前价格就是${timeframeNames[timeframe]}最高价!\n`;
          } else {
            message += `📈 **需要涨幅**: ${neededGainPercent.toFixed(2)}% 回到${timeframeNames[timeframe]}高点\n`;
            const daysDiff = Math.floor((Date.now() - highTimestamp) / (24 * 60 * 60 * 1000));
            message += `⏰ **时间差**: ${daysDiff}天前\n`;
          }

          // 添加缓存更新时间
          const cacheUpdateTime = new Date(data.lastUpdated).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
          message += `\n🕒 **数据时间**: ${cacheUpdateTime}`;

          await ctx.reply(message, { parse_mode: 'Markdown' });
        }

      } catch (error) {
        log.error('Historical high query failed:', error);
        await ctx.reply('❌ 历史高价查询失败，请稍后重试');
      }
    });

    this.bot.command('near_high', async (ctx) => {
      try {
        const args = ctx.message?.text.split(' ').slice(1);
        const timeframe = args[0] || 'all'; // 默认历史高点

        // 重定向用户使用新命令并执行功能
        await ctx.reply(`💡 **命令已升级！** 建议使用新的命令格式：\n\`/high near ${timeframe}\`\n\n正在为您查询...`);

        // 调用新的处理逻辑
        await this.handleNearHighCommand(ctx, timeframe);

      } catch (error) {
        log.error('near_high命令处理失败:', error);
        await ctx.reply('❌ 查询失败，请使用新命令: /high near [timeframe]');
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

    // Filter相关下划线命令
    this.bot.command('blacklist_add', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定要添加的代币符号\n用法: /blacklist_add &lt;symbol&gt; [reason]\n示例: /blacklist_add SHIB 垃圾币');
        return;
      }
      const result = await this.blacklistCommandHandler.handle(ctx, ['add', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('blacklist_remove', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定要移除的代币符号\n用法: /blacklist_remove &lt;symbol&gt;\n示例: /blacklist_remove DOGE');
        return;
      }
      const result = await this.blacklistCommandHandler.handle(ctx, ['remove', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('blacklist_list', async (ctx) => {
      const result = await this.blacklistCommandHandler.handle(ctx, ['list']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('blacklist_clear', async (ctx) => {
      const result = await this.blacklistCommandHandler.handle(ctx, ['clear']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('yellowlist_add', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定要添加的代币符号\n用法: /yellowlist_add &lt;symbol&gt; [reason]\n示例: /yellowlist_add DOGE 高波动性代币');
        return;
      }
      const result = await this.yellowlistCommandHandler.handle(ctx, ['add', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('yellowlist_remove', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定要移除的代币符号\n用法: /yellowlist_remove &lt;symbol&gt;\n示例: /yellowlist_remove DOGE');
        return;
      }
      const result = await this.yellowlistCommandHandler.handle(ctx, ['remove', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('yellowlist_list', async (ctx) => {
      const result = await this.yellowlistCommandHandler.handle(ctx, ['list']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('yellowlist_clear', async (ctx) => {
      const result = await this.yellowlistCommandHandler.handle(ctx, ['clear']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('mute_add', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length < 2) {
        await ctx.reply('❌ 参数不足\n用法: /mute_add &lt;symbol&gt; &lt;duration&gt; [reason]\n示例: /mute_add DOGE 2h 波动太大\n\n时间格式: 30m, 2h, 1d, 1w');
        return;
      }
      const result = await this.muteCommandHandler.handle(ctx, args);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('mute_remove', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定要解除屏蔽的代币符号\n用法: /mute_remove &lt;symbol&gt;\n示例: /mute_remove BTC');
        return;
      }
      const result = await this.muteCommandHandler.handle(ctx, ['remove', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('mute_list', async (ctx) => {
      const result = await this.muteCommandHandler.handle(ctx, ['list']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('mute_clear', async (ctx) => {
      const result = await this.muteCommandHandler.handle(ctx, ['clear']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('filter_settings', async (ctx) => {
      const result = await this.filterCommandHandler.handle(ctx, ['settings']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('filter_volume', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定交易量阈值\n用法: /filter_volume &lt;amount&gt;\n示例: /filter_volume 10 (表示10M USDT)');
        return;
      }
      const result = await this.filterCommandHandler.handle(ctx, ['volume', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('filter_auto', async (ctx) => {
      const args = ctx.message?.text.split(' ').slice(1) || [];
      if (args.length === 0) {
        await ctx.reply('❌ 请指定开关状态\n用法: /filter_auto on|off\n示例: /filter_auto on');
        return;
      }
      const result = await this.filterCommandHandler.handle(ctx, ['auto', ...args]);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
      }
    });

    this.bot.command('filter_stats', async (ctx) => {
      const result = await this.filterCommandHandler.handle(ctx, ['stats']);
      if (result.shouldReply && result.message) {
        await ctx.reply(result.message, { parse_mode: 'Markdown' });
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

    // Cache update 命令 - 手动更新缓存数据
    this.bot.command('cache_update', async (ctx) => {
      try {
        const userId = ctx.from?.id?.toString();
        if (!userId || userId !== process.env.TELEGRAM_USER_ID) {
          await ctx.reply('❌ 您没有权限执行此命令');
          return;
        }

        const args = ctx.message?.text.split(' ').slice(1);
        const hoursThreshold = args[0] ? parseInt(args[0]) : 24;

        if (isNaN(hoursThreshold) || hoursThreshold <= 0 || hoursThreshold > 168) {
          await ctx.reply('❌ 时间阈值必须是1-168小时之间的数字\n\n用法：/cache_update [小时数]\n示例：/cache_update 12 （更新12小时前的数据）');
          return;
        }

        await ctx.reply(`🔄 开始检查和更新 ${hoursThreshold} 小时前的缓存数据...`);

        // 获取缓存状态
        const status = historicalHighCache.getCacheStatus();
        const statusMessage = `📊 **当前缓存状态**\n\n` +
          `📈 **总条目数**: ${status.totalEntries.toLocaleString()}\n` +
          `🕒 **数据健康**: ${status.cacheHealthy ? '✅ 健康' : '⚠️ 需要更新'}\n` +
          `📅 **平均数据年龄**: ${Math.floor(status.averageAge / (60 * 60 * 1000))} 小时\n` +
          `🔄 **最旧数据**: ${new Date(status.oldestUpdate).toLocaleString('zh-CN')}\n` +
          `🆕 **最新数据**: ${new Date(status.newestUpdate).toLocaleString('zh-CN')}\n\n`;

        await ctx.reply(statusMessage, { parse_mode: 'Markdown' });

        // 执行手动更新
        const updateResult = await historicalHighCache.triggerManualUpdate(hoursThreshold);

        if (updateResult.success) {
          let resultMessage = `✅ **缓存更新完成！**\n\n${updateResult.message}`;

          if (updateResult.updateResult) {
            const { failed, newHighs, totalUpdated } = updateResult.updateResult;
            resultMessage += `\n\n📊 **详细统计**:\n`;
            resultMessage += `✅ 成功更新: ${totalUpdated} 个币种\n`;
            resultMessage += `❌ 更新失败: ${failed.length} 个币种\n`;
            resultMessage += `🎉 发现新高: ${newHighs.length} 个币种\n`;

            if (newHighs.length > 0) {
              resultMessage += `\n🚀 **新高币种**: ${newHighs.slice(0, 10).join(', ')}`;
              if (newHighs.length > 10) {
                resultMessage += ` 等${newHighs.length}个`;
              }
            }

            if (failed.length > 0 && failed.length <= 5) {
              resultMessage += `\n⚠️ **失败币种**: ${failed.join(', ')}`;
            }
          }

          await ctx.reply(resultMessage, { parse_mode: 'Markdown' });
        } else {
          await ctx.reply(`❌ **缓存更新失败**\n\n${updateResult.message}`, { parse_mode: 'Markdown' });
        }

      } catch (error) {
        log.error('Cache update命令处理失败:', error);
        await ctx.reply('❌ 缓存更新失败，请稍后重试');
      }
    });

  }

  /**
   * 处理接近高点查询的逻辑
   */
  private async handleNearHighCommand(ctx: any, timeframe: string): Promise<void> {
    try {
      // 验证时间框架
      const validTimeframes = ['1w', '1m', '6m', '1y', 'all'];
      if (!validTimeframes.includes(timeframe)) {
        await ctx.reply(`❌ 无效的时间框架: ${timeframe}\n有效选项: ${validTimeframes.join(', ')}`);
        return;
      }

      // 时间框架名称映射
      const timeframeNames: Record<string, string> = {
        '1w': '1周',
        '1m': '1个月',
        '6m': '6个月',
        '1y': '1年',
        'all': '历史'
      };

      await ctx.reply(`📈 正在查询接近${timeframeNames[timeframe]}高点的币种...`);

      // 获取排名数据
      let rankings = historicalHighCache.getRankingByProximityToHigh(timeframe, 100);

      if (rankings.length === 0) {
        await ctx.reply(`❌ 时间框架 ${timeframe} 暂无数据`);
        return;
      }

      // 批量更新前20个币种的实时价格
      try {
        await ctx.reply('📈 正在获取实时价格...');

        const symbolsToUpdate = rankings.slice(0, 20).map(r => r.symbol);
        console.log(`🔄 Updating real-time prices for near-high command: ${symbolsToUpdate.length} symbols`);

        const updateResult = await historicalHighCache.batchIncrementalUpdate(symbolsToUpdate, 1);
        console.log(`✅ Updated ${updateResult.success.length} symbols for near-high command`);

        // 重新获取更新后的排名
        rankings = historicalHighCache.getRankingByProximityToHigh(timeframe, 100);
      } catch (updateError) {
        console.warn('Failed to update prices for near-high command, using cached data:', updateError);
      }

      // 筛选接近高点的币种（需要涨幅小于20%）
      const nearHighCoins = rankings.filter(coin =>
        coin &&
        coin.neededGainPercent != null &&
        coin.neededGainPercent > 0 &&
        coin.neededGainPercent <= 20 &&
        coin.currentPrice != null &&
        coin.highPrice != null
      ).slice(0, 15);

      if (nearHighCoins.length === 0) {
        await ctx.reply(`📊 当前没有币种接近${timeframeNames[timeframe]}高点\n(定义：距离高点20%以内)`);
        return;
      }

      // 格式化消息
      let message = `🎯 **接近${timeframeNames[timeframe]}高点的币种 TOP${nearHighCoins.length}**\n\n`;
      message += `_需要涨幅20%以内，按接近程度排序_\n\n`;

      nearHighCoins.forEach((coin, index) => {
        const symbol = coin.symbol.replace('USDT', '');
        const emoji = coin.neededGainPercent <= 5 ? '🔥' : coin.neededGainPercent <= 10 ? '⚡' : '📈';
        const neededGain = (coin.neededGainPercent || 0).toFixed(2);

        // 安全的价格格式化
        const currentPriceStr = coin.currentPrice ? coin.currentPrice.toFixed(6) : '0.000000';
        const highPriceStr = coin.highPrice ? coin.highPrice.toFixed(6) : '0.000000';

        message += `${emoji} **${index + 1}. ${symbol}** 还需涨 ${neededGain}%\n`;
        message += `   $${currentPriceStr} → $${highPriceStr}\n\n`;
      });

      // 添加统计信息
      const veryClose = nearHighCoins.filter(c => c && c.neededGainPercent != null && c.neededGainPercent <= 5).length;
      const close = nearHighCoins.filter(c => c && c.neededGainPercent != null && c.neededGainPercent <= 10).length;

      message += `📊 **距离统计**\n`;
      message += `🔥 5%以内: ${veryClose}个  ⚡ 10%以内: ${close}个\n\n`;

      // 显示实时更新时间
      const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      message += `🕒 **数据时间**: ${now} ⚡`;

      await ctx.replyWithMarkdown(message);

    } catch (error) {
      log.error('接近高点查询失败:', error);
      await ctx.reply('❌ 接近高点查询失败，请稍后重试');
    }
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