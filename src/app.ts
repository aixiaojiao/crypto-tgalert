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
        `📊 可用功能:\n` +
        `• /price btc - 查询价格\n` +
        `• /alert btc > 120000 - 设置价格提醒\n` +
        `• /start_gainers_push - 启动涨幅榜推送\n` +
        `• /start_funding_push - 启动负费率榜推送\n` +
        `• /follow elonmusk - 关注Twitter账户\n` +
        `• /help - 查看完整帮助`;

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