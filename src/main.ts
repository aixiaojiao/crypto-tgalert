import { ApplicationBootstrap } from './core/ApplicationBootstrap';
import { log } from './utils/logger';
import { config } from './config';

/**
 * 应用主入口点
 * 使用依赖注入和生命周期管理的新架构
 */
async function main(): Promise<void> {
  try {
    log.info('🚀 Starting Crypto TG Alert Application', {
      version: '2.1.6',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version
    });

    // 验证配置
    if (!config.telegram.botToken) {
      throw new Error('TELEGRAM_BOT_TOKEN is required');
    }

    if (!config.binance.apiKey || !config.binance.apiSecret) {
      throw new Error('Binance API credentials are required');
    }

    // 根据环境选择启动器
    let bootstrap: ApplicationBootstrap;

    switch (process.env.NODE_ENV) {
      case 'production':
        bootstrap = ApplicationBootstrap.createProduction();
        break;
      case 'test':
        bootstrap = ApplicationBootstrap.createTest();
        break;
      default:
        bootstrap = ApplicationBootstrap.createDevelopment();
        break;
    }

    // 启动应用
    const application = await bootstrap.bootstrap();

    // 应用启动成功
    log.info('✅ Application started successfully', {
      status: application.getStatus(),
      pid: process.pid
    });

    // 健康检查端点（如果需要的话）
    if (process.env.ENABLE_HEALTH_CHECK === 'true') {
      // 可以在这里启动一个简单的HTTP服务器提供健康检查
      startHealthCheckServer(application);
    }

  } catch (error) {
    log.error('💥 Failed to start application', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    // 退出进程
    process.exit(1);
  }
}

/**
 * 启动健康检查服务器
 */
function startHealthCheckServer(application: any): void {
  const http = require('http');
  const port = process.env.HEALTH_CHECK_PORT || 3000;

  const server = http.createServer(async (req: any, res: any) => {
    if (req.url === '/health') {
      try {
        const health = await application.healthCheck();
        res.writeHead(health.status === 'healthy' ? 200 : 503, {
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify(health));
      } catch (error) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'unhealthy',
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    } else if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(application.getStatus()));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    log.info(`🏥 Health check server started on port ${port}`);
  });

  // 优雅关闭时关闭健康检查服务器
  application.onShutdown(async () => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        log.info('🏥 Health check server stopped');
        resolve();
      });
    });
  });
}

// 启动应用
if (require.main === module) {
  main().catch((error) => {
    console.error('💥 Unhandled error in main:', error);
    process.exit(1);
  });
}