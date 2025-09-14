const { initDatabase, getDatabase } = require('./dist/database/connection');

async function cleanupTestData() {
  console.log('🧹 开始清理测试数据...');

  try {
    // 初始化数据库连接
    await initDatabase();
    const db = await getDatabase();

    // 删除所有TEST开头的价格历史记录
    const result1 = await db.run("DELETE FROM price_history WHERE symbol LIKE 'TEST%USDT'");
    console.log(`✅ 删除了 ${result1.changes} 条价格历史测试记录`);

    // 删除所有TEST开头的突破缓存记录
    const result2 = await db.run("DELETE FROM breakthrough_cache WHERE symbol LIKE 'TEST%USDT'");
    console.log(`✅ 删除了 ${result2.changes} 条突破缓存测试记录`);

    // 删除测试用户的推送配置
    const result3 = await db.run("DELETE FROM user_push_config WHERE user_id = 'test_user_12345'");
    console.log(`✅ 删除了 ${result3.changes} 条测试用户推送配置`);

    console.log('🎉 测试数据清理完成！');
    process.exit(0);

  } catch (error) {
    console.error('❌ 清理失败:', error);
    process.exit(1);
  }
}

cleanupTestData();