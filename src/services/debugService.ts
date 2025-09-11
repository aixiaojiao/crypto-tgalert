import * as fs from 'fs/promises';
import * as path from 'path';
import { log } from '../utils/logger';

export interface DebugRecord {
  id: string;
  timestamp: string;
  userId: string;
  previousMessage: {
    type: 'bot_response' | 'user_message';
    content: string;
    messageId?: number;
  };
  debugContent: string;
  status: 'pending' | 'reviewed' | 'fixed';
}

export class DebugService {
  private debugFile: string;
  private debugDir: string;

  constructor() {
    this.debugDir = path.join(process.cwd(), 'logs');
    this.debugFile = path.join(this.debugDir, 'debug-records.md');
  }

  /**
   * Initialize debug service and ensure directory exists
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.debugDir, { recursive: true });
      
      // Check if debug file exists, if not create with header
      try {
        await fs.access(this.debugFile);
      } catch {
        await this.createDebugFile();
      }
      
      log.info('DebugService initialized');
    } catch (error) {
      log.error('Failed to initialize DebugService:', error);
      throw error;
    }
  }

  /**
   * Create debug file with header
   */
  private async createDebugFile(): Promise<void> {
    const header = `# Debug 记录日志

自动生成的debug记录，用于收集bot使用过程中发现的问题和优化建议。

---

`;
    await fs.writeFile(this.debugFile, header, 'utf8');
  }

  /**
   * Save a debug record to file
   */
  async saveDebugRecord(record: Omit<DebugRecord, 'id' | 'status'>): Promise<string> {
    try {
      const debugId = this.generateDebugId();
      const fullRecord: DebugRecord = {
        ...record,
        id: debugId,
        status: 'pending'
      };

      const content = this.formatRecord(fullRecord);
      await fs.appendFile(this.debugFile, content, 'utf8');
      
      log.info(`Debug record saved: ${debugId}`);
      return debugId;
    } catch (error) {
      log.error('Failed to save debug record:', error);
      throw error;
    }
  }

  /**
   * Format debug record as markdown
   */
  private formatRecord(record: DebugRecord): string {
    const date = new Date(record.timestamp).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai'
    });
    
    return `## [${record.status.toUpperCase()}] ${date} - ${record.id}

**用户ID**: ${record.userId}
**上一条消息类型**: ${record.previousMessage.type === 'bot_response' ? '机器人回复' : '用户消息'}
**上一条消息内容**: 
\`\`\`
${record.previousMessage.content}
\`\`\`

**Debug内容**: ${record.debugContent}

---

`;
  }

  /**
   * Generate unique debug ID
   */
  private generateDebugId(): string {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const random = Math.random().toString(36).substr(2, 4);
    return `debug-${date}-${time}-${random}`;
  }

  /**
   * Get all pending debug records (for analysis)
   */
  async getPendingRecords(): Promise<DebugRecord[]> {
    try {
      const content = await fs.readFile(this.debugFile, 'utf8');
      return this.parseDebugRecords(content);
    } catch (error) {
      log.error('Failed to read debug records:', error);
      return [];
    }
  }

  /**
   * Parse debug records from markdown content
   */
  private parseDebugRecords(content: string): DebugRecord[] {
    const records: DebugRecord[] = [];
    const sections = content.split('## [').slice(1); // Remove header

    for (const section of sections) {
      try {
        const record = this.parseSection(section);
        if (record) {
          records.push(record);
        }
      } catch (error) {
        log.warn('Failed to parse debug record section:', error);
      }
    }

    return records;
  }

  /**
   * Parse individual debug record section
   */
  private parseSection(section: string): DebugRecord | null {
    const lines = section.split('\n');
    if (lines.length < 5) return null;

    // Parse header line: "PENDING] 2025-09-11 12:30:00 - debug-id"
    const headerMatch = lines[0].match(/^(\w+)\]\s+(.+?)\s+-\s+(.+)$/);
    if (!headerMatch) return null;

    const [, status, timestamp, id] = headerMatch;
    
    // Extract other fields
    const userIdLine = lines.find(line => line.startsWith('**用户ID**:'));
    const userId = userIdLine?.split(': ')[1] || '';

    const messageTypeLine = lines.find(line => line.startsWith('**上一条消息类型**:'));
    const messageType = messageTypeLine?.includes('机器人回复') ? 'bot_response' : 'user_message';

    // Extract message content between ```
    const contentStart = lines.findIndex(line => line.trim() === '```');
    const contentEnd = lines.findIndex((line, idx) => idx > contentStart && line.trim() === '```');
    const messageContent = contentStart >= 0 && contentEnd >= 0 
      ? lines.slice(contentStart + 1, contentEnd).join('\n')
      : '';

    const debugContentLine = lines.find(line => line.startsWith('**Debug内容**:'));
    const debugContent = debugContentLine?.split(': ').slice(1).join(': ') || '';

    return {
      id,
      timestamp,
      userId,
      previousMessage: {
        type: messageType as 'bot_response' | 'user_message',
        content: messageContent
      },
      debugContent,
      status: status.toLowerCase() as 'pending' | 'reviewed' | 'fixed'
    };
  }

  /**
   * Mark debug record as reviewed or fixed
   */
  async updateRecordStatus(debugId: string, status: 'reviewed' | 'fixed'): Promise<void> {
    try {
      const content = await fs.readFile(this.debugFile, 'utf8');
      const updatedContent = content.replace(
        new RegExp(`\\[\\w+\\](.+?- ${debugId})`),
        `[${status.toUpperCase()}]$1`
      );
      await fs.writeFile(this.debugFile, updatedContent, 'utf8');
      log.info(`Debug record ${debugId} status updated to ${status}`);
    } catch (error) {
      log.error(`Failed to update debug record ${debugId}:`, error);
      throw error;
    }
  }

  /**
   * Get debug file path for external tools
   */
  getDebugFilePath(): string {
    return this.debugFile;
  }

  /**
   * Get statistics about debug records
   */
  async getStats(): Promise<{ total: number; pending: number; reviewed: number; fixed: number }> {
    const records = await this.getPendingRecords();
    return {
      total: records.length,
      pending: records.filter(r => r.status === 'pending').length,
      reviewed: records.filter(r => r.status === 'reviewed').length,
      fixed: records.filter(r => r.status === 'fixed').length
    };
  }
}