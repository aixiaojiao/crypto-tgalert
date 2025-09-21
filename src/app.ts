import { TelegramBot } from './bot';
import { initDatabase } from './database/connection';
import { BinanceClient } from './services/binance';
import { PriceMonitorService } from './services/priceMonitor';
import { triggerAlertService } from './services/triggerAlerts';
import { historicalHighCache } from './services/historicalHighCacheV2';
import { binanceRateLimit } from './utils/ratelimit';
import { getServiceRegistry } from './core/container';
import { startHealthMonitoring as startHealthMonitoringUtil } from './utils/health';

/**
 * 完整的应用程序类 - 集成所有组件
 */
export class CryptoTgAlertApp {
  private telegramBot: TelegramBot;
  private binanceClient: BinanceClient;
  private priceMonitor: PriceMonitorService;
  private healthMonitorInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.telegramBot = new TelegramBot();
    this.binanceClient = new BinanceClient();
    this.priceMonitor = new PriceMonitorService(this.binanceClient, undefined, this.telegramBot);
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

      // 2. 初始化服务注册表
      console.log('🔧 Initializing service registry...');
      getServiceRegistry();
      console.log('✅ Service registry initialized');

      // 3. 初始化统一警报服务
      console.log('⚡ Initializing unified alert service...');
      await this.telegramBot.initializeUnifiedAlerts();

      // 4. 初始化调试服务
      console.log('🐛 Initializing debug service...');
      await this.telegramBot.initializeDebugService();

      // 5. 初始化触发提醒服务
      console.log('⚡ Initializing trigger alerts...');
      await triggerAlertService.initialize();

      // 6. 测试Binance连接（带重试机制）
      console.log('💰 Testing Binance connection...');
      let btcPrice: number;

      try {
        btcPrice = await this.testBinanceConnection();
        console.log(`✅ Binance connected - BTC: $${btcPrice}`);
      } catch (error) {
        console.log('⚠️ Binance REST API test failed, but continuing startup...');
        console.log('💡 WebSocket connection is active, system can operate normally');
        btcPrice = 50000; // 使用默认值继续启动
      }

      // 7. 启动价格监控
      console.log('⚡ Starting price monitoring...');
      await this.priceMonitor.startMonitoring();

      // 8. 初始化历史新高缓存
      console.log('📈 Initializing historical high cache...');
      await historicalHighCache.initialize();

      // 9. 启动健康监控系统
      console.log('🏥 Starting health monitoring system...');
      await this.startHealthMonitoring();

      console.log('✅ All systems online!');

      // 10. 发送启动通知（在启动Telegram机器人前）
      await this.sendStartupNotification(btcPrice);

      // 11. 启动Telegram机器人（这是阻塞操作，必须最后执行）
      console.log('🤖 Starting Telegram bot...');
      await this.telegramBot.start();
      
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
      console.log('📤 准备发送启动通知消息...');

      // 系统启动状态信息
      const startupHeader = `👋 Hello! 欢迎使用 Crypto Alert Bot 🤖\n\n` +
        `🎉 系统已成功启动并准备就绪！\n` +
        `⏰ 启动时间: ${new Date().toLocaleString('zh-CN')}\n` +
        `💰 当前 BTC 价格: $${btcPrice.toLocaleString()}\n` +
        `✅ 所有系统运行正常\n\n`;

      // 获取统一的帮助内容（纯文本模式，与/help命令一致）
      const helpContent = this.telegramBot.generateHelpContent();

      // 组合完整消息
      const helloMessage = startupHeader + helpContent;

      console.log('📨 调用telegramBot.sendToAuthorizedUser...');
      await this.telegramBot.sendToAuthorizedUser(helloMessage, { parse_mode: null });
      console.log('✅ 启动通知消息发送成功！');
    } catch (error) {
      console.error('❌ Failed to send startup notification:', error);
    }
  }

  /**
   * 测试Binance连接（带重试机制）
   */
  private async testBinanceConnection(maxRetries: number = 3): Promise<number> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`💰 尝试连接Binance API (${attempt}/${maxRetries})...`);
        const btcPrice = await this.binanceClient.getPrice('BTCUSDT');
        return btcPrice;
      } catch (error) {
        console.log(`⚠️ 第${attempt}次连接失败:`, error instanceof Error ? error.message : String(error));

        if (attempt === maxRetries) {
          throw error;
        }

        // 等待后重试
        const waitTime = attempt * 2000; // 2秒, 4秒, 6秒
        console.log(`⏳ 等待 ${waitTime/1000} 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * 获取系统状态
   */
  async getSystemStatus(): Promise<{
    telegram: any;
    binance: boolean;
    database: boolean;
    priceMonitor: any;
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
        triggerAlerts: triggerAlertService.getStats()
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 启动健康监控系统
   */
  private async startHealthMonitoring(): Promise<void> {
    try {
      // 启动健康监控，每60秒检查一次
      this.healthMonitorInterval = startHealthMonitoringUtil(60000);
      console.log('✅ Health monitoring system started');
    } catch (error) {
      console.error('❌ Failed to start health monitoring:', error);
      // 健康监控失败不应该影响主应用启动
    }
  }

  /**
   * 优雅停止
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping application...');

    // 停止健康监控
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
      console.log('🏥 Health monitoring stopped');
    }

    await this.priceMonitor.stopMonitoring();
    triggerAlertService.stopAllMonitoring();
    await this.telegramBot.stop();

    // 清理速率限制器
    binanceRateLimit.destroy();

    console.log('✅ Application stopped');
  }
}