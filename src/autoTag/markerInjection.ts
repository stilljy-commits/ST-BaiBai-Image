import { getContext, type STEventSource } from '@/st/context';
import { settings, isCurrentChatExcluded } from '@/state/settings';

const KEY = 'bbi_stream_marker_rule';
let warned = false;
let eligibleGeneration = false;
let generationRule = '';
let generationCountRule = '';
const bound = new WeakSet<STEventSource>();
const active = () => Boolean(settings.enabled && settings.autoTag.enabled && settings.autoTag.streamGen && !isCurrentChatExcluded());
export function markerCountRuleText(min: number, max: number): string {
  return `【本次配图数量约束（柏宝绘）】
本楼配图数量控制在 ${min}~${max} 张之间，统计整条正文的 [img: 中文画面意图] 标记数，不是漫画页内的画格数。${min === max ? `本次必须恰好 ${max} 个标记。` : `在此范围内按真实视觉事件选择数量，不要求接近上限 ${max}。`}
只在正式剧情正文中放标记；字数统计、信息小结、状态栏、选项和规则示例中不放配图标记，也不复述标记格式。
本次插件数量范围优先；已有世界书若写了不同数量，以本条为准。“每多少字一个标记”只辅助分布，不是独立数量要求；篇幅较长就适当拉大间隔，较短就选择次要但真实可见的事件满足下限。标记随剧情推进分散放置，不集中在开头或结尾。${min === 0 ? '没有值得绘制的事件可以不放标记。' : `从有事实依据的候选中满足至少 ${min} 个标记。`}不得为了凑数编造人物、动作或剧情；结束前核对数量和分布。`;
}
export function markerRuleText(min: number, max: number): string {
  return `【正文配图标记规则】
写剧情时，在值得配图的段落之后放单独一行 [img: 一句中文画面意图]。每条意图不超过30字，不写英文tag。
标记对应一个有视觉价值的事件，可表现动作、互动、场景变化或人物状态。未提供其它密度建议时可参考约400~600字一个标记，实际间隔服从数量与剧情。
${markerCountRuleText(min, max)}`;
}
export function syncMarkerInjection(): void {
  const ctx = getContext();
  if (ctx?.setExtensionPrompt) {
    try {
      ctx.setExtensionPrompt(KEY, active() && eligibleGeneration ? generationRule : '', 1, 1, false, 0, () => eligibleGeneration && active());
    } catch (error) { console.warn('[BBI][AutoTagDebug] marker-inject:register-failed', String(error)); }
  } else if (active() && !ctx?.eventTypes.GENERATE_AFTER_DATA && !warned) {
    warned = true; toastr.info('当前客户端未提供标记注入接口；无标记时使用整楼分析，请更新客户端以使用自动注入', '柏宝绘');
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
    // Reuse the world's drawing rules, but don't let their old count or word density
    // silently replace this generation's frozen plugin range. Never edits the book.
    const countPresent = messages.some(message => message && typeof message === 'object' &&
      ['system', 'developer'].includes(message.role) && messageText(message).includes(generationCountRule));
    if (countPresent) {
      console.info('[BBI][AutoTagDebug] marker-inject:verified', JSON.stringify({ path: 'existing-rule', messages: messages.length }));
      return true;
    }
  }
  // Keep all existing messages and their order, including assistant prefills.
  let at = messages.length;
  while (at > 0 && messages[at - 1]?.role === 'assistant') at--;
  messages.splice(at, 0, { role: 'system', content: rulePresent ? generationCountRule : generationRule });
  console.info('[BBI][AutoTagDebug] marker-inject:verified', JSON.stringify({ path: rulePresent ? 'count-override' : 'final-request', messages: messages.length }));
  return true;
}

export function bindMarkerInjection(): void {
  const ctx = getContext();
  if (!ctx?.eventSource || bound.has(ctx.eventSource)) return;
  bound.add(ctx.eventSource);
  ctx.eventSource.on(ctx.eventTypes.GENERATION_STARTED, (type: unknown, _options: unknown, dryRun: unknown) => {
    eligibleGeneration = !dryRun && typeof type === 'string' && type !== 'quiet' && type !== 'impersonate';
    generationRule = eligibleGeneration ? markerRuleText(settings.autoTag.minImages, settings.autoTag.maxImages) : '';
    generationCountRule = eligibleGeneration ? markerCountRuleText(settings.autoTag.minImages, settings.autoTag.maxImages) : '';
    syncMarkerInjection(); // Restore rules cleared by the host since plugin startup.
  });
  ctx.eventSource.on(ctx.eventTypes.GENERATE_AFTER_DATA || 'generate_after_data', ensureMarkerInRequest);
  for (const event of [ctx.eventTypes.GENERATION_ENDED, ctx.eventTypes.GENERATION_STOPPED, ctx.eventTypes.CHAT_CHANGED]) {
    if (event) ctx.eventSource.on(event, () => { eligibleGeneration = false; generationRule = ''; generationCountRule = ''; syncMarkerInjection(); });
  }
}
