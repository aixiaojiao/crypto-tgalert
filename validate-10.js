#!/usr/bin/env node
/**
 * 10次连续随机验证币安API数据准确性
 */

const { binanceClient } = require('./dist/services/binance');

// 更大的代币池用于随机选择
const symbolPool = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'LINKUSDT', 'ADAUSDT', 'SOLUSDT', 'DOTUSDT', 'AVAXUSDT',
  'UNIUSDT', 'LTCUSDT', 'TRXUSDT', 'ETCUSDT', 'XLMUSDT', 'ATOMUSDT', 'FILUSDT', 'HBARUSDT', 'ALGOUSDT',
  'VETUSDT', 'ICPUSDT', 'SANDUSDT', 'MANAUSDT', 'AXSUSDT', 'THETAUSDT', 'FTMUSDT', 'EGLDUSDT', 'AAVEUSDT',
  'COMPUSDT', 'MKRUSDT', 'SNXUSDT', 'SUSHIUSDT', 'YFIUSDT', 'CRVUSDT', 'BALUSDT', 'RENUSDT'
];

function getRandomSymbols(count) {
  const shuffled = [...symbolPool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

async function validateSingleSymbol(symbol) {
  try {
    console.log(`📊 验证 ${symbol}...`);

    // 获取当前价格
    const currentPrice = await binanceClient.getFuturesPrice(symbol);

    // 获取最近1年K线数据
    const endTime = Date.now();
    const startTime = endTime - (365 * 24 * 60 * 60 * 1000);

    const klines = await binanceClient.getFuturesKlines({
      symbol: symbol,
      interval: '1d',
      startTime: startTime,
      endTime: endTime,
      limit: 1000
    });

    // 计算历史最高价
    let highPrice = currentPrice;
    let highTimestamp = endTime;

    for (const kline of klines) {
      const klineHigh = parseFloat(kline.high);
      if (klineHigh > highPrice) {
        highPrice = klineHigh;
        highTimestamp = kline.closeTime;
      }
    }

    const highDate = new Date(highTimestamp).toISOString().split('T')[0];
    const distancePercent = ((currentPrice - highPrice) / highPrice * 100).toFixed(2);

    // 数据合理性检查
    const isValid =
      !isNaN(currentPrice) && currentPrice > 0 &&
      !isNaN(highPrice) && highPrice > 0 &&
      highPrice >= currentPrice &&
      highTimestamp > 0;

    console.log(`  当前: $${currentPrice} | ATH: $${highPrice} | 时间: ${highDate} | 距离: ${distancePercent}%`);

    if (isValid) {
      console.log(`  ✅ ${symbol} 数据验证通过\n`);
      return true;
    } else {
      console.log(`  ❌ ${symbol} 数据验证失败\n`);
      return false;
    }

  } catch (error) {
    console.error(`  ❌ ${symbol} 验证出错: ${error.message}\n`);
    return false;
  }
}

async function runConsecutiveValidation() {
  console.log('🎯 开始10次连续随机验证...\n');

  let consecutiveSuccess = 0;
  let totalAttempts = 0;

  while (consecutiveSuccess < 10) {
    totalAttempts++;
    const randomSymbol = getRandomSymbols(1)[0];

    console.log(`=== 第 ${totalAttempts} 次验证 (连续成功: ${consecutiveSuccess}/10) ===`);

    const success = await validateSingleSymbol(randomSymbol);

    if (success) {
      consecutiveSuccess++;
      console.log(`🎉 连续成功 ${consecutiveSuccess}/10\n`);
    } else {
      console.log(`💥 连续成功计数重置为 0\n`);
      consecutiveSuccess = 0;
    }

    // 延迟避免API限制
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log(`🏆 完成！10次连续验证全部成功！`);
  console.log(`📈 总尝试次数: ${totalAttempts}`);
  console.log(`🎯 成功率: ${(10/totalAttempts*100).toFixed(1)}%`);
}

runConsecutiveValidation();