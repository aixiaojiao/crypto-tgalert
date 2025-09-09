const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

async function queryDatabase() {
  const db = await open({
    filename: './data/crypto-tgalert.db',
    driver: sqlite3.Database
  });

  console.log('=== 触发提醒设置 ===');
  const settings = await db.all('SELECT * FROM trigger_alert_settings');
  console.log(settings);

  console.log('\n=== 涨幅榜历史数据 (最近10条) ===');
  const gainers = await db.all('SELECT * FROM gainers_rankings ORDER BY timestamp DESC LIMIT 10');
  console.log(gainers);

  console.log('\n=== 负费率榜历史数据 (最近10条) ===');
  const funding = await db.all('SELECT * FROM funding_rankings ORDER BY timestamp DESC LIMIT 10');
  console.log(funding);

  console.log('\n=== 表统计 ===');
  const stats = await db.all(`
    SELECT 
      'gainers_rankings' as table_name, 
      COUNT(*) as count,
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest
    FROM gainers_rankings
    UNION ALL
    SELECT 
      'funding_rankings' as table_name, 
      COUNT(*) as count,
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest  
    FROM funding_rankings
  `);
  console.log(stats);

  await db.close();
}

queryDatabase().catch(console.error);