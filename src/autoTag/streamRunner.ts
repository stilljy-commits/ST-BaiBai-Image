import { requestCompletion, requestViaMainApi, type ChatMsg } from '@/api/client';
import { buildAutoTagMessages, captureAutoTagEnvironment, type AutoTagEnvironment } from '@/autoTag/prompt';
import { maskStreamStorySource, prepareTargetText, type PreparedTargetText } from '@/autoTag/clean';
import { readBookMemory } from '@/autoTag/bookMemory';
import { applyPositionedCharRefs, resolveCharAnchors } from '@/autoTag/charAnchors';
import { MarkerScanner, markerSegments, prefixBefore, replaceMarkers, findMarkers, contextWithoutRepeatedTarget } from '@/autoTag/markers';
import { injectImageTags, parseImagePlan, type ImageInsertion, type CharChange, type ImagePlan } from '@/autoTag/protocol';
import { rebaseImagePositions } from '@/autoTag/rebase';
import { captureRenderProfile, type RenderProfile } from '@/autoTag/renderProfile';
import { StreamRun, streamBatchSizes, type StreamJob } from '@/autoTag/streamCore';
import { prepareStreamBatch, splitStreamBatch } from '@/autoTag/streamBatch';
import { mergeStreamProfiles } from '@/autoTag/streamProfiles';
import { registerStreamActions, updateStreamSlot, forgetStreamSlot } from '@/autoTag/streamState';
import { planChangeOps } from '@/autoTag/changeOps';
import { charTagsBeforeFloor, lockedCharTagNames, makeCharTagFloorDelta, readCharTagFloorDelta, recomputeCharTags, applyCharTagOps, BBI_CHAR_EXTRA_KEY, type CharTagAutoOp } from '@/state/charTags';
import { settings, getTagGenChannel, isCurrentChatExcluded, type AutoTagSettings } from '@/state/settings';
import { captureGenerationSnapshot, generateImage, decideSeed, type GenerationSnapshot, type GenerateOutput } from '@/generate';
import { saveImageResult } from '@/floor/storage';
import { hydrateMessage } from '@/floor/hydrate';
import { applyMessageText, ensureFloorRendered, isSameMessage } from '@/st/messageEdit';
import { getContext, type STContext, type STMessage } from '@/st/context';
import { parseImageTags, parseImageTagContent, serializeImageTag } from '@/st/imageTagRegex';
import { randomUuid } from '@/randomUuid';
import { effectiveOrientation, parseSize, pickSize } from '@/backends/size';

