import type { ApiChannel } from '@/state/settings';
import { getContext } from '@/st/context';

/** Read public connection settings only. Never switch the main connection or read secrets. */
export function currentVertexSettings(): Partial<ApiChannel> {
  const source = getContext()?.chatCompletionSettings;
  if (source?.chat_completion_source !== 'vertexai') {
    throw new Error('请先在 TT 的 API 连接中选择 Google Vertex AI，再读取设置。');
  }
  const string = (key: string) => typeof source[key] === 'string' ? (source[key] as string).trim() : '';
  const auth = string('vertexai_auth_mode');
  // A proxy may use completely different authentication; never silently replace it with direct Google.
  if (string('reverse_proxy')) throw new Error('当前 Vertex 连接使用反向代理，本入口只读取 Google 直连设置。');
  return {
    provider: 'vertexai',
    vertexAuthMode: auth === 'full' ? 'full' : 'express',
    vertexRegion: string('vertexai_region') || 'global',
    vertexSecretId: string('secret_id'),
    model: string('vertexai_model'),
  };
}

export function buildVertexRequest(
  channel: ApiChannel, messages: Array<{role:string;content:string}>, stream: boolean,
): Record<string, unknown> {
  if (!channel.model.trim()) throw new Error('请填写 Vertex 模型名');
  const body: Record<string, unknown> = {
    chat_completion_source: 'vertexai',
    vertexai_auth_mode: channel.vertexAuthMode === 'express' ? 'express' : 'full',
    vertexai_region: channel.vertexRegion?.trim() || 'global',
    model: channel.model.trim(), messages, stream,
    temperature: channel.temperature ?? 1,
    max_tokens: channel.maxTokens ?? 65535,
    use_sysprompt: true,
    // Independent quiet request; no main-chat history, tools, searches or image generation.
    tool_choice: 'none', request_images: false, enable_web_search: false,
  };
  if (channel.vertexSecretId?.trim()) body.secret_id = channel.vertexSecretId.trim();
  if (channel.reasoningEffort?.trim()) body.reasoning_effort = channel.reasoningEffort.trim();
  const protectedFields = new Set(['chat_completion_source','vertexai_auth_mode','vertexai_region','secret_id','model','messages','stream']);
  for (const key of channel.excludeParams ?? []) if (!protectedFields.has(key.trim())) delete body[key.trim()];
  return body;
}

/** ST versions may return native Gemini JSON; TT also returns normalized OpenAI JSON. */
export function geminiText(data: any): string {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts ?? candidate?.output?.parts;
  if (!Array.isArray(parts)) return '';
  // Thoughts are not a valid fallback answer for a native Gemini response.
  return parts.filter(p=>p?.thought !== true && typeof p?.text === 'string').map(p=>p.text).join('');
}
