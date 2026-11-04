/** Read-only account data. Never send a selected endpoint's key to another host.
 * Authority: https://image.novelai.net/docs/doc.json (checked 2026-11-03),
 * /user/subscription, user.SubscriptionResponse and usagelimit.Status.
 */
export interface NaiAccount {
  subscriptionAnlas: number | null;
  purchasedAnlas: number | null;
  totalAnlas: number | null;
  tier: number | null;
  active: boolean | null;
  usage: { percent: number; purchasedPercent: number | null; unavailable: boolean; secondsPerPercent: number | null } | null;
}
export class NaiAccountError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) { super(message); this.name = 'NaiAccountError'; }
}
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Subscription is a user endpoint, not an /ai/ generation endpoint.
 * Preserve a compatible proxy's base path and never fall back to the official host.
 */
export function naiSubscriptionEndpoint(base: string): string {
  let url: URL;
  try { url = new URL(base.trim()); } catch { throw new NaiAccountError('请填写有效的 NAI 接口地址', 'invalid-url'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new NaiAccountError('请填写 NAI 接入点的基础地址', 'invalid-url');
  let prefix = url.pathname.replace(/\/+$/, '');
  prefix = prefix.replace(/\/(?:ai\/)?user\/subscription$/, '');
  prefix = prefix.replace(/\/(?:ai\/)?generate-image$/, '').replace(/\/ai$/, '');
  return `${url.origin}${prefix}/user/subscription`;
}

export function parseNaiAccount(value: unknown): NaiAccount {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
  const data = root?.subscription && typeof root.subscription === 'object' ? root.subscription : root;
  if (!data) throw new NaiAccountError('该接入点未返回账户余额信息', 'unavailable');
  const subscriptionAnlas = integer(data.trainingStepsLeft?.fixedTrainingStepsLeft), purchasedAnlas = integer(data.trainingStepsLeft?.purchasedTrainingSteps);
  const percent = integer(data.usage?.percent);
  const usage = percent === null ? null : { percent, purchasedPercent: integer(data.usage?.purchasedPercent),
    unavailable: data.usage?.isNegative === true, secondsPerPercent: integer(data.usage?.timeUntilNextPercent) };
  if (subscriptionAnlas === null && purchasedAnlas === null && !usage) throw new NaiAccountError('该接入点未返回余额或免费额度', 'unavailable');
  return { subscriptionAnlas, purchasedAnlas, totalAnlas: subscriptionAnlas !== null && purchasedAnlas !== null ? subscriptionAnlas + purchasedAnlas : null,
    tier: integer(data.tier), active: typeof data.active === 'boolean' ? data.active : null, usage };
}

/** Official default-parameter reference, not a quote for the selected settings.
 * https://journal.novelai.net/opus-usage-limit-explained/ (~1,730 per full bar).
 */
export function naiDefaultFreeImages(usage: NaiAccount['usage']): number | null {
  return usage ? usage.unavailable ? 0 : Math.round(usage.percent * 17.3) : null;
}

export async function fetchNaiAccount(connection: { url: string; key: string }, signal?: AbortSignal): Promise<NaiAccount> {
  if (!connection.key.trim()) throw new NaiAccountError('填写 API Key 后可查询余额', 'missing-key');
  const endpoint = naiSubscriptionEndpoint(connection.url), controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const response = await fetch(endpoint, { method: 'GET', headers: { Authorization: `Bearer ${connection.key.trim()}` }, signal: controller.signal, cache: 'no-store', redirect: 'error' });
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new NaiAccountError('认证失败，请检查当前接入点的 API Key', 'authentication', response.status);
      if (response.status === 404 || response.status === 405) throw new NaiAccountError('该接入点不支持账户余额查询', 'unsupported', response.status);
      if (response.status === 429) throw new NaiAccountError('查询过于频繁，请稍后刷新', 'rate-limit', response.status);
      throw new NaiAccountError(`余额查询失败（${response.status}）`, 'http', response.status);
    }
    const data: unknown = await response.json();
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    return parseNaiAccount(data);
  } catch (error) {
    if (timedOut) throw new NaiAccountError('余额查询超时，请稍后刷新', 'timeout');
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (error instanceof NaiAccountError) throw error;
    // Neither response bodies nor raw network errors may expose a key in the UI.
    throw new NaiAccountError('暂时无法读取余额，请检查网络后刷新', 'network');
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