interface Payload { image: ImageInsertion; changes: CharChange[]; }
type Job = StreamJob<Payload, GenerateOutput>;
interface Session {
  id: string; chatId: string; context: STContext; referenceFloor: number;
  scanner: MarkerScanner; core: StreamRun<Payload, GenerateOutput>;
  options: AutoTagSettings; generation: GenerationSnapshot; profile: RenderProfile;
  stripTags: string[];
  promptEnvironment: AutoTagEnvironment; existingCount: number; continuing: boolean; baselineOps: CharTagAutoOp[]; channel: ReturnType<typeof getTagGenChannel>; body?: string; prepared?: PreparedTargetText;
  binding?: { floor: number; message: STMessage; swipeId: number; expectedSwipe: number | null };
  controller: AbortController; chain: Promise<void>; written: Map<string, string>; established: Map<string, CharChange>; changeOps: Map<string, CharTagAutoOp>; completed: boolean; supplementDone: boolean;
}
const sessions = new Map<string, Session>();
let current: Session | undefined;
const log = (event: string, detail: unknown) => console.info(`[BBI][AutoTagDebug] ${event}`, JSON.stringify(detail));
const swipe = (message: STMessage) => Array.isArray(message.swipes) ? (message.swipe_id ?? 0) : null;
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function ownerValid(s: Session): boolean {
  const ctx = getContext();
  if (!ctx || ctx.getCurrentChatId() !== s.chatId) return false;
  if (!s.binding) return true;
  const { floor, message, expectedSwipe } = s.binding;
  return !!ctx.chat[floor] && isSameMessage(ctx.chat[floor], message) && swipe(ctx.chat[floor]) === expectedSwipe;
}
function serial<T>(s: Session, action: () => Promise<T>): Promise<T> {
  const task = s.chain.then(action); s.chain = task.then(() => undefined, () => undefined); return task;
}
function tagFor(s: Session, job: Job): string {
  return serializeImageTag(job.payload ? { ...job.payload.image, slotId: job.id, renderProfile: s.profile }
    : { tag: '', nl: '', negative: '', characters: [], slotId: job.id,
      pending: job.input.raw || job.input.intent, renderProfile: s.profile, size: s.promptEnvironment.profile.lockedSize ?? 'portrait' });
}
function publish(s: Session, job: Job): void {
  if (job.saved || job.phase === 'cancelled') { forgetStreamSlot(job.id); updatePreview(s); return; }
  const dimensions = s.generation.backend === 'nai' ? parseSize(pickSize(s.generation.nai,
    effectiveOrientation(s.generation.orientation, job.payload?.image.size ?? s.promptEnvironment.profile.lockedSize ?? 'portrait')) || '832×1216') : null;
  updateStreamSlot(job.id, { phase: job.phase, url: job.result?.result.url, error: job.error, dimensions: dimensions ?? undefined });
  registerStreamActions(job.id, { cancel: () => s.core.cancelJob(job), retry: () => { if (ownerValid(s)) s.core.retry(job); } });
  updatePreview(s);
}
function retire(s: Session): void {
  if (!s.completed || !s.supplementDone || s.core.working) return;
  const unfinished = s.core.jobs.some(job => job.attached && job.result && !job.saved);
  if (!unfinished) document.getElementById(`bbi-preview-${s.id}`)?.remove();
  if (!unfinished && s.core.jobs.every(job => job.saved || job.phase === 'cancelled')) sessions.delete(s.id);
  // Pending/error slots retain retry actions until the user leaves this chat.
}

export function beginStreamSession(chatId: string, type = 'normal'): void {
  const ctx = getContext();
  if (current && !current.completed) {
    current.controller.abort(); current.core.cancel();
    document.getElementById(`bbi-preview-${current.id}`)?.remove(); sessions.delete(current.id);
  }
  current = undefined;
  if (!ctx || !settings.enabled || !settings.autoTag.enabled || !settings.autoTag.streamGen || isCurrentChatExcluded()) return;
  const state: Omit<Session, 'core'> = {
    id: `sr_${randomUuid().replace(/-/g, '')}`, chatId, context: ctx, referenceFloor: ctx.chat.at(-1)?.is_user ? ctx.chat.length : Math.max(0, ctx.chat.length - 1),
    scanner: new MarkerScanner(), options: jsonCopy(settings.autoTag),
    stripTags: [...settings.excludes.customStripTags,'bbi_image'],
    generation: captureGenerationSnapshot(), profile: captureRenderProfile(settings.nai, settings.defaultBackend),
    promptEnvironment: captureAutoTagEnvironment(), existingCount: type === 'continue' ? parseImageTags(ctx.chat.at(-1)?.mes ?? '').length : 0,
    continuing: type === 'continue', baselineOps: [],
    channel: getTagGenChannel() ? jsonCopy(getTagGenChannel()) : null,
    controller: new AbortController(), chain: Promise.resolve(), written: new Map(), established: new Map(), changeOps: new Map(), completed: false, supplementDone: false,
  };
  const core = new StreamRun<Payload, GenerateOutput>(state.id, Math.max(0, state.options.maxImages - state.existingCount), Math.min(4, Math.max(1, state.options.streamAnalysisConcurrency ?? 2)),
    state.options.autoGenerate, {
      analyze: job => analyze(s, job),
      analyzeBatch: jobs => analyzeBatch(s, jobs),
      batchFailed: (jobs,error) => {
        const message=error instanceof Error?error.message:'';
        const code=/少于|图片数|图片数量/.test(message)?'image-count':/position|可选位置|P编号/.test(message)?'position':/标记/.test(message)?'marker-ownership':/JSON|数组|tag/.test(message)?'response-format':'request-failed';
        log('stream:batch-fallback', { jobs: jobs.map(job => job.id), batchSize:jobs.length, code, reason: '批量分析未通过，按原单张流程重试' });
      },
      generate: async (payload, job) => {
        const start = performance.now();
        const output = await generateImage({ prompt: payload.image.tag, nl: payload.image.nl,
        negative: payload.image.negative, characters: payload.image.characters, size: payload.image.size,
        seed: s.generation.backend === 'nai' && s.generation.nai.seed > 0 ? s.generation.nai.seed : decideSeed(s.generation.backend),
        renderProfile: s.profile }, job.controller.signal, {}, s.generation);
        log('stream:image-timing', { job: job.id, queueAndGenerateMs: Math.round(performance.now() - start) });
        return output;
      },
      commit: job => commit(s, job), changed: job => publish(s, job),
      release: output => output.result.revoke(), idle: () => retire(s),
    });
  const s: Session = { ...state, core };
  sessions.set(s.id, s); current = s; log('stream:begin', { run: s.id, chatId, minImages: state.options.minImages,
    maxImages: state.options.maxImages, batchSizes: streamBatchSizes(core.max), analysisConcurrency: core.concurrency });
}

