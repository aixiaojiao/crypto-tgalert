import { OuyuPushClient } from '../../../src/services/esp32/OuyuPushClient';

describe('OuyuPushClient', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
  });

  function okResponse(status = 200, body: any = { status: 'ok' }): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  test('pushes JSON body with text to expected URL', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const client = new OuyuPushClient({
      gatewayUrl: 'http://47.111.161.136:18003',
      deviceId: '94:a9:90:29:00:44',
    });

    const result = await client.push('BTC突破75000美元');

    expect(result.success).toBe(true);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://47.111.161.136:18003/v1/devices/94%3Aa9%3A90%3A29%3A00%3A44/push');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ text: 'BTC突破75000美元' });
  });

  test('strips trailing slash in gateway URL', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    const client = new OuyuPushClient({
      gatewayUrl: 'http://host:18003/',
      deviceId: 'AA:BB',
    });
    await client.push('x');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host:18003/v1/devices/AA%3ABB/push');
  });

  test('returns failure on non-2xx without throwing (device offline 404)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(404, { error: 'device offline' }));
    const client = new OuyuPushClient({
      gatewayUrl: 'http://host:18003',
      deviceId: 'AA:BB',
    });
    const result = await client.push('hello');
    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
  });

  test('returns failure on network error without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new OuyuPushClient({
      gatewayUrl: 'http://host:18003',
      deviceId: 'AA:BB',
    });
    const result = await client.push('hello');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  test('rejects empty text without calling fetch', async () => {
    const client = new OuyuPushClient({
      gatewayUrl: 'http://host:18003',
      deviceId: 'AA:BB',
    });
    const result = await client.push('   ');
    expect(result.success).toBe(false);
    expect(result.error).toBe('empty text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects push when device_id is empty', async () => {
    const client = new OuyuPushClient({
      gatewayUrl: 'http://host:18003',
      deviceId: '',
    });
    const result = await client.push('hi');
    expect(result.success).toBe(false);
    expect(result.error).toBe('device_id not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('aborts on timeout', async () => {
    jest.useFakeTimers();
    const capturedSignals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: any, init: any) => {
      capturedSignals.push(init.signal);
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const client = new OuyuPushClient({
      gatewayUrl: 'http://host:18003',
      deviceId: 'AA:BB',
      timeoutMs: 100,
    });
    const promise = client.push('hi');
    jest.advanceTimersByTime(150);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
    expect(capturedSignals[0]?.aborted).toBe(true);
    jest.useRealTimers();
  });
});
