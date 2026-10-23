import { compactComicSpec, compactLibrary, completeComicPages, compileComicPage, parseCompactComic, type CompactComicContext } from '@/autoTag/compactComic';
import { ComicContinuityLedger } from '@/autoTag/comicContinuity';
import { ComicWardrobeLedger } from '@/comic/characters';
import { finalizeComicPlan } from '@/comic/plan';
import { standardPagePrefix } from './standardPages';
import { StreamInlinePreview, inlineStoryText, type InlinePreviewSnapshot } from '@/autoTag/streamInlinePreview';
import { openLightbox } from '@/floor/lightbox';
import { comicReasoningKey, comicReasoningOverride } from '@/api/comicReasoning';
import type { CharTagEntry } from '@/state/charTags';
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
import { STREAM_SCENE_SUBJECT_RULE } from '@/autoTag/sceneRules';
import { mergeStreamProfiles } from '@/autoTag/streamProfiles';
import { registerStreamActions, updateStreamSlot, forgetStreamSlot } from '@/autoTag/streamState';
import { planChangeOps } from '@/autoTag/changeOps';
import { charTagsBeforeFloor, lockedCharTagNames, makeCharTagFloorDelta, readCharTagFloorDelta, recomputeCharTags, applyCharTagOps, BBI_CHAR_EXTRA_KEY, type CharTagAutoOp } from '@/state/charTags';
import { settings, getTagGenChannel, isCurrentChatExcluded, imageDisplayMaxHeight, type AutoTagSettings } from '@/state/settings';
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
  continuity: ComicContinuityLedger; seedEntries: CharTagEntry[];
  wardrobe: ComicWardrobeLedger;
  scanner: MarkerScanner; core: StreamRun<Payload, GenerateOutput>;
  options: AutoTagSettings; generation: GenerationSnapshot; profile: RenderProfile;
  stripTags: string[];
  promptEnvironment: AutoTagEnvironment; existingCount: number; continuing: boolean; baselineOps: CharTagAutoOp[]; channel: ReturnType<typeof getTagGenChannel>; body?: string; prepared?: PreparedTargetText;
  binding?: { floor: number; message: STMessage; swipeId: number; expectedSwipe: number | null };
  inline?: StreamInlinePreview;
  inlineOwner?: { processor: NonNullable<STContext['streamingProcessor']>; floor: number; message: STMessage; swipe: number | null };
  inlineDiagnostic?: string;
  controller: AbortController; chain: Promise<void>; written: Map<string, string>; established: Map<string, CharChange>; changeOps: Map<string, CharTagAutoOp>; completed: boolean; supplementDone: boolean;
}
const sessions = new Map<string, Session>();
// Output metadata is excluded from scene discovery without editing the user's message.
const STREAM_NON_STORY_TAGS = ['summary', 'action', 'UpdateVariable', 'JSONPatch', 'Analysis', 'statusplaceholder', 'CONTEXT_options', 'CONTEXT_conception', 'thought'];
let current: Session | undefined;
const log = (event: string, detail: unknown) => console.info(`[BBI][AutoTagDebug] ${event}`, JSON.stringify(detail));
const swipe = (message: STMessage) => Array.isArray(message.swipes) ? (message.swipe_id ?? 0) : null;
const jsonCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function ownerValid(s: Session): boolean {
  const ctx = getContext();
  if (!ctx || ctx.getCurrentChatId() !== s.chatId) return false;
  if (!s.binding) {
    const owner=s.inlineOwner;
    return !owner || (!!ctx.chat[owner.floor]&&isSameMessage(ctx.chat[owner.floor],owner.message)&&swipe(ctx.chat[owner.floor])===owner.swipe&&(!ctx.streamingProcessor||ctx.streamingProcessor===owner.processor));
  }
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
    disposeInlinePreview(current);
    document.getElementById(`bbi-preview-${current.id}`)?.remove(); sessions.delete(current.id);
  }
  current = undefined;
  if (!ctx || !settings.enabled || !settings.autoTag.enabled || !settings.autoTag.streamGen || isCurrentChatExcluded()) return;
  const state: Omit<Session, 'core'> = {
    id: `sr_${randomUuid().replace(/-/g, '')}`, chatId, context: ctx, referenceFloor: ctx.chat.at(-1)?.is_user ? ctx.chat.length : Math.max(0, ctx.chat.length - 1),
    continuity: new ComicContinuityLedger(), seedEntries: jsonCopy(charTagsBeforeFloor((ctx.chat.at(-1)?.is_user ? ctx.chat.length : Math.max(0,ctx.chat.length-1)) + (type === 'continue' ? 1 : 0))),
    scanner: new MarkerScanner(), options: jsonCopy(settings.autoTag),
    stripTags: [...settings.excludes.customStripTags,'bbi_image',...STREAM_NON_STORY_TAGS],
    generation: captureGenerationSnapshot(), profile: captureRenderProfile(settings.nai, settings.defaultBackend),
    promptEnvironment: captureAutoTagEnvironment(), existingCount: type === 'continue' ? parseImageTags(ctx.chat.at(-1)?.mes ?? '').length : 0,
    continuing: type === 'continue', baselineOps: [], wardrobe:new ComicWardrobeLedger(),
    channel: getTagGenChannel() ? jsonCopy(getTagGenChannel()) : null,
    controller: new AbortController(), chain: Promise.resolve(), written: new Map(), established: new Map(), changeOps: new Map(), completed: false, supplementDone: false,
  };
  const core = new StreamRun<Payload, GenerateOutput>(state.id, Math.max(0, state.options.maxImages - state.existingCount), Math.min(4, Math.max(1, state.options.streamAnalysisConcurrency ?? 2)),
    state.options.autoGenerate, {
      analyze: job => analyze(s, job),
      analyzeBatch: (jobs,ready) => analyzeBatch(s, jobs,ready),
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
    }, state.options.streamAnalysisBatchSize);
  const s: Session = { ...state, core };
  sessions.set(s.id, s); current = s; log('stream:begin', { run: s.id, chatId, minImages: state.options.minImages,
    maxImages: state.options.maxImages, batchSize: core.batchSize, batchSizes: streamBatchSizes(core.max, core.batchSize), analysisConcurrency: core.concurrency,
    inlinePreview: !!state.options.streamInlinePreview, floatingPreview: !!state.options.streamPreview,
    analysisMode: s.profile.mode === 'illustration' ? 'standard' : s.promptEnvironment.nai.comicAnalysisMode ?? 'standard' });
}

