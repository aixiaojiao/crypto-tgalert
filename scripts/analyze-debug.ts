#!/usr/bin/env npx ts-node

import * as fs from 'fs/promises';
import * as path from 'path';
import { DebugService, DebugRecord } from '../src/services/debugService';

/**
 * Debug记录分析脚本
 * 用于分析收集的debug记录，提供改进建议
 */
class DebugAnalyzer {
  private debugService: DebugService;
  
  constructor() {
    this.debugService = new DebugService();
  }

  /**
   * 分析所有debug记录
   */
  async analyzeAll(): Promise<void> {
    try {
      console.log('🔍 开始分析Debug记录...\n');
      
      // 获取统计信息
      const stats = await this.debugService.getStats();
      this.printStats(stats);
      
      // 获取所有记录
      const records = await this.debugService.getPendingRecords();
      
      if (records.length === 0) {
        console.log('📝 暂无debug记录\n');
        return;
      }
      
      // 按状态分组
      const grouped = this.groupRecordsByStatus(records);
      
      // 分析待处理记录
      if (grouped.pending.length > 0) {
        console.log('🚨 待处理的问题:');
        this.analyzePendingRecords(grouped.pending);
      }
      
      // 分析问题模式
      console.log('\n📊 问题分析:');
      this.analyzePatterns(records);
      
      // 生成改进建议
      console.log('\n💡 改进建议:');
      this.generateRecommendations(records);
      
      // 生成修复计划
      console.log('\n📋 修复计划:');
      this.generateFixPlan(grouped.pending);
      
    } catch (error) {
      console.error('❌ 分析失败:', error);
    }
  }

  /**
   * 打印统计信息
   */
  private printStats(stats: { total: number; pending: number; reviewed: number; fixed: number }): void {
    console.log('📊 Debug记录统计:');
    console.log(`   总记录数: ${stats.total}`);
    console.log(`   待处理: ${stats.pending}`);
    console.log(`   已审查: ${stats.reviewed}`);
    console.log(`   已修复: ${stats.fixed}`);
    console.log('');
  }

  /**
   * 按状态分组记录
   */
  private groupRecordsByStatus(records: DebugRecord[]): { 
    pending: DebugRecord[]; 
    reviewed: DebugRecord[]; 
    fixed: DebugRecord[] 
  } {
    return {
      pending: records.filter(r => r.status === 'pending'),
      reviewed: records.filter(r => r.status === 'reviewed'),
      fixed: records.filter(r => r.status === 'fixed')
    };
  }

  /**
   * 分析待处理记录
   */
  private analyzePendingRecords(records: DebugRecord[]): void {
    records.forEach((record, index) => {
      console.log(`   ${index + 1}. [${record.timestamp.slice(0, 10)}] ${record.debugContent}`);
      console.log(`      ID: ${record.id}`);
      console.log(`      上下文: ${record.previousMessage.content.slice(0, 100)}...`);
      console.log('');
    });
  }

  /**
   * 分析问题模式
   */
  private analyzePatterns(records: DebugRecord[]): void {
    const keywords = this.extractKeywords(records);
    const categories = this.categorizeIssues(records);
    
    console.log('   🔤 关键词频率:');
    Object.entries(keywords)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .forEach(([keyword, count]) => {
        console.log(`      "${keyword}": ${count}次`);
      });
    
    console.log('\n   📂 问题分类:');
    Object.entries(categories).forEach(([category, count]) => {
      console.log(`      ${category}: ${count}个问题`);
    });
  }

  /**
   * 提取关键词
   */
  private extractKeywords(records: DebugRecord[]): Record<string, number> {
    const keywords: Record<string, number> = {};
    const commonWords = ['的', '是', '了', '在', '和', '有', '需要', '可以', '应该', '问题', '功能'];
    
    records.forEach(record => {
      const words = record.debugContent.split(/[\s，。！？、]+/).filter(word => 
        word.length > 1 && !commonWords.includes(word)
      );
      
      words.forEach(word => {
        keywords[word] = (keywords[word] || 0) + 1;
      });
    });
    
    return keywords;
  }

  /**
   * 问题分类
   */
  private categorizeIssues(records: DebugRecord[]): Record<string, number> {
    const categories: Record<string, number> = {
      '性能问题': 0,
      '功能缺失': 0,
      '错误/故障': 0,
      'UI/UX改进': 0,
      '新功能建议': 0,
      '其他': 0
    };
    
    records.forEach(record => {
      const content = record.debugContent.toLowerCase();
      
      if (content.includes('慢') || content.includes('超时') || content.includes('卡') || content.includes('延迟')) {
        categories['性能问题']++;
      } else if (content.includes('缺少') || content.includes('没有') || content.includes('缺失')) {
        categories['功能缺失']++;
      } else if (content.includes('错误') || content.includes('失败') || content.includes('bug') || content.includes('故障')) {
        categories['错误/故障']++;
      } else if (content.includes('界面') || content.includes('显示') || content.includes('体验')) {
        categories['UI/UX改进']++;
      } else if (content.includes('建议') || content.includes('希望') || content.includes('增加') || content.includes('添加')) {
        categories['新功能建议']++;
      } else {
        categories['其他']++;
      }
    });
    
    return categories;
  }

