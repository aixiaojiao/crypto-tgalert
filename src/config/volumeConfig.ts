import { config } from '../config';
import { getDatabase } from '../database/connection';
import { log } from '../utils/logger';

// 加密永续成交量大,默认 30M;TradFi 标的成交量普遍偏小,默认降到 10M。
const DEFAULT_VOLUME_THRESHOLD_USDT = config.app.alertMode === 'tradfi' ? 10_000_000 : 30_000_000;

let cachedThreshold: number = DEFAULT_VOLUME_THRESHOLD_USDT;
let initialized = false;

export async function refreshVolumeThreshold(): Promise<number> {
  // tradfi 模式不复用加密时代用户在 DB 里设的成交量阈值(通常是 30M),固定用 tradfi 默认值。
  if (config.app.alertMode === 'tradfi') {
    cachedThreshold = DEFAULT_VOLUME_THRESHOLD_USDT;
    initialized = true;
    log.info('Volume threshold (tradfi default)', { thresholdUSDT: cachedThreshold });
    return cachedThreshold;
  }

  try {
    const db = await getDatabase();
    const row = await db.get(
      'SELECT MAX(volume_threshold) AS t FROM user_filter_settings WHERE volume_threshold > 0'
    );
    const t = row && typeof row.t === 'number' ? row.t : null;
    cachedThreshold = t && t > 0 ? t : DEFAULT_VOLUME_THRESHOLD_USDT;
    initialized = true;
    log.info('Volume threshold refreshed', { thresholdUSDT: cachedThreshold });
    return cachedThreshold;
  } catch (error) {
    log.warn('Failed to refresh volume threshold, keeping previous value', {
      error: (error as Error).message,
      fallback: cachedThreshold,
    });
    return cachedThreshold;
  }
}

export function getVolumeThreshold(): number {
  if (!initialized) return DEFAULT_VOLUME_THRESHOLD_USDT;
  return cachedThreshold;
}

export function isLowVolume(volume24hUSDT: number | null | undefined): boolean {
  if (volume24hUSDT === null || volume24hUSDT === undefined || !Number.isFinite(volume24hUSDT)) {
    return true;
  }
  return volume24hUSDT < getVolumeThreshold();
}

export function getVolumeIcon(volume24hUSDT: number | null | undefined): string {
  return isLowVolume(volume24hUSDT) ? '💧' : '';
}
