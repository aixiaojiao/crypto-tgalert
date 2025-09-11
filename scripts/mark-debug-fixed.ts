#!/usr/bin/env npx ts-node

import { DebugService } from '../src/services/debugService';

/**
 * 标记debug记录为已修复状态的脚本
 * 使用方法: npx ts-node scripts/mark-debug-fixed.ts <debug-id-1> <debug-id-2> ...
 */
class DebugStatusUpdater {
  private debugService: DebugService;
  
  constructor() {
    this.debugService = new DebugService();
  }

  /**
   * 标记指定的debug记录为已修复
   */
  async markAsFixed(debugIds: string[]): Promise<void> {
    try {
      await this.debugService.initialize();
      
      console.log(`📝 开始标记 ${debugIds.length} 个debug记录为已修复...\n`);
      
      for (const debugId of debugIds) {
        try {
          await this.debugService.updateRecordStatus(debugId, 'fixed');
          console.log(`✅ ${debugId} - 已标记为已修复`);
        } catch (error) {
          console.error(`❌ ${debugId} - 标记失败:`, error);
        }
      }
      
      console.log(`\n🎉 处理完成！`);
      
      // 显示更新后的统计
      const stats = await this.debugService.getStats();
      console.log('\n📊 更新后的统计:');
      console.log(`   总记录数: ${stats.total}`);
      console.log(`   待处理: ${stats.pending}`);
      console.log(`   已审查: ${stats.reviewed}`);
      console.log(`   已修复: ${stats.fixed}`);
      
    } catch (error) {
      console.error('❌ 标记过程失败:', error);
      throw error;
    }
  }

  /**
   * 显示所有待处理的debug记录
   */
  async listPending(): Promise<void> {
    try {
      await this.debugService.initialize();
      const records = await this.debugService.getPendingRecords();
      const pending = records.filter(r => r.status === 'pending');
      
      if (pending.length === 0) {
        console.log('✅ 暂无待处理的debug记录');
        return;
      }
      
      console.log(`📋 待处理的debug记录 (${pending.length}个):\n`);
      
      pending.forEach((record, index) => {
        console.log(`${index + 1}. ID: ${record.id}`);
        console.log(`   时间: ${record.timestamp}`);
        console.log(`   内容: ${record.debugContent}`);
        console.log(`   状态: ${record.status.toUpperCase()}\n`);
      });
      
    } catch (error) {
      console.error('❌ 获取待处理记录失败:', error);
      throw error;
    }
  }

  /**
   * 批量标记包含指定关键词的记录为已修复
   */
  async markByKeyword(keyword: string, status: 'reviewed' | 'fixed' = 'fixed'): Promise<void> {
    try {
      await this.debugService.initialize();
      const records = await this.debugService.getPendingRecords();
      
      const matchingRecords = records.filter(r => 
        r.status === 'pending' && 
        r.debugContent.toLowerCase().includes(keyword.toLowerCase())
      );
      
      if (matchingRecords.length === 0) {
        console.log(`❌ 未找到包含关键词 "${keyword}" 的待处理记录`);
        return;
      }
      
      console.log(`🔍 找到 ${matchingRecords.length} 个包含关键词 "${keyword}" 的记录:\n`);
      
      for (const record of matchingRecords) {
        console.log(`   - ${record.id}: ${record.debugContent}`);
      }
      
      console.log(`\n📝 开始标记为 ${status.toUpperCase()}...\n`);
      
      for (const record of matchingRecords) {
        try {
          await this.debugService.updateRecordStatus(record.id, status);
          console.log(`✅ ${record.id} - 已标记为 ${status}`);
        } catch (error) {
          console.error(`❌ ${record.id} - 标记失败:`, error);
        }
      }
      
      console.log(`\n🎉 处理完成！`);
      
    } catch (error) {
      console.error('❌ 按关键词标记失败:', error);
      throw error;
    }
  }
}

// 主函数
async function main(): Promise<void> {
  const updater = new DebugStatusUpdater();
  const args = process.argv.slice(2);
  
  try {
    if (args.length === 0) {
      console.log('🔧 Debug记录状态管理工具\n');
      console.log('使用方法:');
      console.log('  1. 查看待处理记录:');
      console.log('     npm run debug-status list');
      console.log('');
      console.log('  2. 标记指定ID为已修复:');
      console.log('     npm run debug-status fixed <debug-id-1> <debug-id-2>');
      console.log('');
      console.log('  3. 按关键词批量标记:');
      console.log('     npm run debug-status keyword <关键词>');
      console.log('');
      console.log('示例:');
      console.log('  npm run debug-status list');
      console.log('  npm run debug-status fixed debug-20250911-160112-u3tr');
      console.log('  npm run debug-status keyword "黄名单"');
      return;
    }
    
    const command = args[0];
    
    switch (command) {
      case 'list':
        await updater.listPending();
        break;
        
      case 'fixed':
        const debugIds = args.slice(1);
        if (debugIds.length === 0) {
          console.error('❌ 请提供要标记的debug记录ID');
          process.exit(1);
        }
        await updater.markAsFixed(debugIds);
        break;
        
      case 'keyword':
        const keyword = args[1];
        if (!keyword) {
          console.error('❌ 请提供搜索关键词');
          process.exit(1);
        }
        await updater.markByKeyword(keyword);
        break;
        
      default:
        console.error(`❌ 未知命令: ${command}`);
        console.log('使用 npm run debug-status 查看帮助');
        process.exit(1);
    }
    
  } catch (error) {
    console.error('❌ 执行失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { DebugStatusUpdater };