  /**
   * 生成改进建议
   */
  private generateRecommendations(records: DebugRecord[]): void {
    const categories = this.categorizeIssues(records);
    const total = records.length;
    
    if (categories['性能问题'] > total * 0.3) {
      console.log('   🚀 高优先级: 性能优化');
      console.log('      - 增加缓存机制');
      console.log('      - 优化API调用频率');
      console.log('      - 增加超时和重试机制');
    }
    
    if (categories['错误/故障'] > total * 0.2) {
      console.log('   🐛 高优先级: 错误处理');
      console.log('      - 增强错误日志');
      console.log('      - 添加健康检查');
      console.log('      - 实现优雅降级');
    }
    
    if (categories['功能缺失'] > 0) {
      console.log('   ✨ 中优先级: 功能完善');
      console.log('      - 分析用户需求');
      console.log('      - 设计功能原型');
      console.log('      - 渐进式实现');
    }
    
    if (categories['新功能建议'] > 0) {
      console.log('   💡 低优先级: 新功能开发');
      console.log('      - 收集更多反馈');
      console.log('      - 评估实现成本');
      console.log('      - 制定开发计划');
    }
  }

  /**
   * 生成修复计划
   */
  private generateFixPlan(pendingRecords: DebugRecord[]): void {
    if (pendingRecords.length === 0) {
      console.log('   ✅ 暂无待处理问题');
      return;
    }
    
    // 按优先级排序
    const prioritized = this.prioritizeRecords(pendingRecords);
    
    console.log('   📅 建议的修复顺序:');
    prioritized.forEach((record, index) => {
      const priority = index < 3 ? '🔴 高' : index < 6 ? '🟡 中' : '🟢 低';
      console.log(`   ${index + 1}. ${priority} - ${record.debugContent.slice(0, 50)}...`);
      console.log(`      记录ID: ${record.id}`);
      console.log(`      建议动作: ${this.suggestAction(record)}`);
      console.log('');
    });
  }

  /**
   * 对记录进行优先级排序
   */
  private prioritizeRecords(records: DebugRecord[]): DebugRecord[] {
    return records.sort((a, b) => {
      const aPriority = this.calculatePriority(a);
      const bPriority = this.calculatePriority(b);
      return bPriority - aPriority;
    });
  }

  /**
   * 计算优先级分数
   */
  private calculatePriority(record: DebugRecord): number {
    let score = 0;
    const content = record.debugContent.toLowerCase();
    
    // 错误类问题高优先级
    if (content.includes('错误') || content.includes('失败') || content.includes('bug')) score += 10;
    
    // 性能问题高优先级
    if (content.includes('慢') || content.includes('超时') || content.includes('卡')) score += 8;
    
    // 功能缺失中优先级
    if (content.includes('缺少') || content.includes('没有')) score += 5;
    
    // 建议类低优先级
    if (content.includes('建议') || content.includes('希望')) score += 2;
    
    // 新记录优先级稍高
    const daysSinceCreated = (Date.now() - new Date(record.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 7) score += 3;
    
    return score;
  }

  /**
   * 建议处理动作
   */
  private suggestAction(record: DebugRecord): string {
    const content = record.debugContent.toLowerCase();
    
    if (content.includes('错误') || content.includes('失败')) {
      return '代码审查 → 修复 → 测试';
    } else if (content.includes('慢') || content.includes('超时')) {
      return '性能分析 → 优化 → 基准测试';
    } else if (content.includes('缺少') || content.includes('没有')) {
      return '需求分析 → 设计 → 开发';
    } else if (content.includes('建议') || content.includes('希望')) {
      return '可行性评估 → 原型设计 → 迭代开发';
    } else {
      return '详细分析 → 制定方案 → 实施';
    }
  }

  /**
   * 导出分析报告
   */
  async exportReport(): Promise<void> {
    const records = await this.debugService.getPendingRecords();
    const stats = await this.debugService.getStats();
    
    const report = {
      timestamp: new Date().toISOString(),
      stats,
      records,
      analysis: {
        keywords: this.extractKeywords(records),
        categories: this.categorizeIssues(records),
        prioritized: this.prioritizeRecords(records.filter(r => r.status === 'pending'))
      }
    };
    
    const reportPath = path.join(process.cwd(), 'logs', 'debug-analysis-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    
    console.log(`\n📋 分析报告已导出到: ${reportPath}`);
  }
}

// 主函数
async function main(): Promise<void> {
  const analyzer = new DebugAnalyzer();
  
  try {
    await analyzer.analyzeAll();
    await analyzer.exportReport();
    
    console.log('\n✅ Debug分析完成!');
    console.log('\n💡 使用方法:');
    console.log('   1. 在bot中使用 /debug 记录问题');
    console.log('   2. 运行此脚本分析记录');
    console.log('   3. 根据建议优化系统');
    console.log('   4. 使用 debugService.updateRecordStatus() 标记为已修复');
    
  } catch (error) {
    console.error('❌ 分析失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

export { DebugAnalyzer };