/**
 * Esp32NotificationService —— 将 crypto 告警推送到 ouyu-v2 绑定设备播报 TTS。
 *
 * 设计要点：
 * - 可订阅 5 种告警源：potential, breakthrough, ranking, price, pump_dump
 * - 全局冷却（默认 60 秒），仅为避免两条播报首尾相接互相打断
 *   （Telegram 端已做业务冷却，我们不再重复）
 * - 可选静音时段（HH:MM-HH:MM，跨午夜有效）
 * - 推送失败（含设备离线 404）吞掉，不影响 Telegram 主通道
 * - 配置持久化到 SQLite `esp32_config` 表（按 user_id 单行）
 */
import { Database } from 'sqlite';
import { getDatabase } from '../../database/connection';
import { log } from '../../utils/logger';
import { OuyuPushClient, OuyuPushResult } from './OuyuPushClient';

export type Esp32AlertType =
  | 'potential'
  | 'breakthrough'
  | 'ranking'
  | 'price'
  | 'pump_dump'
  | 'funding';

export const ESP32_ALERT_TYPES: Esp32AlertType[] = [
  'potential',
  'breakthrough',
  'ranking',
  'price',
  'pump_dump',
  'funding',
];

export interface Esp32ConfigSnapshot {
  userId: string;
  enabled: boolean;
  enabledTypes: Esp32AlertType[];
  cooldownSeconds: number;
  quietStart: string | null;
  quietEnd: string | null;
  deviceId: string;
  gatewayUrl: string;
}

const DEFAULT_COOLDOWN_SECONDS = 60;
const MAX_QUEUE_SIZE = 20;

export class Esp32NotificationService {
  private readonly client: OuyuPushClient;
  private readonly userId: string;
  // 内存态全局最近一次推送时间戳（防并发打断），每进程独立
  private lastPushAtMs = 0;
  // 冷却期内待播队列：按入队顺序依次播报，避免直接丢弃重要信息
  private readonly queue: string[] = [];
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(client: OuyuPushClient, userId: string) {
    this.client = client;
    this.userId = userId;
  }

  /**
   * 启动时初始化一行配置（如不存在）。幂等。
   */
  async ensureRow(): Promise<void> {
    const db = await getDatabase();
    const now = Date.now();
    await db.run(
      `INSERT OR IGNORE INTO esp32_config
        (user_id, enabled, enabled_types, cooldown_seconds, quiet_start, quiet_end, updated_at)
       VALUES (?, 0, '[]', ?, NULL, NULL, ?)`,
      this.userId,
      DEFAULT_COOLDOWN_SECONDS,
      now
    );
  }

  async getConfig(): Promise<Esp32ConfigSnapshot> {
    const db = await getDatabase();
    const row = await db.get<any>(
      'SELECT * FROM esp32_config WHERE user_id = ?',
      this.userId
    );
    if (!row) {
      return {
        userId: this.userId,
        enabled: false,
        enabledTypes: [],
        cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
        quietStart: null,
        quietEnd: null,
        deviceId: this.client.getDeviceId(),
        gatewayUrl: this.client.getGatewayUrl(),
      };
    }
    return {
      userId: this.userId,
      enabled: row.enabled === 1,
      enabledTypes: parseTypes(row.enabled_types),
      cooldownSeconds: row.cooldown_seconds,
      quietStart: row.quiet_start,
      quietEnd: row.quiet_end,
      deviceId: this.client.getDeviceId(),
      gatewayUrl: this.client.getGatewayUrl(),
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.writeField('enabled', enabled ? 1 : 0);
  }

  /**
   * 启用指定类型（累加，不覆盖）。支持 "all"。
   */
  async enableTypes(types: string[]): Promise<Esp32AlertType[]> {
    const cfg = await this.getConfig();
    const normalized = normalizeTypes(types);
    const next: Esp32AlertType[] = normalized.all
      ? [...ESP32_ALERT_TYPES]
      : Array.from(new Set<Esp32AlertType>([...cfg.enabledTypes, ...normalized.types]));
    await this.writeField('enabled_types', JSON.stringify(next));
    return next;
  }

  /**
   * 关闭指定类型（从已启用列表移除）。支持 "all"。
   */
  async disableTypes(types: string[]): Promise<Esp32AlertType[]> {
    const cfg = await this.getConfig();
    const normalized = normalizeTypes(types);
    const next: Esp32AlertType[] = normalized.all
      ? []
      : cfg.enabledTypes.filter((t) => !normalized.types.includes(t));
    await this.writeField('enabled_types', JSON.stringify(next));
    return next;
  }

  async setCooldownSeconds(seconds: number): Promise<void> {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
      throw new Error('cooldown must be 0~3600 seconds');
    }
    await this.writeField('cooldown_seconds', Math.floor(seconds));
  }

