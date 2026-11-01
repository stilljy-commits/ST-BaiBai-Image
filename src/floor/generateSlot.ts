import { inferRenderProfile } from '@/autoTag/renderProfile';
import { streamSlotState } from '@/autoTag/streamState';
import { effectiveOrientation } from '@/backends/size';
import { captureGenerationSnapshot, decideSeed, generateImage, type GenerateInput, type GenerateOutput } from '@/generate';
import { consumeAutoGenerate, shouldAutoGenerate } from '@/floor/autoGenerate';
import { beginGen, clearGen, failGen, getGenRecord, isCurrentGen, reconcileGen, setGenPhase, setGenRetry, setQueueAhead, slotKey } from '@/floor/genState';
import { hydrateMessage } from '@/floor/hydrate';
import { historyEntries, latestStaleEntry, promptHash, readStore, saveImageResult } from '@/floor/storage';
import { isTagPlanning } from '@/floor/tagPlanState';
import { beginImage, failImage, finishImage, safeHistory } from '@/state/history';
import { getContext } from '@/st/context';
import { isSameMessage } from '@/st/messageEdit';
import { parseImageTagContent, parseImageTags } from '@/st/imageTagRegex';

interface SlotJob extends Omit<GenerateInput, 'seed'> {
  chatId: string; messageId: number; swipeId: number; seq: number; tag: string; slotId?: string;
}

/** Own the task independently of card mounting, scrolling and painting. */
export async function generateSlot(job: SlotJob): Promise<void> {
  const ctx=getContext(),message=ctx?.chat[job.messageId];
  if(!ctx||!message||ctx.getCurrentChatId()!==job.chatId||(message.swipe_id??0)!==job.swipeId) return;
  const key=slotKey(job.chatId,job.messageId,job.swipeId,job.seq,job.slotId),hash=promptHash(job.tag);
  reconcileGen(key,hash);
  const phase=getGenRecord(key)?.phase;
  if(phase==='queued'||phase==='generating'||isTagPlanning(key)||!job.prompt.trim())return;
  const snapshot=captureGenerationSnapshot();if(!snapshot.status.configured)return;
  // Clone at dispatch: a later UI edit must not mutate a queued request.
  const input={...job,characters:job.characters?.map(character=>({...character})),seed:decideSeed(snapshot.backend),
    renderProfile:job.renderProfile??inferRenderProfile(job.prompt)};
  const {signal,token}=beginGen(key,hash,snapshot.backend==='nai'?'queued':'generating');
  const owns=()=>{const current=getContext(),live=current?.chat[job.messageId];return !signal.aborted&&isCurrentGen(key,token)&&current?.getCurrentChatId()===job.chatId&&!!live&&isSameMessage(live,message)&&(live.swipe_id??0)===job.swipeId&&parseImageTags(live.mes)[job.seq]===job.tag;};
  const diagnostic=(event:string,detail:Record<string,unknown>={})=>console.info(`[BBI][AutoTagDebug] ${event}`,JSON.stringify({floor:job.messageId,seq:job.seq,slotId:job.slotId,at:Date.now(),...detail}));
  const started=performance.now();let historyId:number|null=null,output:GenerateOutput|undefined;
  diagnostic('image:queued');
  try{
    historyId=safeHistory(()=>beginImage({backend:snapshot.backend==='nai'?'nai':'comfyui',model:snapshot.status.model,prompt:input.prompt,nl:input.nl??'',negative:input.negative??'',characters:input.characters??[],seed:input.seed,size:input.size??'portrait',floor:job.messageId,seq:job.seq}));
    output=await generateImage(input,signal,{
      onStart:()=>{setGenPhase(key,token,'generating');diagnostic('image:request-start',{queueMs:Math.round(performance.now()-started)});},
      onQueue:ahead=>setQueueAhead(key,token,ahead),onRetry:retry=>setGenRetry(key,token,retry),
    },snapshot);
    if(!owns())throw new DOMException('图片任务已失效','AbortError');
    diagnostic('image:received');
    await saveImageResult(job.messageId,job.swipeId,job.seq,job.tag,input.seed,output.result,output.meta,{slotId:job.slotId,signal,owner:{chatId:job.chatId,message,swipeId:job.swipeId}});
    if(historyId!==null)safeHistory(()=>finishImage(historyId!));
    clearGen(key,token);diagnostic('image:saved');
    const current=getContext();if(current?.getCurrentChatId()===job.chatId)hydrateMessage(job.messageId,current);
  }catch(error){
    const aborted=signal.aborted||(error instanceof DOMException&&error.name==='AbortError');
    if(historyId!==null)safeHistory(()=>failImage(historyId!,error instanceof Error?error.message:String(error),aborted));
    if(aborted)clearGen(key,token);else failGen(key,token,error instanceof Error?error.message:String(error));
  }finally{output?.result.revoke();}
}

/** Consume only explicitly requested slots, immediately after the text is saved. */
export function startMarkedFloorGeneration(chatId:string,floor:number,swipeId:number):void{
  const ctx=getContext(),message=ctx?.chat[floor];
  if(!ctx||ctx.getCurrentChatId()!==chatId||!message||(message.swipe_id??0)!==swipeId)return;
  const snapshot=captureGenerationSnapshot(),store=readStore(message);
  for(const [seq,tag]of parseImageTags(message.mes).entries()){
    const mode=consumeAutoGenerate(chatId,floor,swipeId,seq);if(!mode)continue;
    const content=parseImageTagContent(tag);
    if(content.pending!==undefined||(content.slotId&&streamSlotState(content.slotId))||!snapshot.status.configured)continue;
    const key=slotKey(chatId,floor,swipeId,seq,content.slotId),hash=promptHash(tag);
    reconcileGen(key,hash);
    const phase=getGenRecord(key)?.phase??(historyEntries(store,swipeId,hash,seq,content.slotId).length?'ready':latestStaleEntry(store,swipeId,hash,seq,content.slotId)?'stale':'pending');
    if(!shouldAutoGenerate(mode,phase))continue;
    void generateSlot({chatId,messageId:floor,swipeId,seq,tag,slotId:content.slotId,prompt:content.tag,nl:content.nl,negative:content.negative,characters:content.characters,
      size:effectiveOrientation(snapshot.orientation,content.size),renderProfile:content.renderProfile});
  }
}
