import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNaiAccount, naiDefaultFreeImages, naiSubscriptionEndpoint, parseNaiAccount } from './naiAccount';
import { testNaiConnection } from './nai';

const connection = { url: 'https://image.novelai.net', key: 'fixture-key-only' };
const sample = { tier: 3, active: true, trainingStepsLeft: { fixedTrainingStepsLeft: 8500, purchasedTrainingSteps: 1200 },
  usage: { percent: 65, purchasedPercent: 5, isNegative: false, timeUntilNextPercent: 7888 } };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('NAI subscription address', () => {
  it.each([
    ['https://image.novelai.net', 'https://image.novelai.net/user/subscription'],
    ['https://image.novelai.net/', 'https://image.novelai.net/user/subscription'],
    ['https://image.novelai.net/ai', 'https://image.novelai.net/user/subscription'],
    ['https://image.novelai.net/ai/generate-image', 'https://image.novelai.net/user/subscription'],
    ['https://image.novelai.net/ai/user/subscription', 'https://image.novelai.net/user/subscription'],
    ['https://proxy.example/nai', 'https://proxy.example/nai/user/subscription'],
    ['https://proxy.example/nai/ai/generate-image', 'https://proxy.example/nai/user/subscription'],
    ['https://proxy.example/nai/user/subscription', 'https://proxy.example/nai/user/subscription'],
  ])('preserves the selected host and base path: %s', (base, expected) => expect(naiSubscriptionEndpoint(base)).toBe(expected));
  it.each(['', 'not-a-url', 'file:///tmp/account', 'https://name:password@proxy.example', 'https://proxy.example?key=private'])('rejects an invalid base without attempting requests: %s', base => {
    expect(() => naiSubscriptionEndpoint(base)).toThrow();
  });
});

describe('account values are returned data, not invented zeroes', () => {
  it('separates subscription and purchased Anlas, and keeps extra usage separate', () => {
    expect(parseNaiAccount(sample)).toEqual({ tier: 3, active: true, subscriptionAnlas: 8500, purchasedAnlas: 1200, totalAnlas: 9700,
      usage: { percent: 65, purchasedPercent: 5, unavailable: false, secondsPerPercent: 7888 } });
  });
  it('accepts the existing compatible subscription wrapper', () => expect(parseNaiAccount({ subscription: sample }).totalAnlas).toBe(9700));
  it('preserves a real zero balance and missing usage as different states', () => {
    const account = parseNaiAccount({ trainingStepsLeft: { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0 } });
    expect(account.totalAnlas).toBe(0); expect(account.usage).toBeNull(); expect(naiDefaultFreeImages(account.usage)).toBeNull();
  });
  it('does not fill an omitted purchased balance with zero or claim a total', () => {
    const account = parseNaiAccount({ trainingStepsLeft: { fixedTrainingStepsLeft: 300 } });
    expect(account.subscriptionAnlas).toBe(300); expect(account.purchasedAnlas).toBeNull(); expect(account.totalAnlas).toBeNull();
  });
  it('does not cap bonus allowance above 100% or divide by a paused refill', () => {
    const account = parseNaiAccount({ usage: { percent: 120, isNegative: false, timeUntilNextPercent: 0 } });
    expect(account.usage?.percent).toBe(120); expect(account.usage?.secondsPerPercent).toBe(0); expect(naiDefaultFreeImages(account.usage)).toBe(2076);
  });
  it('distinguishes rounded zero percent from an unavailable allowance', () => {
    expect(parseNaiAccount({ usage: { percent: 0, isNegative: false } }).usage?.unavailable).toBe(false);
    const account = parseNaiAccount({ usage: { percent: 3, isNegative: true } });
    expect(account.usage?.unavailable).toBe(true); expect(naiDefaultFreeImages(account.usage)).toBe(0);
  });
  it.each([null, [], {}, { tier: 3 }, { trainingStepsLeft: { fixedTrainingStepsLeft: '500' } }, { usage: { percent: -1 } }, { usage: { percent: NaN } }])('rejects missing or malformed quota values %#', value => expect(() => parseNaiAccount(value)).toThrow());
});

describe('read-only authenticated account queries', () => {
  it('uses the selected key, GET and the user endpoint without a generation request', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(sample), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', request);
    expect((await fetchNaiAccount(connection)).totalAnlas).toBe(9700);
    expect(request).toHaveBeenCalledOnce(); expect(request).toHaveBeenCalledWith('https://image.novelai.net/user/subscription', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer fixture-key-only' }, cache: 'no-store', redirect: 'error' }));
  });
  it('also corrects the existing connection-test endpoint', async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(sample))); vi.stubGlobal('fetch', request);
    await expect(testNaiConnection(connection)).resolves.toEqual({ message: '连接正常:Opus' });
    expect(request.mock.calls[0][0]).toBe('https://image.novelai.net/user/subscription');
  });
  it.each([[401, 'authentication'], [403, 'authentication'], [404, 'unsupported'], [429, 'rate-limit'], [500, 'http']] as const)('handles HTTP %s without displaying echoed server secrets', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private token in server body', { status })));
    await expect(fetchNaiAccount(connection)).rejects.toMatchObject({ code, status });
    await fetchNaiAccount(connection).catch(error => expect(error.message).not.toContain('private token'));
  });
  it('does not try the official host after a selected proxy rejects the request', async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 404 })); vi.stubGlobal('fetch', request);
    await expect(fetchNaiAccount({ url: 'https://proxy.example/nai', key: 'proxy-key' })).rejects.toHaveProperty('code', 'unsupported');
    expect(request).toHaveBeenCalledOnce(); expect(request.mock.calls[0][0]).toBe('https://proxy.example/nai/user/subscription');
  });
  it('does not query with an empty key', async () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request); await expect(fetchNaiAccount({ ...connection, key: ' ' })).rejects.toHaveProperty('code', 'missing-key'); expect(request).not.toHaveBeenCalled();
  });
  it('rejects a cancelled account result even if a mock transport ignores cancellation', async () => {
    const controller = new AbortController(); let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', () => new Promise<Response>(r => resolve = r)); const waiting = fetchNaiAccount(connection, controller.signal);
    controller.abort(); resolve(new Response(JSON.stringify(sample))); await expect(waiting).rejects.toHaveProperty('name', 'AbortError');
  });
  it('times out account reads without leaving its timer behind', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const waiting = expect(fetchNaiAccount(connection)).rejects.toHaveProperty('code', 'timeout'); await vi.advanceTimersByTimeAsync(15_000); await waiting; expect(vi.getTimerCount()).toBe(0);
  });
});