  /**
   * 设置静音时段。传空字符串或 null 则清除。格式 "HH:MM-HH:MM"。
   */
  async setQuietHours(range: string | null): Promise<{ start: string | null; end: string | null }> {
    if (!range || range.trim() === '' || range.trim().toLowerCase() === 'off') {
      const db = await getDatabase();
      await db.run(
        'UPDATE esp32_config SET quiet_start = NULL, quiet_end = NULL, updated_at = ? WHERE user_id = ?',
        Date.now(),
        this.userId
      );
      return { start: null, end: null };
    }
    const m = range.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error('invalid format, expect HH:MM-HH:MM');
    const start = `${pad2(+m[1])}:${m[2]}`;
    const end = `${pad2(+m[3])}:${m[4]}`;
    if (!isValidHm(start) || !isValidHm(end)) throw new Error('invalid hour/minute value');
    const db = await getDatabase();
    await db.run(
      'UPDATE esp32_config SET quiet_start = ?, quiet_end = ?, updated_at = ? WHERE user_id = ?',
      start,
      end,
      Date.now(),
      this.userId
    );
    return { start, end };
  }

  /**
   * 核心：告警 hook 调用入口。应用"总开关 → 类型过滤 → 静音时段 → 清洗文本 → (立即推 | 入队)"。
   * 失败吞掉，永不抛。
   *
   * 冷却处理：不再直接丢弃。冷却期内消息入队，由定时器按 cooldown 间隔依次播报。
   * 队列上限 MAX_QUEUE_SIZE，溢出时丢弃最旧项（保留最新市场状态）。
   */
  async pushAlert(alertType: Esp32AlertType, text: string): Promise<OuyuPushResult> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.enabled) return skip('master switch off');
      if (!cfg.enabledTypes.includes(alertType)) return skip(`type ${alertType} not enabled`);
      if (isInQuietHours(cfg.quietStart, cfg.quietEnd, new Date())) return skip('quiet hours');

      const cleaned = cleanForTts(text);
      if (!cleaned) return skip('empty after clean');

      const cooldownMs = cfg.cooldownSeconds * 1000;
      const now = Date.now();
      const canSendNow =
        this.queue.length === 0 &&
        this.pendingTimer === null &&
        now - this.lastPushAtMs >= cooldownMs;

      if (canSendNow) {
        // 关键：冷却在**入口**就占住，而不是等 push 成功后才占。
        // 否则 3 条告警并发时都能绕过冷却（都在 await client.push 时各自的
        // lastPushAtMs 仍是旧值），导致设备端三段 TTS 叠播。
        this.lastPushAtMs = now;
        return await this.client.push(cleaned);
      }

      // 冷却期内：入队等待播报
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        const dropped = this.queue.shift();
        log.warn('Esp32 queue overflow, dropped oldest', {
          dropped,
          queueSize: this.queue.length,
        });
      }
      this.queue.push(cleaned);
      this.scheduleDrain(cooldownMs);
      return { success: true, error: `queued (pos=${this.queue.length})` };
    } catch (err: any) {
      // 任何意外异常都吞掉
      log.error('Esp32NotificationService.pushAlert unexpected error', {
        alertType,
        error: err?.message || String(err),
      });
      return { success: false, error: err?.message || String(err) };
    }
  }

  /**
   * 调度下一次队列播报。单例 timer，避免重复调度。
   */
  private scheduleDrain(cooldownMs: number): void {
    if (this.pendingTimer || this.queue.length === 0) return;
    const delay = Math.max(0, this.lastPushAtMs + cooldownMs - Date.now());
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.drainOne(cooldownMs).catch((err) => {
        log.error('Esp32 queue drain error', { error: err?.message || String(err) });
      });
    }, delay);
  }

  /**
   * 从队列取一条播报，播完继续调度下一条。
   * 播报前重新读配置：若总开关已关闭则清空队列彻底静默。
   */
  private async drainOne(cooldownMs: number): Promise<void> {
    const text = this.queue.shift();
    if (!text) return;

    const cfg = await this.getConfig();
    if (!cfg.enabled) {
      const flushed = this.queue.length + 1;
      this.queue.length = 0;
      log.debug('Esp32 queue flushed (master switch off)', { flushed });
      return;
    }

    this.lastPushAtMs = Date.now();
    try {
      await this.client.push(text);
    } catch (err: any) {
      log.error('Esp32 queued push failed', { error: err?.message || String(err) });
    }

    if (this.queue.length > 0) {
      this.scheduleDrain(cooldownMs);
    }
  }

  /**
   * 手动测试：忽略所有过滤直接发一句。
   */
  async test(text: string): Promise<OuyuPushResult> {
    const cleaned = cleanForTts(text) || 'ESP32 测试推送';
    return this.client.push(cleaned);
  }

  private async writeField(field: keyof Database extends never ? string : string, value: unknown): Promise<void> {
    const db = await getDatabase();
    await db.run(
      `UPDATE esp32_config SET ${field} = ?, updated_at = ? WHERE user_id = ?`,
      value,
      Date.now(),
      this.userId
    );
  }
}

