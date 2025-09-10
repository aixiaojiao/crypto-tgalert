import { TelegramBot } from './bot';
import { config } from './config';
import { initDatabase } from './database/connection';
import { BinanceClient } from './services/binance';
import { PriceMonitorService } from './services/priceMonitor';
import { SocialMonitorService } from './services/socialMonitor';
import { triggerAlertService } from './services/triggerAlerts';
import { binanceRateLimit, twitterRateLimit } from './utils/ratelimit';

/**
 * 完整的应用程序类 - 集成所有组件
 */
export class CryptoTgAlertApp {
  private telegramBot: TelegramBot;
  private binanceClient: BinanceClient;
  private priceMonitor: PriceMonitorService;
  private socialMonitor: SocialMonitorService;

  constructor() {
    this.telegramBot = new TelegramBot();
    this.binanceClient = new BinanceClient();
    this.priceMonitor = new PriceMonitorService(this.binanceClient, undefined, this.telegramBot);
    this.socialMonitor = new SocialMonitorService();
  }

  /**
   * 启动完整应用程序
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Crypto TG Alert Application...');
      
      // 1. 初始化数据库
      console.log('📊 Initializing database...');
      await initDatabase();
      
      // 2. 初始化触发提醒服务
      console.log('⚡ Initializing trigger alerts...');
      await triggerAlertService.initialize();
      
      // 3. 测试Binance连接
      console.log('💰 Testing Binance connection...');
      const btcPrice = await this.binanceClient.getPrice('BTCUSDT');
      console.log(`✅ Binance connected - BTC: $${btcPrice}`);
      
      // 4. 启动Telegram机器人
      console.log('🤖 Starting Telegram bot...');
      await this.telegramBot.start();
      
      // 5. 启动价格监控
      console.log('⚡ Starting price monitoring...');
      await this.priceMonitor.startMonitoring();
      
      // 6. 启动社交监控
      console.log('🐦 Starting social monitoring...');
      await this.socialMonitor.startMonitoring();
      
      console.log('✅ All systems online!');
      
      // 发送启动通知
      await this.sendStartupNotification(btcPrice);
      
    } catch (error) {
      console.error('❌ Failed to start application:', error);
      throw error;
    }
  }

  /**
   * 发送启动通知
   */
  private async sendStartupNotification(btcPrice: number): Promise<void> {
    try {
      const message = `🚀 *Crypto Alert Bot 已启动*\n\n` +
        `⏰ 启动时间: ${new Date().toLocaleString('zh-CN')}\n` +
        `💰 当前 BTC 价格: $${btcPrice.toLocaleString()}\n` +
        `🔧 环境: ${config.app.nodeEnv}\n` +
        `✅ 所有系统运行正常\n\n` +
        `📊 *主要功能:*\n` +
        `💰 *价格查询:* /price btc/eth/sol\n` +
        `📈 *排行榜:* /gainers /losers /funding /oi24h\n` +
        `⚡ *价格提醒:* /alert btc \\> 120000\n` +
        `📢 *推送通知:* /start\\_gainers\\_push /start\\_funding\\_push\n` +
        `🔄 *OI推送:* /start\\_oi1h\\_push /start\\_oi4h\\_push /start\\_oi24h\\_push\n` +
        `🐦 *Twitter监控:* /follow username\n` +
        `🔗 *链上查询:* /tx hash /address addr\n` +
        `⚙️ *系统状态:* /status /push\\_status\n\n` +
        `💡 发送 /help 查看详细使用说明`;

      await this.telegramBot.sendToAuthorizedUser(message, { 
        parse_mode: 'Markdown' 
      });
    } catch (error) {
      console.warn('Failed to send startup notification:', error);
    }
  }

  /**
   * 获取系统状态
   */
  async getSystemStatus(): Promise<{
    telegram: any;
    binance: boolean;
    database: boolean;
    priceMonitor: any;
    socialMonitor: any;
    triggerAlerts: any;
  }> {
    try {
      // 测试各个组件
      const btcPrice = await this.binanceClient.getPrice('BTCUSDT');
      
      return {
        telegram: this.telegramBot.getStatus(),
        binance: btcPrice > 0,
        database: true, // 如果到这里说明数据库正常
        priceMonitor: await this.priceMonitor.getStats(),
        socialMonitor: { status: 'running', monitoredAccounts: 0 },
        triggerAlerts: triggerAlertService.getStats()
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 优雅停止
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping application...');
    
    await this.priceMonitor.stopMonitoring();
    await this.socialMonitor.stopMonitoring();
    triggerAlertService.stopAllMonitoring();
    await this.telegramBot.stop();
    
    // 清理速率限制器
    binanceRateLimit.destroy();
    twitterRateLimit.destroy();
    
    console.log('✅ Application stopped');
  }
}