/** Cancel only runs belonging to a chat that is no longer active. */
export function cancelStreamSessions(keepChatId?: string): void {
  for (const [id, s] of sessions) {
    if (keepChatId && s.chatId === keepChatId) continue;
    s.controller.abort(); s.core.cancel(); for (const job of s.core.jobs) forgetStreamSlot(job.id);
    disposeInlinePreview(s);
    document.getElementById(`bbi-preview-${id}`)?.remove(); sessions.delete(id);
    if (current === s) current = undefined;
  }
}
export function stopCurrentStream(): void {
  if (!current) return; current.controller.abort(); current.core.cancel(); disposeInlinePreview(current); current.completed = true; current.supplementDone = true; retire(current); current = undefined;
}
export function invalidateStreamOwners(): void {
  for (const [id, s] of sessions) if (!ownerValid(s)) {
    s.controller.abort(); s.core.cancel();
    disposeInlinePreview(s);
    document.getElementById(`bbi-preview-${id}`)?.remove(); sessions.delete(id);
  } else s.inline?.refresh();
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
  updateInlinePreview(s);
}

async function completion(s: Session, messages: ChatMsg[], signal: AbortSignal, validate: (raw: string) => void, source='流式配图', onContent?: (raw:string)=>void): Promise<void> {
  const mode=s.profile.mode!=='illustration'?s.promptEnvironment.nai.comicReasoningByModel?.[comicReasoningKey(s.channel,s.promptEnvironment.nai.comicAnalysisMode??'standard')]??'follow':'follow';
  const reasoningOverride=comicReasoningOverride(s.channel,mode);
  if (s.channel) await requestCompletion(s.channel, messages, { signal, source, validate,
    ...(fastComicAnalysis(s)?{stream:true}:{}),
    ...(onContent?{stream:true,onContent}:{}),
    ...(reasoningOverride?{reasoningOverride}:{}),
  });
  else await requestViaMainApi(messages, { signal, source, validate });
}
const STREAM_ANALYSIS_SCOPE = `【当前流式任务范围】
本楼仍指整条消息；当前请求的「目标正文」仅指下方带 P 编号的段落。图片规划和首次建档检查都只处理这些目标段落中的角色。
角色卡、世界书、柏宝书、此前正文提供完整设定与连续性依据；段外出现但未进入本次目标段落的角色，不在本请求补建档，不追加 changes，也不用反复盘点其此前是否漏建档。
目标段内的正式角色即使不入画，也照原规则检查建档；固定外貌库里已列出的角色直接复用，不重复 new。本楼其他流式任务已确认的首次建档会加入该库，固定外貌本楼全程有效。临时服装、动作等仍以对应目标段落事实为准，不把后文临时状态提前套用。
一张指 images 数组的一个元素；漫画模式下是一整页漫画，不是一个画格。图片 position 照抄任务给出的 M 编号,插入点由插件处理;正文 P 编号只用于角色变化时序与必要的 statePosition。漫画页内画格用主格、右上小格等空间称呼区分。`;
function simpleComicAnalysis(s: Session): boolean {
  return s.profile.mode !== 'illustration' && ['simple','fast'].includes(s.promptEnvironment.nai?.comicAnalysisMode ?? 'standard');
}
function fastComicAnalysis(s: Session): boolean {
  return s.profile.mode !== 'illustration' && s.promptEnvironment.nai?.comicAnalysisMode === 'fast';
}
function analysisScope(s: Session): string {
  const scope = simpleComicAnalysis(s)
    ? '【当前流式任务范围】目标正文仅指本批带P编号的段落；只为这些段落选图和检查角色建档。角色卡、世界书、记忆与此前正文仅作参考。已建档角色直接复用，段外角色不补建档，不把后文状态提前套用。一张图是一整页漫画。'
    : STREAM_ANALYSIS_SCOPE;
  return `${scope}\n${STREAM_SCENE_SUBJECT_RULE}`;
}
function analysisAnchors(s: Session): ReturnType<typeof resolveCharAnchors> {
  const floor = s.binding?.floor ?? s.referenceFloor;
  const entries = fastComicAnalysis(s) ? s.seedEntries : charTagsBeforeFloor(floor + (s.continuing ? 1 : 0));
  const locked = lockedCharTagNames();
  // Only immutable introductions are shared. Timeline updates (outfit etc.) remain positional.
  const introduced = planChangeOps({ images: [], changes: [...s.established.values()] }).map(item => item.op);
  return resolveCharAnchors(applyCharTagOps(entries, introduced, floor, locked), locked,s.profile.mode!=='illustration');
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
  // Fast pages already pass the same character finalizer inside compilation.
  // Re-running after metadata was consumed could restore an old default outfit.
  if(s.profile.mode!=='illustration'&&!fastComicAnalysis(s))finalizeComicPlan(plan,anchors.entries,s.wardrobe,locked);
  return plan;
}
async function analyzeCompact(s: Session, jobs: Job[], ready?: (index:number,payload:Payload)=>void): Promise<Payload[]> {
  if (!ownerValid(s)) throw new Error('聊天已切换');
  const started=performance.now(), batch=prepareStreamBatch(jobs,s.stripTags,true), anchors=analysisAnchors(s);
  const originalPrefix=contextWithoutRepeatedTarget(jobs[0].input.prefix,jobs[0].input.text);
  const continuity=s.continuity.context(jobs[0].ordinal,originalPrefix);
  const entries=anchors.entries.map(entry=>({...entry,fields:{...entry.fields}}));
  for(const change of [...continuity.changes].sort((a,b)=>a.sourceLine-b.sourceLine)) {
    const entry=entries.find(entry=>entry.name===change.name);
    if(entry&&!lockedCharTagNames().has(change.name)&&Object.hasOwn(entry.fields,change.field)) entry.fields[change.field as keyof typeof entry.fields]=change.value;
  }
  const compact:CompactComicContext={target:batch.target,markers:batch.markerTargets,entries,locked:lockedCharTagNames(),nai:s.promptEnvironment.nai,
    size:s.promptEnvironment.profile.lockedSize,min:jobs.length,max:jobs.length,priorChanges:continuity.changes,outfits:{...continuity.outfits,...s.wardrobe.before(jobs[0].input.sourceLine)}};
  const scanText=jobs.at(-1)!.input.prefix+'\n'+jobs.map(job=>job.input.text).join('\n');
  const ctx=getContext()!,floor=s.binding?.floor??s.referenceFloor,analysisContext={...ctx,chat:[...ctx.chat]};
  analysisContext.chat[floor]={name:s.context.name2||'Assistant',is_user:false,is_system:false,mes:scanText};
  const note='极速模式仅输出简短分镜。只为下列标记生成pages，id照抄M编号，按M编号顺序输出。\n'+STREAM_SCENE_SUBJECT_RULE+'\n'+batch.groups.map(g=>
    '标记 '+g.markerId+'：'+g.intent+'；对应正文 '+g.positions.join('、')+'；图片 position 固定填 "'+g.markerId+'"。').join('\n')+
    '\n'+continuity.note+'\n此前尚未概括的正文，仅作连续性依据：\n'+continuity.prefix+
    (jobs.length===1&&jobs[0].analysisError?'\n【当前页修复】上次校验未通过：'+jobs[0].analysisError+'。只修复当前页；以前批次编号不沿用，本次以当前给定M编号和P位置为准。':'');
  const messages=await buildAutoTagMessages(analysisContext,floor,{...s.options,minImages:jobs.length,maxImages:jobs.length},
    readBookMemory(floor,scanText,s.context.name1),batch.target,compactLibrary(compact),note,s.promptEnvironment.profile,s.promptEnvironment,'fixed-markers',compactComicSpec(compact));
  const controller=new AbortController(),cancel=()=>{if(s.controller.signal.aborted||jobs.every(job=>job.controller.signal.aborted))controller.abort();};
  s.controller.signal.addEventListener('abort',cancel);for(const job of jobs)job.controller.signal.addEventListener('abort',cancel);cancel();
  const payloads=new Map<string,Payload>(),introduced:CharTagEntry[]=[],acceptedChanges:CharChange[]=[],errors=new Map<string,string>();
  let responseChars=0,scannedLength=0;
  const consume=(raw:string)=>{
    responseChars=raw.length;
    const appended=raw.slice(scannedLength),reset=raw.length<scannedLength;scannedLength=raw.length;
    if(!reset&&!appended.includes('}'))return;
    const pages=completeComicPages(raw);
    const byId=new Map<string,unknown>();
    for(const value of pages) if(value&&typeof value==='object'&&typeof (value as any).id==='string') {
      const id=(value as any).id; if(!byId.has(id))byId.set(id,value);
    }
    for(let index=0;index<jobs.length;index++){
      const job=jobs[index],id=batch.groups[index].markerId;
      if(payloads.has(id)||job.controller.signal.aborted)continue;
      const page=byId.get(id); if(!page)break;
      try{
        // A parallel batch may have established this new person's identity since dispatch.
        // Recompile from canonical fields before producing either V1 or V2 strings.
        const candidate=jsonCopy(page) as Record<string,any>;
        if(Array.isArray(candidate.profiles)) for(const profile of candidate.profiles){
          const canonical=s.established.get(profile?.name);
          if(canonical&&!compact.entries.some(entry=>entry.name===profile.name)) {
            try{profile.fields=JSON.parse(canonical.value);}catch{/* compiler reports malformed fields */}
          }
        }
        const result=compileComicPage(candidate,{...compact,priorChanges:[...continuity.changes,...acceptedChanges]},introduced);
        if(controller.signal.aborted||job.controller.signal.aborted||!ownerValid(s))return;
        const plan=preparePlan(s,result.plan,anchors),payload={image:{...plan.images[0],renderProfile:s.profile},changes:plan.changes};
        payloads.set(id,payload);errors.delete(id);job.analysisError=undefined;acceptedChanges.push(...plan.changes);
        compact.outfits={...compact.outfits,...result.wardrobe};
        s.wardrobe.accept(plan.images[0].sourceLine,result.wardrobe);
        const introOps=planChangeOps({images:[],changes:plan.changes.filter(change=>change.field==='new')}).map(item=>item.op);
        introduced.splice(0,introduced.length,...applyCharTagOps(introduced,introOps,floor,compact.locked));
        s.continuity.accept({ordinal:job.ordinal,text:job.input.text,marker:job.input.raw,sourceLine:batch.target.segments.find(segment=>segment.id===batch.groups[index].positions.at(-1))!.sourceLine,state:result.state,changes:plan.changes});
        ready?.(index,payload);
        log('stream:page-ready',{job:job.id,batchSize:jobs.length,elapsedMs:Math.round(performance.now()-started)});
      }catch(error){errors.set(id,error instanceof Error?error.message:String(error));break;}
    }
  };
  const validate=(raw:string)=>{
    consume(raw);
    const missing=jobs.flatMap((job,index)=>job.controller.signal.aborted||payloads.has(batch.groups[index].markerId)?[]:[batch.groups[index].markerId]);
    for(let index=0;index<jobs.length;index++)if(missing.includes(batch.groups[index].markerId))jobs[index].analysisError=errors.get(batch.groups[index].markerId)||'缺少完整页数据，或前页校验失败而尚未接受';
    if(missing.length)throw new Error('漫画页校验失败：'+missing.map(id=>id+' '+(errors.get(id)||'缺少完整数据')).join('；'));
  };
  try{
    const source='流式配图 · '+(jobs.length===1?'单张':'合并'+jobs.length+'张');
    if(s.channel){
      const mode=s.promptEnvironment.nai.comicReasoningByModel?.[comicReasoningKey(s.channel)]??'follow';
      await requestCompletion(s.channel,messages,{signal:controller.signal,source,stream:true,onContent:consume,validate,reasoningOverride:comicReasoningOverride(s.channel,mode)});
    }else await requestViaMainApi(messages,{signal:controller.signal,source,validate});
    return batch.groups.map(group=>payloads.get(group.markerId)!);
  }finally{
    s.controller.signal.removeEventListener('abort',cancel);for(const job of jobs)job.controller.signal.removeEventListener('abort',cancel);
    log('stream:analysis-timing',{jobs:jobs.map(job=>job.id),batchSize:jobs.length,apiMs:Math.round(performance.now()-started),responseChars,
      promptChars:messages.reduce((sum,m)=>sum+m.content.length,0),reusedContextChars:Math.max(0,originalPrefix.length-continuity.prefix.length),acceptedPages:payloads.size,ok:payloads.size===jobs.length});
  }
}

