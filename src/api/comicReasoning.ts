import type { ApiChannel } from '@/state/settings';

export type ComicReasoning = 'follow' | 'low' | 'off';
export interface ReasoningCapability { low: boolean; off: boolean; label: string; }
/** Connection/model scoped; no credentials or query parameters enter persisted keys. */
export function comicReasoningKey(channel: ApiChannel | null): string {
  if (!channel) return '';
  let endpoint = channel.url.trim().replace(/\/+$/, '');
  try { const url = new URL(endpoint); endpoint = url.origin + url.pathname.replace(/\/+$/, ''); } catch { endpoint = ''; }
  return JSON.stringify([channel.id, channel.provider ?? 'openai', endpoint, channel.model.trim()]);
}
export function comicReasoningCapability(channel: ApiChannel | null): ReasoningCapability {
  if (!channel) return { low: false, off: false, label: '跟随主 API，单独控制推理需要指派副 API 渠道' };
  if (channel.provider === 'vertexai') {
    const model = channel.model.replace(/^.*\//, '').toLowerCase();
    const flash25 = /^gemini-2\.5-flash(?:-lite)?(?:$|-)/.test(model) && !/image|live/.test(model);
    const known3=['gemini-3-flash','gemini-3-pro','gemini-3.1-pro','gemini-3.1-flash-lite','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.6-flash','gemini-3.7-flash','gemini-3.8-flash'].some(id=>model===id||model===id+'-preview');
    const known = !/image|live|audio|tts/.test(model) && (flash25 || /^gemini-2\.5-pro(?:$|-)/.test(model) || known3);
    return { low: known, off: flash25, label: flash25 ? '支持低推理和关闭推理' : known ? '支持低推理；此模型不能完全关闭推理' : '此模型的独立推理控制尚未适配，沿用渠道设置' };
  }
  let host = ''; try { host = new URL(channel.url).hostname; } catch { /* invalid connection */ }
  const known = host === 'api.deepseek.com' && /^(?:deepseek-flash|deepseek-v4-pro)$/.test(channel.model.trim());
  return { low: known, off: known, label: known ? '支持低推理和关闭推理' : '此接口与模型的独立推理控制尚未适配，沿用渠道设置' };
}
/** Returns request-only fields; never mutates the shared channel or its saved effort. */
export function comicReasoningOverride(channel: ApiChannel | null, mode: ComicReasoning): Record<string, unknown> | undefined {
  const capability = comicReasoningCapability(channel);
  if (mode === 'follow' || !channel || (mode === 'low' ? !capability.low : !capability.off)) return undefined;
  if (channel.provider === 'vertexai') return { reasoning_effort: mode === 'off' ? 'min' : 'low' };
  return mode === 'off' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled' }, reasoning_effort: 'low' };
}
export function normalizeComicReasoningMap(value: unknown): Record<string, ComicReasoning> {
  const out: Record<string, ComicReasoning> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, mode] of Object.entries(value)) {
    if (key.length < 2048 && (mode === 'follow' || mode === 'low' || mode === 'off')) out[key] = mode;
  }
  return out;
}
