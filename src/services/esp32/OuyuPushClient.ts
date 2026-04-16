/**
 * OuyuPushClient —— 调用 ouyu-v2 device-gateway 的语音推送 HTTP 接口。
 *
 * 接口契约（ouyu-v2 apps/device-gateway/core/api/push_handler.py）：
 *   POST {gatewayUrl}/v1/devices/{deviceId}/push
 *     Content-Type: application/json
 *     Body: {"text": "<中文文本>"}
 *     Response 200: {"status": "ok"}
 *     Response 404: 设备离线
 *
 * 策略：never throw。失败仅返回 {success:false, error}，由上层决定忽略或记录。
 */
import { log } from '../../utils/logger';

export interface OuyuPushResult {
  success: boolean;
  status?: number;
  error?: string;
}

export interface OuyuPushClientOptions {
  gatewayUrl: string;      // e.g. http://47.111.161.136:18003
  deviceId: string;        // MAC 地址，如 94:a9:90:29:00:44
  timeoutMs?: number;      // 默认 5000
}

export class OuyuPushClient {
  private readonly gatewayUrl: string;
  private readonly deviceId: string;
  private readonly timeoutMs: number;

  constructor(options: OuyuPushClientOptions) {
    this.gatewayUrl = options.gatewayUrl.replace(/\/$/, '');
    this.deviceId = options.deviceId;
    // 15s：TTS 合成 + 网络往返，实测 Singapore→杭州 push 约 5s，留足余量
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  getGatewayUrl(): string {
    return this.gatewayUrl;
  }

  /**
   * 向绑定设备发送 TTS 文本。失败不抛异常。
   */
  async push(text: string): Promise<OuyuPushResult> {
    if (!text || !text.trim()) {
      return { success: false, error: 'empty text' };
    }
    if (!this.deviceId) {
      return { success: false, error: 'device_id not configured' };
    }

    const url = `${this.gatewayUrl}/v1/devices/${encodeURIComponent(this.deviceId)}/push`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (res.status >= 200 && res.status < 300) {
        log.debug('OuyuPush OK', { url, status: res.status });
        return { success: true, status: res.status };
      }

      // 404 = 设备离线，不是程序错误
      const body = await safeReadText(res);
      log.warn('OuyuPush non-2xx', { url, status: res.status, body });
      return { success: false, status: res.status, error: `HTTP ${res.status}: ${body}` };
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? `timeout after ${this.timeoutMs}ms` : String(err?.message || err);
      log.warn('OuyuPush request failed', { url, error: msg });
      return { success: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}
