import { getContext, type STEventSource } from '@/st/context';
import { settings, isCurrentChatExcluded } from '@/state/settings';

const KEY = 'bbi_stream_marker_rule';
let warned = false;
let eligibleGeneration = false;
let generationRule = '';
const bound = new WeakSet<STEventSource>();
const active = () => Boolean(settings.enabled && settings.autoTag.enabled && settings.autoTag.streamGen && !isCurrentChatExcluded());
export function markerRuleText(min: number, max: number): string {
  return `【正文配图标记规则】
写剧情时，在值得配图的段落之后放单独一行 [img: 一句中文画面意图]。每条意图不超过30字，不写英文tag。
本楼配图数量控制在 ${min}~${max} 张之间。数量范围优先于密度；约400~600字一个标记仅作分布指引，不得超过上限。不要把标记全部集中在开头。
标记对应一个有视觉价值的事件，可表现动作、互动、场景变化或人物状态。不得为了配图编造剧情。${min === 0 ? '没有值得绘制的事件可以不放标记。' : '在有事实依据的候选中满足最低数量。'}`;
}
export function syncMarkerInjection(): void {
  const ctx = getContext();
  if (ctx?.setExtensionPrompt) {
    try {
      ctx.setExtensionPrompt(KEY, active() && eligibleGeneration ? generationRule : '', 1, 1, false, 0, () => eligibleGeneration && active());
    } catch (error) { console.warn('[BBI][AutoTagDebug] marker-inject:register-failed', String(error)); }
  } else if (active() && !ctx?.eventTypes.GENERATE_AFTER_DATA && !settings.autoTag.streamWorldBook?.trim() && !warned) {
    warned = true; toastr.info('当前客户端未提供标记注入接口，请配置已有的配图规则世界书；无标记时使用原版整楼分析', '柏宝绘');
  }
}

function messageText(message: Record<string, unknown>): string {
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.map(part => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '').join('\n');
}

/** Final request guard: Generate emits this after assembly; generateRaw tag requests do not. */
export function ensureMarkerInRequest(data: unknown, dryRun: unknown): boolean {
  if (!eligibleGeneration || dryRun || !active() || !data || typeof data !== 'object') return false;
  const request = data as { prompt?: unknown; messages?: unknown };
  // TauriTavern/SillyTavern Generate emits { prompt: ChatMsg[] }, before sendOpenAIRequest builds { messages }.
  const messages = Array.isArray(request.prompt) ? request.prompt : request.messages;
  if (!Array.isArray(messages)) return false; // Text completion retains its native extension prompt path.
  const rulePresent = messages.some(message => message && typeof message === 'object' &&
    ['system', 'developer'].includes(message.role) && /【正文配图标记/.test(messageText(message)) && /\[img:/.test(messageText(message)));
  if (rulePresent) {
    console.info('[BBI][AutoTagDebug] marker-inject:verified', JSON.stringify({ path: 'existing-rule', messages: messages.length }));
    return true;
  }
  // Keep all existing messages and their order, including assistant prefills.
  let at = messages.length;
  while (at > 0 && messages[at - 1]?.role === 'assistant') at--;
  messages.splice(at, 0, { role: 'system', content: generationRule });
  console.info('[BBI][AutoTagDebug] marker-inject:verified', JSON.stringify({ path: 'final-request', messages: messages.length }));
  return true;
}

export function bindMarkerInjection(): void {
  const ctx = getContext();
  if (!ctx?.eventSource || bound.has(ctx.eventSource)) return;
  bound.add(ctx.eventSource);
  ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, (type: unknown, _options: unknown, dryRun: unknown) => {
    eligibleGeneration = !dryRun && typeof type === 'string' && type !== 'quiet' && type !== 'impersonate';
    generationRule = eligibleGeneration ? markerRuleText(settings.autoTag.minImages, settings.autoTag.maxImages) : '';
    syncMarkerInjection(); // Restore rules cleared by the host since plugin startup.
  });
  ctx.eventSource.on(ctx.eventTypes.GENERATE_AFTER_DATA || 'generate_after_data', ensureMarkerInRequest);
  for (const event of [ctx.eventTypes.GENERATION_ENDED, ctx.eventTypes.GENERATION_STOPPED, ctx.eventTypes.CHAT_CHANGED]) {
    if (event) ctx.eventSource.on(event, () => { eligibleGeneration = false; generationRule = ''; syncMarkerInjection(); });
  }
}
