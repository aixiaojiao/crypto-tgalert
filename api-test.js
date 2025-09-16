#!/usr/bin/env node
/**
 * 直接测试币安API并收集样本数据进行验证
 */

const { binanceClient } = require('./dist/services/binance');

// 测试代币列表
const testSymbols = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT',
  'ADAUSDT', 'SOLUSDT', 'DOTUSDT', 'AVAXUSDT', 'MATICUSDT'
];

async function validateAPIData() {
  console.log('🔍 开始API数据验证测试...\n');

  for (const symbol of testSymbols) {
    try {
      // 1. 获取当前价格
      const currentPrice = await binanceClient.getFuturesPrice(symbol);

      // 2. 获取历史K线数据(最近1年，找最高价)
      const endTime = Date.now();
      const startTime = endTime - (365 * 24 * 60 * 60 * 1000);

      const klines = await binanceClient.getFuturesKlines({
        symbol: symbol,
        interval: '1d',
        startTime: startTime,
        endTime: endTime,
        limit: 1000
      });

      // 3. 计算历史最高价
      let highPrice = currentPrice;
      let highTimestamp = endTime;

      for (const kline of klines) {
        const klineHigh = parseFloat(kline.high);
        if (klineHigh > highPrice) {
          highPrice = klineHigh;
          highTimestamp = kline.closeTime;
        }
      }

      // 4. 转换时间戳
      const highDate = new Date(highTimestamp).toISOString().split('T')[0];
      const distancePercent = ((currentPrice - highPrice) / highPrice * 100).toFixed(2);

      console.log(`${symbol}:`);
      console.log(`  当前价格: $${currentPrice}`);
      console.log(`  历史最高: $${highPrice}`);
      console.log(`  ATH时间: ${highDate}`);
      console.log(`  距高点: ${distancePercent}%`);
      console.log('');

      // 验证延迟
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`❌ ${symbol} 测试失败:`, error.message);
    }
  }

  console.log('✅ API验证测试完成');
}

validateAPIData();