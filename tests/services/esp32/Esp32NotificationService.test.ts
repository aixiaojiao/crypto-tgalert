import { initDatabase, closeDatabase } from '../../../src/database/connection';
import {
  Esp32NotificationService,
  cleanForTts,
  isInQuietHours,
} from '../../../src/services/esp32/Esp32NotificationService';
import { OuyuPushClient } from '../../../src/services/esp32/OuyuPushClient';

/** Fake client that records calls and does not hit network. */
class FakeOuyuClient extends OuyuPushClient {
  public calls: string[] = [];
  public nextResult: { success: boolean; status?: number; error?: string } = { success: true, status: 200 };

  constructor() {
    super({ gatewayUrl: 'http://fake:18003', deviceId: 'AA:BB:CC:DD:EE:FF' });
  }

  async push(text: string) {
    this.calls.push(text);
    return this.nextResult;
  }
}

describe('Esp32NotificationService', () => {
  const USER = 'testuser';
  let client: FakeOuyuClient;
  let svc: Esp32NotificationService;

  beforeAll(async () => {
    process.env.DATABASE_PATH = ':memory:';
    await initDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  beforeEach(async () => {
    // Reset row for isolation
    const { getDatabase } = await import('../../../src/database/connection');
    const db = await getDatabase();
    await db.run('DELETE FROM esp32_config WHERE user_id = ?', USER);
    client = new FakeOuyuClient();
    svc = new Esp32NotificationService(client, USER);
    await svc.ensureRow();
  });

  describe('ensureRow / getConfig', () => {
    test('creates default row with disabled master switch and empty types', async () => {
      const cfg = await svc.getConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.enabledTypes).toEqual([]);
      expect(cfg.cooldownSeconds).toBe(60);
      expect(cfg.quietStart).toBeNull();
      expect(cfg.quietEnd).toBeNull();
    });

    test('ensureRow is idempotent', async () => {
      await svc.ensureRow();
      await svc.ensureRow();
      const cfg = await svc.getConfig();
      expect(cfg).toBeDefined();
    });
  });

  describe('enableTypes / disableTypes', () => {
    test('enableTypes adds to list without duplicates', async () => {
      await svc.enableTypes(['potential']);
      await svc.enableTypes(['potential', 'breakthrough']);
      const cfg = await svc.getConfig();
      expect(cfg.enabledTypes.sort()).toEqual(['breakthrough', 'potential']);
    });

    test('enableTypes "all" expands to every supported type', async () => {
      await svc.enableTypes(['all']);
      const cfg = await svc.getConfig();
      expect(cfg.enabledTypes.sort()).toEqual(
        ['breakthrough', 'potential', 'price', 'pump_dump', 'ranking'].sort()
      );
    });

    test('disableTypes "all" clears everything', async () => {
      await svc.enableTypes(['all']);
      await svc.disableTypes(['all']);
      const cfg = await svc.getConfig();
      expect(cfg.enabledTypes).toEqual([]);
    });

    test('disableTypes removes specific types only', async () => {
      await svc.enableTypes(['potential', 'breakthrough', 'price']);
      await svc.disableTypes(['breakthrough']);
      const cfg = await svc.getConfig();
      expect(cfg.enabledTypes.sort()).toEqual(['potential', 'price']);
    });

    test('invalid type names are silently dropped', async () => {
      await svc.enableTypes(['bogus', 'potential']);
      const cfg = await svc.getConfig();
      expect(cfg.enabledTypes).toEqual(['potential']);
    });
  });

  describe('setCooldownSeconds / setQuietHours', () => {
    test('accepts valid cooldown and persists', async () => {
      await svc.setCooldownSeconds(30);
      const cfg = await svc.getConfig();
      expect(cfg.cooldownSeconds).toBe(30);
    });

    test('rejects negative or absurd cooldown', async () => {
      await expect(svc.setCooldownSeconds(-1)).rejects.toThrow();
      await expect(svc.setCooldownSeconds(99999)).rejects.toThrow();
    });

    test('setQuietHours accepts HH:MM-HH:MM and clears on null/off', async () => {
      await svc.setQuietHours('23:00-08:00');
      let cfg = await svc.getConfig();
      expect(cfg.quietStart).toBe('23:00');
      expect(cfg.quietEnd).toBe('08:00');

      await svc.setQuietHours('off');
      cfg = await svc.getConfig();
      expect(cfg.quietStart).toBeNull();
      expect(cfg.quietEnd).toBeNull();
    });

    test('setQuietHours rejects bad format', async () => {
      await expect(svc.setQuietHours('bad')).rejects.toThrow();
      await expect(svc.setQuietHours('25:00-08:00')).rejects.toThrow();
    });
  });

  describe('pushAlert filters', () => {
    test('skips when master switch off', async () => {
      await svc.enableTypes(['potential']);
      const r = await svc.pushAlert('potential', 'hello');
      expect(r.success).toBe(false);
      expect(r.error).toContain('master switch off');
      expect(client.calls.length).toBe(0);
    });

    test('skips when type not enabled', async () => {
      await svc.setEnabled(true);
      await svc.enableTypes(['breakthrough']);
      const r = await svc.pushAlert('potential', 'hello');
      expect(r.error).toContain('not enabled');
      expect(client.calls.length).toBe(0);
    });

    test('pushes when master on and type enabled', async () => {
      await svc.setEnabled(true);
      await svc.enableTypes(['potential']);
      const r = await svc.pushAlert('potential', '**BTC** 突破新高 🚀');
      expect(r.success).toBe(true);
      // text should have Markdown and emoji stripped
      expect(client.calls[0]).toBe('BTC 突破新高');
    });

    test('cooldown blocks rapid second push', async () => {
      await svc.setEnabled(true);
      await svc.enableTypes(['potential']);
      await svc.setCooldownSeconds(60);

      const r1 = await svc.pushAlert('potential', 'first');
      const r2 = await svc.pushAlert('potential', 'second');
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(false);
      expect(r2.error).toContain('cooldown');
      expect(client.calls.length).toBe(1);
    });

    test('zero cooldown allows back-to-back pushes', async () => {
      await svc.setEnabled(true);
      await svc.enableTypes(['potential']);
      await svc.setCooldownSeconds(0);

      await svc.pushAlert('potential', 'a');
      await svc.pushAlert('potential', 'b');
      expect(client.calls.length).toBe(2);
    });

    test('cooldown is NOT consumed when downstream push fails', async () => {
      await svc.setEnabled(true);
      await svc.enableTypes(['potential']);
      await svc.setCooldownSeconds(60);
      client.nextResult = { success: false, status: 404, error: 'offline' };

      const r1 = await svc.pushAlert('potential', 'first');
      expect(r1.success).toBe(false);

      client.nextResult = { success: true, status: 200 };
      const r2 = await svc.pushAlert('potential', 'second');
      expect(r2.success).toBe(true); // cooldown was not engaged because first failed
    });

    test('never throws even if downstream throws', async () => {
      await svc.setEnabled(true);
      await svc.enableTypes(['potential']);
      // Force throw
      (client as any).push = () => {
        throw new Error('boom');
      };
      const r = await svc.pushAlert('potential', 'x');
      expect(r.success).toBe(false);
      expect(r.error).toContain('boom');
    });
  });
});

describe('cleanForTts', () => {
  test('strips markdown emphasis, code, links, and emojis', () => {
    const input = '🚀 *BTC* _突破_ `75000` 看 [详情](https://x) ✅';
    expect(cleanForTts(input)).toBe('BTC 突破 75000 看 详情');
  });

  test('collapses whitespace and trims', () => {
    expect(cleanForTts('  hello   world  ')).toBe('hello world');
  });

  test('returns empty string for empty input', () => {
    expect(cleanForTts('')).toBe('');
    expect(cleanForTts('   ')).toBe('');
  });
});

describe('isInQuietHours', () => {
  function at(h: number, m: number): Date {
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  test('null bounds → not in quiet', () => {
    expect(isInQuietHours(null, null, at(3, 0))).toBe(false);
    expect(isInQuietHours('23:00', null, at(3, 0))).toBe(false);
  });

  test('same-day window inclusive of start, exclusive of end', () => {
    expect(isInQuietHours('09:00', '17:00', at(9, 0))).toBe(true);
    expect(isInQuietHours('09:00', '17:00', at(12, 30))).toBe(true);
    expect(isInQuietHours('09:00', '17:00', at(17, 0))).toBe(false);
    expect(isInQuietHours('09:00', '17:00', at(8, 59))).toBe(false);
  });

  test('cross-midnight window (23:00-08:00)', () => {
    expect(isInQuietHours('23:00', '08:00', at(23, 30))).toBe(true);
    expect(isInQuietHours('23:00', '08:00', at(2, 0))).toBe(true);
    expect(isInQuietHours('23:00', '08:00', at(7, 59))).toBe(true);
    expect(isInQuietHours('23:00', '08:00', at(8, 0))).toBe(false);
    expect(isInQuietHours('23:00', '08:00', at(12, 0))).toBe(false);
  });

  test('start === end → never in quiet', () => {
    expect(isInQuietHours('10:00', '10:00', at(10, 0))).toBe(false);
  });
});