// ---------- helpers ----------

function skip(reason: string): OuyuPushResult {
  log.debug('Esp32 push skipped', { reason });
  return { success: false, error: `skipped: ${reason}` };
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function isValidHm(hm: string): boolean {
  const [h, m] = hm.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/**
 * 判断 now 是否在 [start, end) 内，end 允许跨午夜（例如 23:00-08:00）。
 * start/end 任一为空则视为未设置。
 */
export function isInQuietHours(start: string | null, end: string | null, now: Date): boolean {
  if (!start || !end) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = hmToMin(start);
  const e = hmToMin(end);
  if (s === e) return false;
  if (s < e) return cur >= s && cur < e;
  // 跨午夜
  return cur >= s || cur < e;
}

function hmToMin(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function parseTypes(raw: unknown): Esp32AlertType[] {
  if (typeof raw !== 'string') return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((t): t is Esp32AlertType => ESP32_ALERT_TYPES.includes(t as any));
  } catch {
    return [];
  }
}

function normalizeTypes(types: string[]): { all: boolean; types: Esp32AlertType[] } {
  const lower = types.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (lower.some((t) => t === 'all')) return { all: true, types: [] };
  return {
    all: false,
    types: lower.filter((t): t is Esp32AlertType => ESP32_ALERT_TYPES.includes(t as any)),
  };
}

/**
 * 清洗消息：去 Markdown/emoji/链接/多余空白，保留可朗读的中文与数字。
 */
export function cleanForTts(input: string): string {
  if (!input) return '';
  let s = input;
  // 去 Markdown 加粗/斜体/代码
  s = s.replace(/\*+/g, '').replace(/_{1,2}/g, '').replace(/`+/g, '');
  // 去链接 [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // 去 emoji（基本涵盖主要面板，可能不完全）
  s = s.replace(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}]/gu,
    ''
  );
  // 合并空白
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
