/**
 * 模块级单例：其他告警服务直接 import { esp32NotificationService } 使用。
 *
 * 配置读取：
 *   OUYU_GATEWAY_URL   e.g. http://47.111.161.136:18003
 *   OUYU_DEVICE_ID     e.g. 94:a9:90:29:00:44 （招福绑定的 ESP32 MAC）
 * 若未配置，服务仍可构造但 push 会在底层返回失败；
 * 加上 DB 中的 enabled 默认关闭，总体表现为"feature off"。
 */
import { config } from '../../config';
import { log } from '../../utils/logger';
import { OuyuPushClient } from './OuyuPushClient';
import { Esp32NotificationService } from './Esp32NotificationService';

const gatewayUrl = process.env.OUYU_GATEWAY_URL || '';
const deviceId = process.env.OUYU_DEVICE_ID || '';

if (!gatewayUrl || !deviceId) {
  log.info('Esp32 push disabled at startup: OUYU_GATEWAY_URL / OUYU_DEVICE_ID not set');
}

const client = new OuyuPushClient({
  gatewayUrl: gatewayUrl || 'http://localhost:18003',
  deviceId,
});

export const esp32NotificationService = new Esp32NotificationService(
  client,
  config.telegram.userId
);

export { OuyuPushClient } from './OuyuPushClient';
export {
  Esp32NotificationService,
  ESP32_ALERT_TYPES,
  type Esp32AlertType,
  type Esp32ConfigSnapshot,
  isInQuietHours,
  cleanForTts,
} from './Esp32NotificationService';
