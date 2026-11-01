import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any,configured:true,requests:[] as any[],saved:[] as any[],history:new Set<number>(),stream:new Map<string,any>()}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
vi.mock('@/floor/hydrate',()=>({hydrateMessage:vi.fn()}));
vi.mock('@/autoTag/streamState',()=>({streamSlotState:(id:string)=>h.stream.get(id)}));
vi.mock('@/floor/storage',async original=>{
  const real=await original<typeof import('@/floor/storage')>();
  return {...real,historyEntries:(_s:any,_w:any,_h:any,seq:number)=>h.history.has(seq)?[{}]:[],latestStaleEntry:()=>null,
    saveImageResult:vi.fn(async(...args:any[])=>{h.saved.push(args);h.history.add(args[2]);return {};})};
});
vi.mock('@/generate',()=>({captureGenerationSnapshot:()=>({backend:'nai',orientation:'auto',status:{configured:h.configured,model:'fixture'},nai:{},comfy:{}}),decideSeed:()=>42,
  generateImage:async(input:any,signal:any,progress:any)=>{
    const {acquireNaiSlot}=await import('@/floor/genQueue');const release=await acquireNaiSlot(signal);
    try{progress.onStart?.();return await new Promise((resolve,reject)=>{
      const result={result:{url:'blob:fixture',revoke:vi.fn()},seed:input.seed,size:input.size,backend:'nai',meta:{}};
      h.requests.push({input,signal,result,resolve:()=>resolve(result)});
      signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
    });}finally{release();}
  },
}));
import { generateSlot,startMarkedFloorGeneration } from './generateSlot';
import { clearAutoGenerateFlags,consumeAutoGenerate,markForAutoGenerate } from './autoGenerate';
import { clearAllGen,slotKey,getGenRecord,cancelGen } from './genState';
import { resetNaiGate } from './genQueue';
import { serializeImageTag } from '@/st/imageTagRegex';
import { applyMessageText } from '@/st/messageEdit';
const flush=async()=>{for(let i=0;i<45;i++)await Promise.resolve();};
const tag=(seq=0)=>serializeImageTag({tag:'1girl, standing '+seq,nl:'',negative:'',characters:[],size:'portrait'});
function install(tags=[tag(0),tag(1),tag(2)]){
  h.ctx={chat:[{mes:tags.join('\n'),name:'fixture',extra:{}}],getCurrentChatId:()=> 'A',saveChat:vi.fn(async()=>{}),eventTypes:{MESSAGE_EDITED:'edit'},eventSource:{emit:vi.fn(async()=>{})}};
}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('document',{querySelector:()=>null});h.configured=true;h.requests=[];h.saved=[];h.history.clear();h.stream.clear();clearAllGen();clearAutoGenerateFlags();resetNaiGate();install();vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(async()=>{clearAllGen();await flush();resetNaiGate();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('saved automatic image tasks without mounted cards',()=>{
 it('queues every saved slot without any screen, scrolling, DOM query or animation frame',async()=>{
   const forbidden=()=>{throw Error('Unexpected display dependency');};
   vi.stubGlobal('document',{querySelector:forbidden,getElementById:forbidden});vi.stubGlobal('requestAnimationFrame',forbidden);
   for(let seq=0;seq<3;seq++)markForAutoGenerate('A',0,0,seq);
   startMarkedFloorGeneration('A',0,0);await flush();
   expect(h.requests).toHaveLength(1);
   expect([0,1,2].map(seq=>getGenRecord(slotKey('A',0,0,seq))?.phase)).toEqual(['generating','queued','queued']);
   for(let seq=0;seq<3;seq++){expect(h.requests[seq]).toBeDefined();h.requests[seq].resolve();await flush();await vi.advanceTimersByTimeAsync(1600);}
   expect(h.saved.map(args=>args[2])).toEqual([0,1,2]);
 });
 it('starts after saving but before host rendering can finish',async()=>{
   install([]);let finishRender!:()=>void;
   const rendered=new Promise<void>(resolve=>finishRender=resolve);
   h.ctx.eventSource.emit=vi.fn(()=>rendered);
   markForAutoGenerate('A',0,0,0);
   const writing=applyMessageText(0,()=>tag(),'A',null,h.ctx.chat[0],undefined,{afterSave:()=>startMarkedFloorGeneration('A',0,0)});
   await flush();expect(h.ctx.saveChat).toHaveBeenCalledOnce();expect(h.ctx.eventSource.emit).toHaveBeenCalled();expect(h.requests).toHaveLength(1);
   h.requests[0].resolve();await flush();expect(h.saved).toHaveLength(1);
   finishRender();await expect(writing).resolves.toBe('saved');
 });
 it('finishes all twenty images in a long floor before a ten-minute scroll delay, without mounting any cards',async()=>{
   install(Array.from({length:20},(_,seq)=>tag(seq)));
   h.ctx.chat[0].mes=h.ctx.chat[0].mes.replaceAll('\n','\n'+('长正文段落。'.repeat(1000))+'\n');
   const forbidden=()=>{throw Error('Unexpected display dependency');};
   vi.stubGlobal('document',{querySelector:forbidden,getElementById:forbidden});vi.stubGlobal('requestAnimationFrame',forbidden);
   for(let seq=0;seq<20;seq++)markForAutoGenerate('A',0,0,seq);
   startMarkedFloorGeneration('A',0,0);await flush();
   for(let seq=0;seq<20;seq++){expect(h.requests).toHaveLength(seq+1);h.requests[seq].resolve();await flush();await vi.advanceTimersByTimeAsync(1600);}
   await vi.advanceTimersByTimeAsync(10*60*1000);
   expect(h.saved.map(args=>args[2])).toEqual(Array.from({length:20},(_,seq)=>seq));
   expect(h.requests).toHaveLength(20);
 });
 it('does not start when saving fails and restores the original text',async()=>{
   install([]);h.ctx.saveChat=vi.fn(async()=>{throw Error('storage unavailable');});
   markForAutoGenerate('A',0,0,0);
   await expect(applyMessageText(0,()=>tag(),'A',null,h.ctx.chat[0],undefined,{afterSave:()=>startMarkedFloorGeneration('A',0,0)})).rejects.toThrow('storage unavailable');
   expect(h.requests).toHaveLength(0);expect(h.ctx.chat[0].mes).toBe('');
 });
 it('does not start for a switched chat while saving',async()=>{
   install([]);h.ctx.saveChat=vi.fn(async()=>{h.ctx.getCurrentChatId=()=> 'B';});markForAutoGenerate('A',0,0,0);
   await expect(applyMessageText(0,()=>tag(),'A',null,h.ctx.chat[0],undefined,{afterSave:()=>startMarkedFloorGeneration('A',0,0)})).resolves.toBe('chat-changed');
   expect(h.requests).toHaveLength(0);
 });
 it('does not start twice when repeated hydration or a new flag arrives during generation',async()=>{
   markForAutoGenerate('A',0,0,0);startMarkedFloorGeneration('A',0,0);await flush();
   startMarkedFloorGeneration('A',0,0);markForAutoGenerate('A',0,0,0);startMarkedFloorGeneration('A',0,0);await flush();
   expect(h.requests).toHaveLength(1);h.requests[0].resolve();await flush();
   markForAutoGenerate('A',0,0,0);startMarkedFloorGeneration('A',0,0);await flush();expect(h.requests).toHaveLength(1);
 });
 it('preserves force regeneration of a saved prompt even when the text is unchanged',async()=>{
   h.history.add(0);markForAutoGenerate('A',0,0,0,'force');
   await applyMessageText(0,text=>text,'A',null,h.ctx.chat[0],undefined,{afterSave:()=>startMarkedFloorGeneration('A',0,0)});
   await flush();expect(h.requests).toHaveLength(1);h.requests[0].resolve();await flush();expect(h.saved).toHaveLength(1);
 });
 it('preserves disabled backend, stream-owned and still-analyzing placeholders',async()=>{
   h.configured=false;markForAutoGenerate('A',0,0,0);startMarkedFloorGeneration('A',0,0);await flush();expect(h.requests).toHaveLength(0);expect(consumeAutoGenerate('A',0,0,0)).toBeNull();
   h.configured=true;install([serializeImageTag({tag:'',nl:'',negative:'',characters:[],size:'portrait',slotId:'live',pending:'scene'})]);
   markForAutoGenerate('A',0,0,0);startMarkedFloorGeneration('A',0,0);await flush();expect(h.requests).toHaveLength(0);
   install([serializeImageTag({tag:'1girl',nl:'',negative:'',characters:[],size:'portrait',slotId:'live'})]);h.stream.set('live',{phase:'generating'});
   markForAutoGenerate('A',0,0,0);startMarkedFloorGeneration('A',0,0);await flush();expect(h.requests).toHaveLength(0);
 });
 it.each(['cancel','changed-prompt','changed-chat'])('discards a late image after %s',async reason=>{
   const promise=generateSlot({chatId:'A',messageId:0,swipeId:0,seq:0,tag:tag(),prompt:'1girl'});await flush();
   if(reason==='cancel')cancelGen(slotKey('A',0,0,0));
   if(reason==='changed-prompt')h.ctx.chat[0].mes=tag(10);
   if(reason==='changed-chat')h.ctx.getCurrentChatId=()=> 'B';
   h.requests[0].resolve();await promise;expect(h.saved).toHaveLength(0);
   if(reason!=='cancel')expect(h.requests[0].result.result.revoke).toHaveBeenCalledOnce();
 });
});