/** Cancel only runs belonging to a chat that is no longer active. */
export function cancelStreamSessions(keepChatId?: string): void {
  for (const [id, s] of sessions) {
    if (keepChatId && s.chatId === keepChatId) continue;
    s.controller.abort(); s.core.cancel(); for (const job of s.core.jobs) forgetStreamSlot(job.id);
    document.getElementById(`bbi-preview-${id}`)?.remove(); sessions.delete(id);
    if (current === s) current = undefined;
  }
}
export function stopCurrentStream(): void {
  if (!current) return; current.controller.abort(); current.core.cancel(); current.completed = true; current.supplementDone = true; retire(current); current = undefined;
}
export function invalidateStreamOwners(): void {
  for (const [id, s] of sessions) if (!ownerValid(s)) {
    s.controller.abort(); s.core.cancel();
    document.getElementById(`bbi-preview-${id}`)?.remove(); sessions.delete(id);
  }
}

export function feedStreamText(text: string): void {
  const s = current;
  if (!s || !ownerValid(s) || !settings.autoTag.streamGen || !settings.enabled || !settings.autoTag.enabled) return;
  const all = markerSegments(text,s.stripTags);
  for (const marker of s.scanner.take(all.map(segment=>segment.marker))) {
    const ordinal = all.findIndex(item => item.marker.index === marker.index && item.marker.raw === marker.raw);
    const segment=all[ordinal];if(!segment)continue;
    const job = s.core.add({ raw: marker.raw, intent: marker.intent, text: segment.segment,
      prefix: prefixBefore(text, ordinal, 6000,s.stripTags), sourceLine: segment.sourceLine });
    if (job) log('stream:dispatch', { run: s.id, job: job.id, withoutFloor: true });
  }
}

