import { CryptoTgAlertApp } from './app';

/**
 * 应用程序入口点
 */
async function main(): Promise<void> {
  try {
    const app = new CryptoTgAlertApp();
    await app.start();
    
    // 处理优雅关闭
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
      await app.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// 全局错误处理
process.on('uncaughtException', (error) => {
  console.error('🚨 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// 启动应用
if (require.main === module) {
  main();
}