const { initDatabase, getDatabase } = require('./dist/database/connection');

async function cleanupTriggerConfigs() {
  console.log('🧹 清理触发推送配置...');

  try {
    await initDatabase();
    const db = await getDatabase();

    // 删除所有trigger类型的测试配置，特别是有minPriceChange=20的配置
    const result = await db.run(`
      DELETE FROM user_push_config
      WHERE config_type = 'trigger'
      OR user_id = 'test_user_12345'
    `);
    console.log(`✅ 删除了 ${result.changes} 个触发推送配置`);

    console.log('🎉 触发配置清理完成！');
    process.exit(0);

  } catch (error) {
    console.error('❌ 清理失败:', error);
    process.exit(1);
  }
}

cleanupTriggerConfigs();