async function completion(s: Session, messages: ChatMsg[], signal: AbortSignal, validate: (raw: string) => void, source='流式配图'): Promise<void> {
  if (s.channel) await requestCompletion(s.channel, messages, { signal, source, validate });
  else await requestViaMainApi(messages, { signal, source, validate });
}
const STREAM_ANALYSIS_SCOPE = `【当前流式任务范围】
本楼仍指整条消息；当前请求的「目标正文」仅指下方带 P 编号的段落。图片规划和首次建档检查都只处理这些目标段落中的角色。
角色卡、世界书、柏宝书、此前正文提供完整设定与连续性依据；段外出现但未进入本次目标段落的角色，不在本请求补建档，不追加 changes，也不用反复盘点其此前是否漏建档。
目标段内的正式角色即使不入画，也照原规则检查建档；固定外貌库里已列出的角色直接复用，不重复 new。本楼其他流式任务已确认的首次建档会加入该库，固定外貌本楼全程有效。临时服装、动作等仍以对应目标段落事实为准，不把后文临时状态提前套用。
一张指 images 数组的一个元素；漫画模式下是一整页漫画，不是一个画格。正文 P 编号只用于选择插入位置；漫画页内画格用主格、右上小格等空间称呼区分，不把页内格号当作正文插入位置。`;
function analysisAnchors(s: Session): ReturnType<typeof resolveCharAnchors> {
  const floor = s.binding?.floor ?? s.referenceFloor;
  const entries = charTagsBeforeFloor(floor + (s.continuing ? 1 : 0));
  const locked = lockedCharTagNames();
  // Only immutable introductions are shared. Timeline updates (outfit etc.) remain positional.
  const introduced = planChangeOps({ images: [], changes: [...s.established.values()] }).map(item => item.op);
  return resolveCharAnchors(applyCharTagOps(entries, introduced, floor, locked), locked);
}
function preparePlan(s: Session, plan: ImagePlan, anchors: ReturnType<typeof resolveCharAnchors>): ImagePlan {
  const profile = s.promptEnvironment.profile;
  if (profile.naiCharPrompts && profile.nl && plan.changes.some(change => change.field === 'new' && !change.nl?.trim())) {
    throw new Error('NAI 4.5/V5 建档必须附带 nl 外貌描述');
  }
  mergeStreamProfiles(plan, s.established);
  const ops = planChangeOps(plan), locked = lockedCharTagNames();
  for (const image of plan.images) {
    if (!profile.nl || s.profile.mode !== 'illustration') {
      image.nl = ''; for (const character of image.characters) character.nl = '';
    }
    if (s.profile.mode !== 'illustration') image.negative = '';
    if (s.profile.mode === 'comic-v1') image.characters = [];
    if (profile.lockedSize) image.size = profile.lockedSize;
    image.tag = applyPositionedCharRefs(image.tag, anchors.entries, ops, image.sourceLine, 'tag', locked).text;
    image.nl = applyPositionedCharRefs(image.nl, anchors.entries, ops, image.sourceLine, 'nl', locked).text;
    for (const character of image.characters) {
      character.tag = applyPositionedCharRefs(character.tag, anchors.entries, ops, image.sourceLine, 'tag', locked).text;
      character.nl = applyPositionedCharRefs(character.nl, anchors.entries, ops, image.sourceLine, 'nl', locked).text;
    }
  }
  return plan;
}
async function analyze(s: Session, job: Job): Promise<Payload> {
  const start = performance.now();
  if (!ownerValid(s)) throw new Error('聊天已切换');
  const target = prepareTargetText(job.input.text || job.input.intent, s.stripTags);
  const anchors = analysisAnchors(s);
  const memory = readBookMemory(s.binding?.floor ?? s.referenceFloor, job.input.prefix + job.input.text, s.context.name1);
  const prefix = contextWithoutRepeatedTarget(job.input.prefix, job.input.text);
  const note = `${STREAM_ANALYSIS_SCOPE}\n本次只分析以下剧情段，为标记「${job.input.intent}」规划恰好一张图。画面与已给定事实一致。此前正文仅作服装、道具、场景连续性依据：\n${prefix}`;
  const analysisContext = { ...getContext()!, chat: [...getContext()!.chat] };
  const analysisFloor = s.binding?.floor ?? s.referenceFloor;
  analysisContext.chat[analysisFloor] = { name: s.context.name2 || 'Assistant', is_user: false, is_system: false, mes: job.input.prefix + '\n' + job.input.text };
  const messages = await buildAutoTagMessages(analysisContext, analysisFloor,
    { ...s.options, minImages: 1, maxImages: 1 }, memory, target, anchors.text, note, s.promptEnvironment.profile, s.promptEnvironment, 'fixed-markers');
  const preparedAt = performance.now(), promptChars = messages.reduce((total, message) => total + message.content.length, 0);
  let payload: Payload | undefined;
  let error: unknown;
  for (let attempt = 0; attempt <= Math.max(0, s.options.retryCount); attempt++) {
    if (job.controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const requestStart = performance.now(); let responseChars = 0;
    try {
      await completion(s, messages, job.controller.signal, raw => {
        responseChars = raw.length;
        const plan = preparePlan(s, parseImagePlan(raw, target.segments, 1, 1), anchors);
        const image = plan.images[0];
        payload = { image: { ...image, sourceLine: image.sourceLine + job.input.sourceLine, renderProfile: s.profile },
          changes: plan.changes.map(change => ({ ...change, sourceLine: change.sourceLine + job.input.sourceLine })) };
      },'流式配图 · 单张');
      log('stream:analysis-timing', { job: job.id, queueMs: Math.round(start-job.createdAt), prepareMs: Math.round(preparedAt-start),
        apiMs: Math.round(performance.now()-requestStart), attempt: attempt+1, promptChars, responseChars, removedDuplicateChars: job.input.prefix.length-prefix.length, ok: !!payload });
      if (payload) return payload;
    } catch (e) {
      log('stream:analysis-timing', { job: job.id, queueMs: Math.round(start-job.createdAt), prepareMs: Math.round(preparedAt-start), apiMs: Math.round(performance.now()-requestStart), attempt: attempt+1, promptChars, ok: false });
      error = e; if (job.controller.signal.aborted) throw e;
    }
  }
  throw error ?? new Error('配图分析未返回有效图片');
}

async function analyzeBatch(s: Session, jobs: Job[]): Promise<Payload[]> {
  const start = performance.now();
  if (!ownerValid(s)) throw new Error('聊天已切换');
  const batch = prepareStreamBatch(jobs, s.stripTags);
  const anchors = analysisAnchors(s);
  const scanText = jobs.at(-1)!.input.prefix + '\n' + jobs.map(job => job.input.text).join('\n');
  const memory = readBookMemory(s.binding?.floor ?? s.referenceFloor, scanText, s.context.name1);
  const prefix = contextWithoutRepeatedTarget(jobs[0].input.prefix, jobs[0].input.text);
  const note = `${STREAM_ANALYSIS_SCOPE}\n${batch.instructions}\n画面与已给定事实一致。此前正文仅作服装、道具、场景连续性依据，不在此前正文另选图片：\n${prefix}`;
  const ctx = getContext()!;
  const analysisContext = { ...ctx, chat: [...ctx.chat] };
  const floor = s.binding?.floor ?? s.referenceFloor;
  analysisContext.chat[floor] = { name: s.context.name2 || 'Assistant', is_user: false, is_system: false, mes: scanText };
  const messages = await buildAutoTagMessages(analysisContext, floor, { ...s.options, minImages: jobs.length, maxImages: jobs.length },
    memory, batch.target, anchors.text, note, s.promptEnvironment.profile, s.promptEnvironment, 'fixed-markers');
  const preparedAt = performance.now(), requestStart = preparedAt;
  const controller = new AbortController();
  const cancel = () => { if (s.controller.signal.aborted || jobs.every(job => job.controller.signal.aborted)) controller.abort(); };
  s.controller.signal.addEventListener('abort', cancel);
  for (const job of jobs) job.controller.signal.addEventListener('abort', cancel);
  cancel();
  let responseChars = 0, payloads: Payload[] | undefined;
  try {
    await completion(s, messages, controller.signal, raw => {
      responseChars = raw.length;
      const parsed = parseImagePlan(raw, batch.target.segments, jobs.length, jobs.length);
      splitStreamBatch(parsed, batch); // Check ownership before mutating the shared appearance library.
      const plan = preparePlan(s, parsed, anchors);
      payloads = splitStreamBatch(plan, batch).map(image => ({ image: { ...image, renderProfile: s.profile }, changes: plan.changes }));
    },`流式配图 · 合并${jobs.length}张`);
    if (!payloads) throw new Error('批量分析未返回有效图片');
    return payloads;
  } finally {
    s.controller.signal.removeEventListener('abort', cancel);
    for (const job of jobs) job.controller.signal.removeEventListener('abort', cancel);
    log('stream:analysis-timing', { jobs: jobs.map(job => job.id), batchSize: jobs.length,
      queueMs: Math.round(Math.max(...jobs.map(job => start - job.createdAt))), prepareMs: Math.round(preparedAt - start),
      apiMs: Math.round(performance.now() - requestStart), attempt: 1, promptChars: messages.reduce((sum, message) => sum + message.content.length, 0), responseChars, ok: !!payloads });
  }
}

async function commit(s: Session, job: Job): Promise<boolean> {
  if (!s.binding || !job.payload || !ownerValid(s)) throw new Error('图片的原消息已变化，停止接管');
  const { floor, message, swipeId, expectedSwipe } = s.binding;
  const nextTag = tagFor(s, job);
  await serial(s, async () => {
    if (!ownerValid(s) || job.controller.signal.aborted) throw new Error('任务已取消');
    const ok = await applyMessageText(floor, text => {
      const tag = parseImageTags(text).find(raw => parseImageTagContent(raw).slotId === job.id);
      if (!tag || (s.written.has(job.id) && s.written.get(job.id) !== tag)) return null;
      return text.replace(tag, nextTag);
    }, s.chatId, expectedSwipe, message, undefined, { refresh: 'image-slots' });
    if (ok !== 'saved') throw new Error(`后到配图写入失败：${ok}`);
    s.written.set(job.id, nextTag);
    // Rebuild changes from every completed segment; preserve timeline updates and late arrivals.
    const seen = new Set<string>(); const changes: CharChange[] = [];
    const sorted = s.core.jobs.filter(item => item.attached && item.payload && item.phase !== 'cancelled')
      .flatMap(item => item.payload!.changes).sort((a,b) => a.sourceLine - b.sourceLine);
    for (const change of sorted) {
      const key = change.field === 'new' ? `new:${change.name}` : `${change.sourceLine}:${change.name}:${change.field}:${change.value}`;
      if (seen.has(key)) continue; seen.add(key); changes.push(change);
    }
    const locked = lockedCharTagNames();
    const ops = changes.filter(change => !locked.has(change.name)).flatMap(change => {
      const key = JSON.stringify(change);
      let op = s.changeOps.get(key);
      if (!op) { op = planChangeOps({ images: [], changes: [change] })[0]?.op; if (op) s.changeOps.set(key, op); }
      return op ? [op] : [];
    });
    if (ops.length) {
      const changed = await applyMessageText(floor, text => text, s.chatId, expectedSwipe, message,
        { key: BBI_CHAR_EXTRA_KEY, value: makeCharTagFloorDelta([...s.baselineOps, ...ops], swipeId) });
      if (changed !== 'saved') throw new Error(`角色状态保存失败：${changed}`);
      recomputeCharTags();
    }
    hydrateMessage(floor, getContext()!);
  });
  const output = job.result;
  if (!output || job.saved) return false;
  if (!ownerValid(s) || job.controller.signal.aborted) throw new Error('任务归属已变化');
  const seq = parseImageTags(getContext()!.chat[floor].mes).findIndex(raw => parseImageTagContent(raw).slotId === job.id);
  if (seq < 0) throw new Error('配图位置已被删除');
  const saveStart = performance.now();
  await saveImageResult(floor, swipeId, seq, nextTag, output.seed, output.result, output.meta,
    { slotId: job.id, signal: job.controller.signal, owner: { chatId: s.chatId, message, swipeId } });
  if (ownerValid(s)) hydrateMessage(floor, getContext()!);
  log('stream:saved', { job: job.id, floor, seq, saveMs: Math.round(performance.now() - saveStart) });
  return true;
}

export async function reconcileStreamFloor(floor: number, chatId: string): Promise<boolean> {
  if (!settings.autoTag.streamGen) return false;
  const ctx = getContext(), message = ctx?.chat[floor];
  if (!ctx || ctx.getCurrentChatId() !== chatId || !message || message.is_user) return false;
  const final = message.mes;
  const stripTags=current?.chatId===chatId?current.stripTags:[...settings.excludes.customStripTags,'bbi_image'];
  const segments = markerSegments(final,stripTags);
  if (!segments.length) { if (current && current.chatId === chatId) stopCurrentStream(); return false; }
  if (!current || current.chatId !== chatId) beginStreamSession(chatId);
  const s = current; if (!s || s.completed) return false;
  s.binding = { floor, message, swipeId: swipe(message) ?? 0, expectedSwipe: swipe(message) };
  const baseline = readCharTagFloorDelta(message);
  s.baselineOps = baseline?.swipe === s.binding.swipeId ? baseline.ops : [];
  s.body = final; s.prepared = prepareTargetText(final,s.stripTags);
  const unused = [...s.core.jobs]; const attached: Job[] = [];
  const matched = segments.map(seg => {
    const index = unused.findIndex(job => job.input.raw === seg.marker.raw && job.phase !== 'cancelled');
    return index >= 0 ? unused.splice(index, 1)[0] : undefined;
  });
  // Free the budget of markers removed or rewritten by final formatting before adding replacements.
  for (const job of unused) s.core.cancelJob(job);
  const replacements = segments.map((seg, i) => {
    let job = matched[i];
    if (!job) job = s.core.add({ raw: seg.marker.raw, intent: seg.marker.intent, text: seg.segment,
      prefix: prefixBefore(final, i, 6000,s.stripTags), sourceLine: seg.sourceLine }) ?? undefined;
    if (!job) return null;
    attached.push(job); const tag = tagFor(s, job); s.written.set(job.id, tag); return tag;
  });
  // Reserve every accepted slot before awaiting uploads or any image task.
  const ok = await serial(s, () => applyMessageText(floor, text => {
    const liveMarkers = findMarkers(text,s.stripTags);
    if (liveMarkers.length !== segments.length || liveMarkers.some((marker, i) => marker.raw !== segments[i].marker.raw)) return null;
    return replaceMarkers(text, replacements,s.stripTags);
  }, chatId, s.binding!.expectedSwipe, message));
  if (ok !== 'saved') { s.core.cancel(); toastr.warning(`流式位置写入失败：${ok}`, '柏宝绘'); return true; }
  s.completed = true; current = undefined; updatePreview(s); s.core.attach(attached); s.core.finishInput();
  hydrateMessage(floor, ctx); void ensureFloorRendered(ctx, message, floor, chatId);
  log('stream:attached', { run: s.id, floor, slots: attached.length });
  void supplement(s, attached.length + parseImageTags(final).length).catch(error => {
    if (s.controller.signal.aborted) return;
    log('stream:supplement-error', { error: String(error) }); toastr.warning('文末补图分析失败，已出图片和其它任务保留', '柏宝绘');
  }).finally(() => { s.supplementDone = true; retire(s); });
  return true;
}

async function supplement(s: Session, count: number): Promise<void> {
  const capacity = Math.max(0, s.options.maxImages - count);
  const needed = Math.max(0, s.options.minImages - count);
  if (!capacity || !s.prepared || !s.body || !s.binding || !ownerValid(s)) return;
  const segments = markerSegments(s.body,s.stripTags), tail = maskStreamStorySource(s.body,s.stripTags).slice(segments.at(-1)?.marker.end ?? 0);
  const longGap = tail.length > 1200 || segments.some(segment => segment.segment.length > 1200);
  if (!needed && !longGap) return;
  // A separate completion here used to bypass the configured analysis concurrency and
  // rebuild profiles while streamed requests were still running. NAI stays independent.
  await s.core.analysisSettled();
  if (s.controller.signal.aborted || !ownerValid(s)) return;
  const full = s.prepared;
  // Prefer uncovered tail/long spans. If count is below min, all narrative may supply a distinct missing moment.
  const tailStart = s.body.slice(0, segments.at(-1)?.marker.end ?? 0).split('\n').length - 1;
  const starts = [0]; for (let i = 0; i < s.body.length; i++) if (s.body[i] === '\n') starts.push(i + 1);
  const gaps = segments.flatMap((segment, i) => segment.segment.length > 1200
    ? [{ start: i ? segments[i-1].marker.end : 0, end: Math.max(0, segment.marker.index - 600) }] : []);
  const candidates = needed ? full.segments : full.segments.filter(segment =>
    (tail.length > 1200 && segment.sourceLine >= tailStart) || gaps.some(gap => starts[segment.sourceLine] >= gap.start && starts[segment.sourceLine] < gap.end));
  if (!candidates.length) return;
  const target = { segments: candidates, promptText: candidates.map(segment => `${segment.text} ⟦${segment.id}⟧`).join('\n\n') };
  const priorImages = parseImageTags(s.body).map(raw => parseImageTagContent(raw).tag.slice(0, 300)).join('；');
  const note = `文末补充配图：已接受 ${count} 张，最多补 ${capacity} 张，至少补 ${needed} 张。已有画面意图：${s.core.jobs.map(job=>job.input.intent).join('；')}。本楼此前已有图片：${priorImages || '无'}。已有图片与任务全部保留，只选尚未覆盖的视觉事件，不为同一画面重复出图。`;
  const controller = s.controller;
  let plan: ReturnType<typeof parseImagePlan> | undefined;
  let lastError: unknown;
  await s.core.additionalAnalysis(async () => {
    if (controller.signal.aborted || !ownerValid(s)) return;
    const entries = charTagsBeforeFloor(s.binding!.floor + 1), known = new Set(entries.map(entry => entry.name));
    const missingIntroductions = planChangeOps({ images: [], changes: [...s.established.values()].filter(change => !known.has(change.name)) }).map(item => item.op);
    const anchors = resolveCharAnchors(applyCharTagOps(entries, missingIntroductions, s.binding!.floor, lockedCharTagNames()), lockedCharTagNames());
    const messages = await buildAutoTagMessages(s.context, s.binding!.floor, { ...s.options, minImages: needed, maxImages: capacity },
      readBookMemory(s.binding!.floor, s.body!, s.context.name1), target, anchors.text, note, s.promptEnvironment.profile, s.promptEnvironment);
    for (let attempt = 0; attempt <= Math.max(0, s.options.retryCount); attempt++) {
      if (controller.signal.aborted) return;
      try {
        await completion(s, messages, controller.signal, raw => { plan = preparePlan(s, parseImagePlan(raw, target.segments, needed, capacity), anchors); },'流式配图 · 文末补充');
        if (plan) break;
      } catch (error) { lastError = error; }
    }
  });
  if (!plan) throw lastError ?? new Error('补图分析未返回有效结果');
  if (!plan?.images.length || !ownerValid(s)) return;
  const added = plan.images.map(image => s.core.add({ raw: '', intent: '文末补充画面', text: '', prefix: '', sourceLine: image.sourceLine },
    { image: { ...image, renderProfile: s.profile }, changes: plan!.changes })).filter((job): job is Job => !!job);
  for (const job of added) job.payload!.image.slotId = job.id;
  const ok = await serial(s, () => applyMessageText(s.binding!.floor, text => {
    const rebased = rebaseImagePositions(text, full.segments, added.map(job=>job.payload!.image), s.stripTags);
    return rebased ? injectImageTags(text, rebased.images.map(image => ({ ...image, renderProfile: s.profile }))) : null;
  }, s.chatId, s.binding!.expectedSwipe, s.binding!.message));
  if (ok !== 'saved') { for (const job of added) s.core.cancelJob(job); throw new Error(`补图位置写入失败：${ok}`); }
  for (const job of added) s.written.set(job.id, tagFor(s, job));
  s.core.attach(added); hydrateMessage(s.binding.floor, getContext()!);
  void ensureFloorRendered(getContext()!, s.binding.message, s.binding.floor, s.chatId);
  log('stream:supplement', { added: added.length, total: count + added.length });
}

/** The preview belongs to prose streaming; inline slots take over once the floor is attached. */
export function refreshStreamPreviews(): void {
  for (const s of sessions.values()) updatePreview(s);
}
function updatePreview(s: Session): void {
  const id = `bbi-preview-${s.id}`;
  let host = document.getElementById(id);
  if (!settings.enabled || !settings.autoTag.enabled || !settings.autoTag.streamGen ||
    !settings.autoTag.streamPreview || s.completed || !ownerValid(s)) { host?.remove(); return; }
  const jobs = s.core.jobs.filter(job => job.result && !job.attached && !job.saved && job.phase !== 'cancelled');
  if (!jobs.length) { host?.remove(); return; }
  if (!host) {
    host = document.createElement('div'); host.id = id;
    host.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;gap:6px;max-width:90vw;padding:6px;background:rgba(0,0,0,.55);border-radius:8px;pointer-events:none';
    document.body.appendChild(host);
  }
  host.replaceChildren();
  for (const job of jobs) {
    const img = document.createElement('img'); img.src = job.result!.result.url; img.alt = `第 ${job.ordinal + 1} 张配图`;
    img.style.cssText = 'width:72px;height:96px;object-fit:cover;border-radius:4px'; host.appendChild(img);
  }
}