async function analyze(s: Session, job: Job): Promise<Payload> {
  if(fastComicAnalysis(s)){
    let last:unknown;for(let attempt=0;attempt<=Math.max(0,s.options.retryCount);attempt++){
      try{return (await analyzeCompact(s,[job]))[0];}catch(error){last=error;if(job.controller.signal.aborted)throw error;}
    }throw last;
  }
  const start = performance.now();
  if (!ownerValid(s)) throw new Error('聊天已切换');
  const batch = prepareStreamBatch([job], s.stripTags, simpleComicAnalysis(s)), target = batch.target;
  const anchors = analysisAnchors(s);
  const memory = readBookMemory(s.binding?.floor ?? s.referenceFloor, job.input.prefix + job.input.text, s.context.name1);
  const prefix = contextWithoutRepeatedTarget(job.input.prefix, job.input.text);
  const note = `${analysisScope(s)}\n${batch.instructions}\n画面与已给定事实一致。此前正文仅作服装、道具、场景连续性依据：\n${prefix}`;
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
        const parsed = parseImagePlan(raw, target.segments, 1, 1, batch.markerTargets);
        splitStreamBatch(parsed, batch);
        const plan = preparePlan(s, parsed, anchors);
        const image = plan.images[0];
        payload = { image: { ...image, renderProfile: s.profile }, changes: plan.changes };
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

async function analyzeBatch(s: Session, jobs: Job[], ready?: (index:number,payload:Payload)=>void): Promise<Payload[]> {
  if(fastComicAnalysis(s))return analyzeCompact(s,jobs,ready);
  const start = performance.now();
  if (!ownerValid(s)) throw new Error('聊天已切换');
  const batch = prepareStreamBatch(jobs, s.stripTags, simpleComicAnalysis(s));
  const anchors = analysisAnchors(s);
  const scanText = jobs.at(-1)!.input.prefix + '\n' + jobs.map(job => job.input.text).join('\n');
  const memory = readBookMemory(s.binding?.floor ?? s.referenceFloor, scanText, s.context.name1);
  const prefix = contextWithoutRepeatedTarget(jobs[0].input.prefix, jobs[0].input.text);
  const progressive=!!s.channel&&s.profile.mode!=='illustration'&&s.promptEnvironment.nai.comicProgressivePages===true;
  const batchInstructions=progressive?batch.instructions.replace('输出顺序不限。',''):batch.instructions;
  const note = `${analysisScope(s)}\n${batchInstructions}${progressive?'\n仅调整返回顺序：先完整输出changes，再输出images；images按本批M编号先后写，每页写完不回改。输出字段、画面要求不变。':''}\n画面与已给定事实一致。此前正文仅作服装、道具、场景连续性依据，不在此前正文另选图片：\n${prefix}`;
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
  const accepted=new Map<number,Payload>(),fingerprints=new Map<number,string>();let changesFingerprint:string|undefined,scannedLength=0;
  const consume=(raw:string)=>{
    responseChars=raw.length;
    const appended=raw.slice(scannedLength),reset=raw.length<scannedLength;scannedLength=raw.length;
    if(!reset&&!appended.includes('}'))return;
    const part=standardPagePrefix(raw);if(!part||controller.signal.aborted||!ownerValid(s))return;
    const byId=new Map<string,unknown>(),duplicates=new Set<string>();
    for(const value of part.images)if(value&&typeof value==='object'){
      const id=String((value as any).position??(value as any).id??'').trim().toUpperCase();
      if(byId.has(id))duplicates.add(id);byId.set(id,value);
    }
    for(let index=0;index<jobs.length;index++){
      const job=jobs[index],id=batch.groups[index].markerId;
      if(job.controller.signal.aborted||accepted.has(index))continue;
      if(!byId.has(id)||duplicates.has(id))break;
      try{
        const parsed=parseImagePlan(JSON.stringify({changes:part.changes,images:[byId.get(id)]}),batch.target.segments,1,1,batch.markerTargets);
        if(!batch.groups[index].positions.includes(parsed.images[0].position))throw new Error('逐页返回错配标记');
        const fingerprint=JSON.stringify(parsed.images[0]),changes=JSON.stringify(parsed.changes);
        if(changesFingerprint!==undefined&&changesFingerprint!==changes)throw new Error('逐页返回修改了已确认的角色变化');
        const plan=preparePlan(s,parsed,anchors),payload={image:{...plan.images[0],renderProfile:s.profile},changes:plan.changes};
        accepted.set(index,payload);fingerprints.set(index,fingerprint);changesFingerprint=changes;
        job.analysisError=undefined;ready?.(index,payload);
        log('stream:page-ready',{job:job.id,batchSize:jobs.length,elapsedMs:Math.round(performance.now()-requestStart)});
      }catch(error){job.analysisError=error instanceof Error?error.message:String(error);break;}
    }
  };
  try {
    await completion(s, messages, controller.signal, raw => {
      if(controller.signal.aborted||!ownerValid(s))throw new DOMException('Cancelled','AbortError');
      responseChars = raw.length;
      const parsed = parseImagePlan(raw, batch.target.segments, jobs.length, jobs.length, batch.markerTargets);
      const ordered=splitStreamBatch(parsed, batch); // Check ownership before mutating the shared appearance library.
      if(progressive){
        const part=standardPagePrefix(raw);
        if(part){
          const ids=part.images.map((im:any)=>String(im?.position??im?.id??'').trim().toUpperCase());
          if(new Set(ids).size!==ids.length||part.images.length!==jobs.length)throw new Error('逐页返回重复或遗漏了标记');
        }
        if(accepted.size){
          if(changesFingerprint!==JSON.stringify(parsed.changes)||[...fingerprints].some(([index,value])=>value!==JSON.stringify(ordered[index])))throw new Error('最终返回修改了已开始出图的页');
        }
        if(part)consume(raw);
        if(accepted.size){
          if(jobs.some((job,index)=>!job.controller.signal.aborted&&!accepted.has(index)))throw new Error('部分漫画页未通过检查');
          payloads=jobs.map((_,index)=>accepted.get(index)!);return;
        }
      }
      const plan = preparePlan(s, parsed, anchors);
      payloads = splitStreamBatch(plan, batch).map(image => ({ image: { ...image, renderProfile: s.profile }, changes: plan.changes }));
    },`流式配图 · 合并${jobs.length}张`,progressive?consume:undefined);
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
  const stripTags=current?.chatId===chatId?current.stripTags:[...settings.excludes.customStripTags,'bbi_image',...STREAM_NON_STORY_TAGS];
  const segments = markerSegments(final,stripTags);
  if (!segments.length) { if (current && current.chatId === chatId) stopCurrentStream(); return false; }
  if (!current || current.chatId !== chatId) beginStreamSession(chatId);
  const s = current; if (!s || s.completed) return false;
  s.binding = { floor, message, swipeId: swipe(message) ?? 0, expectedSwipe: swipe(message) };
  const baseline = readCharTagFloorDelta(message);
  s.baselineOps = baseline?.swipe === s.binding.swipeId ? baseline.ops : [];
  s.body = final; s.prepared = prepareTargetText(maskStreamStorySource(final,s.stripTags),s.stripTags);
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
  const finishInline=s.inline?.beginHandoff();
  const ok = await serial(s, () => applyMessageText(floor, text => {
    const liveMarkers = findMarkers(text,s.stripTags);
    if (liveMarkers.length !== segments.length || liveMarkers.some((marker, i) => marker.raw !== segments[i].marker.raw)) return null;
    return replaceMarkers(text, replacements,s.stripTags);
  }, chatId, s.binding!.expectedSwipe, message)).catch(error=>{disposeInlinePreview(s);finishInline?.();throw error;});
  if (ok !== 'saved') { disposeInlinePreview(s);finishInline?.();s.core.cancel(); toastr.warning(`流式位置写入失败：${ok}`, '柏宝绘'); return true; }
  s.completed = true; current = undefined; updatePreview(s); s.core.attach(attached); s.core.finishInput();
  hydrateMessage(floor, ctx);finishInline?.(); void ensureFloorRendered(ctx, message, floor, chatId);
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
  if (!needed && !s.options.streamGapSupplement) return;
  const visibleLength = (text: string) => text.replace(/\s/g, '').length;
  const segments = markerSegments(s.body,s.stripTags), tail = maskStreamStorySource(s.body,s.stripTags).slice(segments.at(-1)?.marker.end ?? 0);
  const longTail = visibleLength(tail) > 1200;
  const longGap = s.options.streamGapSupplement && (longTail || segments.some(segment => visibleLength(segment.segment) > 1200));
  if (!needed && !longGap) return;
  const maximum = s.options.streamGapSupplement ? capacity : needed;
  // A separate completion here used to bypass the configured analysis concurrency and
  // rebuild profiles while streamed requests were still running. NAI stays independent.
  await s.core.analysisSettled();
  if (s.controller.signal.aborted || !ownerValid(s)) return;
  const full = s.prepared;
  // Prefer uncovered tail/long spans. If count is below min, all narrative may supply a distinct missing moment.
  const tailStart = s.body.slice(0, segments.at(-1)?.marker.end ?? 0).split('\n').length - 1;
  const starts = [0]; for (let i = 0; i < s.body.length; i++) if (s.body[i] === '\n') starts.push(i + 1);
  const gaps = segments.flatMap((segment, i) => visibleLength(segment.segment) > 1200
    ? [{ start: i ? segments[i-1].marker.end : 0, end: Math.max(0, segment.marker.index - 600) }] : []);
  const candidates = needed ? full.segments : full.segments.filter(segment =>
    (longTail && segment.sourceLine >= tailStart) || gaps.some(gap => starts[segment.sourceLine] >= gap.start && starts[segment.sourceLine] < gap.end));
  if (!candidates.length) return;
  const target = { segments: candidates, promptText: candidates.map(segment => `${segment.text} ⟦${segment.id}⟧`).join('\n\n') };
  const priorImages = parseImageTags(s.body).map(raw => parseImageTagContent(raw).tag.slice(0, 300)).join('；');
  const note = `文末补充配图：已接受 ${count} 张，最多补 ${maximum} 张，至少补 ${needed} 张。${STREAM_SCENE_SUBJECT_RULE}已有画面意图：${s.core.jobs.map(job=>job.input.intent).join('；')}。本楼此前已有图片：${priorImages || '无'}。已有图片与任务全部保留，只选尚未覆盖的视觉事件，不为同一画面重复出图。目标只含正式正文,不从摘要、行动选项或变量更新中选图。`;
  const controller = s.controller;
  let plan: ReturnType<typeof parseImagePlan> | undefined;
  let lastError: unknown;
  await s.core.additionalAnalysis(async () => {
    if (controller.signal.aborted || !ownerValid(s)) return;
    const entries = charTagsBeforeFloor(s.binding!.floor + 1), known = new Set(entries.map(entry => entry.name));
    const missingIntroductions = planChangeOps({ images: [], changes: [...s.established.values()].filter(change => !known.has(change.name)) }).map(item => item.op);
    const anchors = resolveCharAnchors(applyCharTagOps(entries, missingIntroductions, s.binding!.floor, lockedCharTagNames()), lockedCharTagNames(),s.profile.mode!=='illustration');
    const compact:CompactComicContext|undefined = fastComicAnalysis(s) ? {target,entries:anchors.entries,locked:lockedCharTagNames(),nai:s.promptEnvironment.nai,size:s.promptEnvironment.profile.lockedSize,min:needed,max:maximum}:undefined;
    const messages = await buildAutoTagMessages(s.context, s.binding!.floor, { ...s.options, minImages: needed, maxImages: maximum },
      readBookMemory(s.binding!.floor, s.body!, s.context.name1), target, compact ? compactLibrary(compact) : anchors.text, note, s.promptEnvironment.profile, s.promptEnvironment,'select-scenes',compact ? compactComicSpec(compact) : undefined);
    for (let attempt = 0; attempt <= Math.max(0, s.options.retryCount); attempt++) {
      if (controller.signal.aborted) return;
      try {
        await completion(s, messages, controller.signal, raw => { plan = preparePlan(s, compact ? parseCompactComic(raw,compact) : parseImagePlan(raw, target.segments, needed, maximum), anchors); },'流式配图 · 文末补充');
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
  updateInlinePreview(s);
  updateFloatingPreview(s);
}
function disposeInlinePreview(s:Session):void{const inline=s.inline;s.inline=undefined;inline?.dispose();}
function inlineDiagnostic(s:Session,reason:string,detail:Record<string,number>={}){
  if(s.inlineDiagnostic===reason)return;s.inlineDiagnostic=reason;
  log('stream:inline-preview',{run:s.id,reason,...detail});
}
/** Host cleanup may normalize whitespace or presentation markup. Check all of
 * the story words; an earlier prefix is allowed for continued replies.
 */
function sameInlineStorySegment(current:string,expected:string):boolean{
  const normalized=inlineStoryText(expected);
  return !!normalized&&inlineStoryText(current).endsWith(normalized);
}
function inlineSnapshot(s:Session):InlinePreviewSnapshot|null{
  if(s.completed||s.controller.signal.aborted||!settings.enabled||!settings.autoTag.enabled||!settings.autoTag.streamGen||!settings.autoTag.streamInlinePreview||!ownerValid(s))return null;
  const ctx=getContext(),processor=ctx?.streamingProcessor,floor=processor?.messageId;
  if(!ctx||!processor||processor.isStopped||typeof floor!=='number'||!Number.isInteger(floor)||floor<0){inlineDiagnostic(s,'host-owner-unavailable');return null;}
  const message=ctx.chat[floor];if(!message||message.is_user)return null;
  const owner=s.inlineOwner;
  if(owner&&(owner.processor!==processor||owner.floor!==floor||!isSameMessage(message,owner.message)||swipe(message)!==owner.swipe))return null;
  const chat=document.getElementById('chat'),root=chat?.querySelector<HTMLElement>(`.mes[mesid="${floor}"] .mes_text`);
  // Preset thought viewers also use hidden textareas as data stores. Only the
  // host's actual message editor suspends previews, not arbitrary preset inputs.
  if(!chat||!root||root.querySelector('textarea.edit_textarea,textarea#curEditTextarea')){inlineDiagnostic(s,'message-not-rendered');return null;}
  const segments=markerSegments(message.mes,s.stripTags),markers=segments.map(segment=>segment.marker);
  const jobs=s.core.jobs.filter(job=>job.result&&!job.attached&&!job.saved&&job.phase!=='cancelled'&&markers[job.ordinal]?.raw===job.input.raw&&sameInlineStorySegment(segments[job.ordinal].segment,job.input.text));
  if(!jobs.length&&s.core.jobs.some(job=>job.result&&!job.attached&&!job.saved))inlineDiagnostic(s,'story-marker-mismatch',{markers:markers.length});
  if(!s.inlineOwner&&jobs.length)s.inlineOwner={processor,floor,message,swipe:swipe(message)};
  return {chat,root,markers:markers.map(marker=>marker.raw),anchors:segments.map(segment=>segment.segment),maxHeight:imageDisplayMaxHeight(settings.ui.imageDisplaySize),items:jobs.map(job=>({id:job.id,ordinal:job.ordinal,raw:job.input.raw,url:job.result!.result.url,dimensions:streamDimensions(s,job)}))};
}
function streamDimensions(s:Session,job:Job){
  return s.generation.backend==='nai'?parseSize(pickSize(s.generation.nai,effectiveOrientation(s.generation.orientation,job.payload?.image.size??s.promptEnvironment.profile.lockedSize??'portrait'))||'832×1216')??undefined:undefined;
}
function updateInlinePreview(s:Session):void{
  if(s.completed||s.controller.signal.aborted||!settings.enabled||!settings.autoTag.enabled||!settings.autoTag.streamGen||!settings.autoTag.streamInlinePreview){disposeInlinePreview(s);return;}
  if(!s.inline&&s.core.jobs.some(job=>job.result&&!job.saved&&!job.attached))s.inline=new StreamInlinePreview(()=>inlineSnapshot(s),()=>updateFloatingPreview(s),item=>openLightbox({src:item.url}),(reason,detail)=>inlineDiagnostic(s,reason,detail));
  s.inline?.refresh();
}
function updateFloatingPreview(s: Session): void {
  const id = `bbi-preview-${s.id}`;
  let host = document.getElementById(id);
  if (!settings.enabled || !settings.autoTag.enabled || !settings.autoTag.streamGen ||
    !settings.autoTag.streamPreview || s.completed || !ownerValid(s)) { host?.remove(); return; }
  const jobs = s.core.jobs.filter(job => job.result && !job.attached && !job.saved && job.phase !== 'cancelled' && !s.inline?.has(job.id));
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
