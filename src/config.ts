import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

export interface Config {
  telegram: {
    botToken: string;
    userId: string;
  };
  binance: {
    apiKey: string;
    apiSecret: string;
  };
  app: {
    nodeEnv: string;
    logLevel: string;
    databasePath: string;
    port: number;
    alertMode: 'crypto' | 'tradfi';
  };
}

// 验证必需的环境变量
function validateRequired(key: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

// 构建配置对象
export const config: Config = {
  telegram: {
    botToken: validateRequired('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN),
    userId: validateRequired('TELEGRAM_USER_ID', process.env.TELEGRAM_USER_ID),
  },
  binance: {
    apiKey: validateRequired('BINANCE_API_KEY', process.env.BINANCE_API_KEY),
    apiSecret: validateRequired('BINANCE_API_SECRET', process.env.BINANCE_API_SECRET),
  },
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    databasePath: process.env.DATABASE_PATH || './data/crypto-tgalert.db',
    port: parseInt(process.env.PORT || '3000', 10),
    // 标的模式:tradfi=币安TradFi永续(美股/商品/指数等),crypto=加密永续。默认 tradfi,非法值回落 tradfi。
    alertMode: process.env.ALERT_MODE === 'crypto' ? 'crypto' : 'tradfi',
  },
};


console.log('✅ Configuration loaded successfully');
console.log(`🤖 Bot for user: ${config.telegram.userId}`);
console.log(`📊 Environment: ${config.app.nodeEnv}`);
console.log(`📝 Log level: ${config.app.logLevel}`);
console.log(`📐 Alert mode: ${config.app.alertMode}`);