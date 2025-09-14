const { initDatabase, getDatabase } = require('./dist/database/connection');

async function cleanupFakeData() {
  console.log('🧹 开始清理假的测试数据...');

  try {
    await initDatabase();
    const db = await getDatabase();

    // 清理价格为测试值的BTC/ETH/SOL假记录
    const result1 = await db.run(`
      DELETE FROM price_history
      WHERE symbol IN ('BTCUSDT', 'ETHUSDT', 'SOLUSDT')
      AND price IN (65000, 3500, 180)
      AND volume_24h IN (2500000000, 1800000000, 500000000)
    `);
    console.log(`✅ 删除了 ${result1.changes} 条假BTC/ETH/SOL记录`);

    // 删除所有price_change为0的异常记录
    const result2 = await db.run(`
      DELETE FROM price_history
      WHERE price_change_1h = 0
      AND price_change_24h = 0
      AND created_at > datetime('now', '-1 hour')
    `);
    console.log(`✅ 删除了 ${result2.changes} 条异常零涨幅记录`);

    console.log('🎉 假数据清理完成！');
    process.exit(0);

  } catch (error) {
    console.error('❌ 清理失败:', error);
    process.exit(1);
  }
}

cleanupFakeData();