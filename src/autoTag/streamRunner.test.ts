import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any,analyses:[] as any[],images:[] as any[],saveWait:null as Promise<void>|null,profile:{nl:false,naiCharPrompts:true,lockedSize:null as string|null}}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
vi.mock('@/api/client',()=>({requestCompletion:(_c:unknown,m:any,o:any)=>new Promise<void>((resolve,reject)=>h.analyses.push({m,o,resolve,reject})),requestViaMainApi:(m:any,o:any)=>new Promise<void>((resolve,reject)=>h.analyses.push({m,o,resolve,reject}))}));
vi.mock('@/autoTag/prompt',()=>({captureAutoTagEnvironment:()=>({profile:{...h.profile}}),buildAutoTagMessages:async(_c:any,_f:any,o:any,_m:any,t:any,a:any,n:any)=>[{role:'user',content:t.promptText,options:o,note:n,library:a}]}));
vi.mock('@/autoTag/bookMemory',()=>({readBookMemory:()=>null}));
vi.mock('@/autoTag/charAnchors',()=>({resolveCharAnchors:(entries:any[])=>({text:JSON.stringify(entries),entries}),applyPositionedCharRefs:(text:string)=>({text,unknown:[]})}));
vi.mock('@/state/charTags',()=>({CHAR_TAG_FIELDS:['sex','hair','eyes','fandom'],BBI_CHAR_EXTRA_KEY:'chars',charTagsBeforeFloor:()=>[],lockedCharTagNames:()=>new Set(),readCharTagFloorDelta:()=>null,makeCharTagFloorDelta:(x:any)=>x,recomputeCharTags:()=>{},createCharTagNewOp:(x:any,r:any)=>({...x,kind:'new',reason:r,at:Date.now()}),createCharTagSetOp:(name:any,field:any,value:any,reason:any)=>({kind:'set',name,field,value,reason,at:Date.now()}),emptyCharFields:()=>({}),applyCharTagOps:(entries:any[],ops:any[])=>[...entries,...ops.filter(op=>op.kind==='new').map(op=>({name:op.name,fields:op.fields,raw:op.raw,nl:op.nl,history:[]}))]}));
vi.mock('@/floor/hydrate',()=>({hydrateMessage:vi.fn()}));
vi.mock('@/floor/storage',()=>({saveImageResult:vi.fn(async()=>{if(h.saveWait)await h.saveWait;return {};})}));
vi.mock('@/st/messageEdit',async importOriginal=>({ ...await importOriginal<typeof import('@/st/messageEdit')>(),ensureFloorRendered:vi.fn(async()=>true) }));
vi.mock('@/generate',()=>({captureGenerationSnapshot:()=>({backend:'nai',nai:{seed:42,model:'nai-diffusion-5-full'},status:{configured:true},comfy:{},orientation:'auto'}),decideSeed:()=>42,
  generateImage:(input:any,signal:any)=>new Promise(resolve=>h.images.push({input,signal,resolve}))}));
import { settings } from '@/state/settings';
import { beginStreamSession, feedStreamText, reconcileStreamFloor, cancelStreamSessions } from './streamRunner';
import { saveImageResult } from '@/floor/storage';
import { parseImageTags, parseImageTagContent } from '@/st/imageTagRegex';
import { cancelStreamSlot } from '@/autoTag/streamState';
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const body='她打开门。\n[img: 门口相见]\n他交出钥匙。\n[img: 钥匙交接]';
const ai=(mes:string)=>({name:'Char',is_user:false,is_system:false,mes,send_date:'same-message',extra:{}});
function finishAnalysis(index:number,count=1){const task=h.analyses[index];const ids=[...task.m[0].content.matchAll(/⟦(P\d+)⟧/g)].map((m:any)=>m[1]);
  task.o.validate(JSON.stringify({images:Array.from({length:count},(_,i)=>({position:ids[i%ids.length],tag:`scene_${index}_${i}`,nl:'',negative:'',characters:[],size:'portrait'})),changes:[]}));task.resolve();}
function finishImage(index:number){h.images[index].resolve({result:{url:`data:image/png;base64,image${index}`,filename:'fake.png',revoke:vi.fn()},seed:42,size:'portrait',backend:'nai',charactersApplied:false,meta:{backend:'nai'}});}
beforeEach(()=>{
  h.analyses=[];h.images=[];h.saveWait=null;vi.clearAllMocks();
  h.profile={nl:false,naiCharPrompts:true,lockedSize:null};
  h.ctx={chat:[{name:'User',is_user:true,is_system:false,mes:'开始',send_date:'user'}],name1:'User',name2:'Char',getCurrentChatId:()=> 'A',chatMetadata:{},saveChat:vi.fn(async()=>{}),updateMessageBlock:vi.fn(),eventSource:{on:()=>{},emit:vi.fn()},eventTypes:{MESSAGE_EDITED:'edited',MESSAGE_UPDATED:'updated'}};
  settings.enabled=true;settings.defaultBackend='nai';settings.nai.comicMode=false;
  Object.assign(settings.autoTag,{enabled:true,streamGen:true,streamPreview:false,autoGenerate:true,minImages:0,maxImages:2,retryCount:0,streamAnalysisConcurrency:2});
  vi.stubGlobal('toastr',{warning:vi.fn(),info:vi.fn(),success:vi.fn()});
  vi.stubGlobal('document',{getElementById:()=>null,querySelector:()=>({querySelector:()=>null})});
});
afterEach(()=>{cancelStreamSessions();vi.unstubAllGlobals();});
describe('real stream runner integration with controlled external dependencies',()=>{
  it('reuses new fixed appearances in later requests without leaking later outfit updates into earlier segments',async()=>{
    settings.autoTag.streamAnalysisConcurrency=1;beginStreamSession('A');feedStreamText(body);await flush();
    const task=h.analyses[0];task.o.validate(JSON.stringify({images:[{position:'P1',tag:'doorway'}],changes:[
      {name:'小雪',field:'new',fields:{sex:'1girl',hair:'silver hair',eyes:'red eyes'},position:'P1',reason:'first appearance'},
      {name:'小雪',field:'outfit',value:'red coat',position:'P1',reason:'temporary outfit'},
    ]}));task.resolve();await flush();
    expect(h.analyses).toHaveLength(2);const next=h.analyses[1].m[0];
    expect(next.library).toContain('silver hair');expect(next.library).toContain('red eyes');expect(next.library).not.toContain('red coat');
    expect(next.note).toContain('段外出现但未进入本次目标段落');expect(next.note).toContain('正式角色即使不入画');
  });
  it('does not abort a paired neighbor when cancelling one card, but aborts when both are cancelled',async()=>{
    settings.autoTag.maxImages=4;const text=Array.from({length:4},(_,i)=>`事件${i}。\n[img: 画面${i}]`).join('\n');
    beginStreamSession('A');feedStreamText(text);await flush();finishAnalysis(0);await flush();
    h.ctx.chat.push(ai(text));await reconcileStreamFloor(1,'A');await flush();
    const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent), task=h.analyses[2];
    expect(cancelStreamSlot(slots[2].slotId)).toBe(true);expect(task.o.signal.aborted).toBe(false);
    expect(cancelStreamSlot(slots[3].slotId)).toBe(true);expect(task.o.signal.aborted).toBe(true);
    task.reject(new DOMException('cancelled','AbortError'));await flush();expect(h.analyses).toHaveLength(3);expect(h.images).toHaveLength(1);
  });
  it('keeps the host message DOM intact when late tags and images finish, including character metadata',async()=>{
    const text='她开门。\n[img: 门口]';beginStreamSession('A');feedStreamText(text);await flush();
    h.ctx.chat.push(ai(text));await reconcileStreamFloor(1,'A');await flush();expect(h.ctx.updateMessageBlock).toHaveBeenCalledOnce();
    const task=h.analyses[0];task.o.validate(JSON.stringify({images:[{position:'P1',tag:'doorway',characters:[],size:'portrait'}],
      changes:[{name:'她',field:'new',fields:{sex:'1girl',hair:'black hair',eyes:'blue eyes'},position:'P1',reason:'first appearance'}]}));task.resolve();await flush();
    const saves=h.ctx.saveChat.mock.calls.length, ops=JSON.stringify(h.ctx.chat[1].extra.chars);
    expect(ops).toContain('black hair');expect(h.ctx.updateMessageBlock).toHaveBeenCalledOnce();
    finishImage(0);await flush();expect(saveImageResult).toHaveBeenCalledOnce();
    expect(h.ctx.saveChat).toHaveBeenCalledTimes(saves);expect(JSON.stringify(h.ctx.chat[1].extra.chars)).toBe(ops);
    expect(h.ctx.updateMessageBlock).toHaveBeenCalledOnce();expect(h.ctx.eventSource.emit.mock.calls).toHaveLength(2);
  });
  it('pairs only queued markers, maps reversed output to the right slots and keeps floor completion immediate',async()=>{
    settings.autoTag.maxImages=6;
    const text=Array.from({length:6},(_,i)=>`事件${i}发生。\n[img: 画面${i}]`).join('\n');
    beginStreamSession('A');feedStreamText(text);await flush();expect(h.analyses).toHaveLength(2);
    finishAnalysis(0);await flush();expect(h.analyses).toHaveLength(3);expect(h.analyses[2].m[0].options).toMatchObject({minImages:2,maxImages:2});
    const task=h.analyses[2];task.o.validate(JSON.stringify({images:[{position:'P2',tag:'fourth',size:'portrait'},{position:'P1',tag:'third',size:'portrait'}],changes:[]}));task.resolve();await flush();
    expect(h.images.slice(1).map((image:any)=>image.input.prompt)).toEqual(['third','fourth']);
    h.ctx.chat.push(ai(text));await reconcileStreamFloor(1,'A');await flush();const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);
    expect(slots).toHaveLength(6);expect(slots.filter(slot=>slot.pending)).toHaveLength(3);
    finishImage(2);await flush();expect(vi.mocked(saveImageResult).mock.calls[0][7]?.slotId).toBe(slots[3].slotId);
    finishAnalysis(1);await flush();finishAnalysis(3,2);await flush();expect(h.analyses).toHaveLength(4);expect(h.images).toHaveLength(6);
  });
  it('falls back to individual requests when a paired response repeats the same marker',async()=>{
    settings.autoTag.maxImages=4;const text=Array.from({length:4},(_,i)=>`事件${i}。\n[img: 画面${i}]`).join('\n');
    beginStreamSession('A');feedStreamText(text);await flush();finishAnalysis(0);await flush();
    const task=h.analyses[2];expect(()=>task.o.validate(JSON.stringify({images:[{position:'P1',tag:'a'},{position:'P1',tag:'b'}],changes:[]}))).toThrow(/重复/);
    task.reject(Error('invalid batch'));await flush();expect(h.analyses).toHaveLength(4);expect(h.analyses[3].m[0].options.maxImages).toBe(1);
    finishAnalysis(3);await flush();finishAnalysis(4);finishAnalysis(1);await flush();expect(h.images).toHaveLength(4);
  });
  it('starts analysis without an AI floor and reserves every final slot while tags are pending',async()=>{
    beginStreamSession('A');feedStreamText(body);await flush();expect(h.analyses).toHaveLength(2);expect(h.ctx.chat).toHaveLength(1);
    h.ctx.chat.push(ai(body));await reconcileStreamFloor(1,'A');const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);
    expect(slots).toHaveLength(2);expect(slots.every(s=>s.pending)).toBe(true);expect(slots[0].slotId).not.toBe(slots[1].slotId);
    finishAnalysis(1);await flush();finishImage(0);await flush();expect(saveImageResult).toHaveBeenCalledOnce();
    expect(vi.mocked(saveImageResult).mock.calls[0][7]?.slotId).toBe(slots[1].slotId);
    finishAnalysis(0);await flush();finishImage(1);await flush();expect(saveImageResult).toHaveBeenCalledTimes(2);
    expect(parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent).map(s=>s.slotId)).toEqual(slots.map(s=>s.slotId));
  });
  it('returns final text without waiting for ready image uploads',async()=>{
    let release!:()=>void;h.saveWait=new Promise<void>(resolve=>{release=resolve;});
    beginStreamSession('A');feedStreamText('她开门。\n[img: 门口]');await flush();finishAnalysis(0);await flush();finishImage(0);await flush();
    h.ctx.chat.push(ai('她开门。\n[img: 门口]'));await reconcileStreamFloor(1,'A');
    expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(1);await flush();expect(saveImageResult).toHaveBeenCalledOnce();release();await flush();
  });
  it('does not send images when automatic generation is off',async()=>{
    settings.autoTag.autoGenerate=false;beginStreamSession('A');feedStreamText(body);await flush();finishAnalysis(0);finishAnalysis(1);await flush();
    h.ctx.chat.push(ai(body));await reconcileStreamFloor(1,'A');await flush();expect(h.images).toHaveLength(0);expect(saveImageResult).not.toHaveBeenCalled();
  });
  it('has a single budget and does not duplicate cumulative token feeds or repeated intentions',async()=>{
    const repeated='第一处相见。\n[img: 相见]\n第二处相见。\n[img: 相见]\n第三处相见。\n[img: 相见]';
    beginStreamSession('A');feedStreamText(repeated);feedStreamText(repeated);await flush();expect(h.analyses).toHaveLength(2);
    h.ctx.chat.push(ai(repeated));await reconcileStreamFloor(1,'A');const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);
    expect(slots).toHaveLength(2);expect(new Set(slots.map(s=>s.slotId)).size).toBe(2);expect(h.ctx.chat[1].mes).not.toContain('[img: 相见]\n第三');
  });
  it('only supplements missing slots and preserves existing streamed identity',async()=>{
    Object.assign(settings.autoTag,{minImages:2,maxImages:2});const one='她打开门。\n[img: 门口]\n他拿出钥匙。\n两人离开车站。';
    beginStreamSession('A');feedStreamText(one);await flush();h.ctx.chat.push(ai(one));await reconcileStreamFloor(1,'A');await flush();
    const original=parseImageTagContent(parseImageTags(h.ctx.chat[1].mes)[0]).slotId;expect(h.analyses).toHaveLength(2);
    expect(h.analyses[1].m[0].options.minImages).toBe(1);expect(h.analyses[1].m[0].options.maxImages).toBe(1);
    finishAnalysis(1);await flush();const ids=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent).map(s=>s.slotId);
    expect(ids).toHaveLength(2);expect(ids).toContain(original);expect(h.images).toHaveLength(1);
  });
  it('cannot save a late image into a different chat',async()=>{
    beginStreamSession('A');feedStreamText('她开门。\n[img: 门口]');await flush();finishAnalysis(0);await flush();
    h.ctx.chat.push(ai('她开门。\n[img: 门口]'));await reconcileStreamFloor(1,'A');h.ctx.getCurrentChatId=()=> 'B';cancelStreamSessions('B');
    finishImage(0);await flush();expect(saveImageResult).not.toHaveBeenCalled();
  });
  it('leaves a previous completed floor running when a new generation begins in the same chat',async()=>{
    beginStreamSession('A');feedStreamText('她开门。\n[img: 门口]');await flush();finishAnalysis(0);await flush();
    h.ctx.chat.push(ai('她开门。\n[img: 门口]'));await reconcileStreamFloor(1,'A');beginStreamSession('A');
    finishImage(0);await flush();expect(saveImageResult).toHaveBeenCalledOnce();expect(vi.mocked(saveImageResult).mock.calls[0][0]).toBe(1);
  });
  it('replaces a rewritten final marker without stale jobs consuming the image budget',async()=>{
    settings.autoTag.maxImages=1;beginStreamSession('A');feedStreamText('她开门。\n[img: 开门]');await flush();finishAnalysis(0);await flush();
    h.ctx.chat.push(ai('她开门。\n[img: 门口相见]'));await reconcileStreamFloor(1,'A');await flush();
    expect(h.analyses).toHaveLength(2);expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(1);
    finishImage(0);await flush();expect(saveImageResult).not.toHaveBeenCalled();
    finishAnalysis(1);await flush();finishImage(1);await flush();expect(saveImageResult).toHaveBeenCalledOnce();
  });
  it('counts existing images against the whole-floor limit when continuing a response',async()=>{
    settings.autoTag.maxImages=2;const existing='<bbi_image><tag>old scene</tag><size>portrait</size></bbi_image>';
    h.ctx.chat.push(ai('原文。\n'+existing));beginStreamSession('A','continue');feedStreamText('续写。\n[img: 续写一]\n后续。\n[img: 续写二]');await flush();
    expect(h.analyses).toHaveLength(1);h.ctx.chat[1].mes+='\n续写。\n[img: 续写一]\n后续。\n[img: 续写二]';await reconcileStreamFloor(1,'A');
    expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(2);expect(h.ctx.chat[1].mes).toContain(existing);
  });
  it('applies the frozen language and orientation settings to model output',async()=>{
    h.profile.lockedSize='landscape';beginStreamSession('A');feedStreamText('她开门。\n[img: 门口]');await flush();
    h.profile.nl=true;h.profile.lockedSize=null;
    h.analyses[0].o.validate(JSON.stringify({images:[{position:'P1',tag:'doorway',nl:'Unexpected natural language',size:'portrait',characters:[{name:'她',tag:'girl, opening door',nl:'Extra description'}]}],changes:[]}));
    h.analyses[0].resolve();await flush();
    expect(h.images[0].input).toMatchObject({nl:'',size:'landscape',characters:[{name:'她',tag:'girl, opening door',nl:''}]});
  });
  it('analyzes an uncovered long tail within the remaining budget even when the minimum is zero',async()=>{
    const text='她开门。\n[img: 门口]\n'+('两人走过街道并进入车站。'.repeat(100));
    beginStreamSession('A');feedStreamText(text);await flush();h.ctx.chat.push(ai(text));await reconcileStreamFloor(1,'A');await flush();
    expect(h.analyses).toHaveLength(2);const tail=h.analyses[1].m[0];
    expect(tail.options).toMatchObject({minImages:0,maxImages:1});expect(tail.content).toContain('进入车站');expect(tail.content).not.toContain('她开门');
    finishAnalysis(1);await flush();expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(2);
  });
  it('keeps the full current target and earlier facts without repeating the current target in the task note',async()=>{
    const text='她穿白裙，持钥匙。\n[img: 钥匙]\n她用钥匙推开车站的门。\n[img: 推门]';
    beginStreamSession('A');feedStreamText(text);await flush();
    const request=h.analyses[1].m[0];
    expect(request.content).toContain('她用钥匙推开车站的门。');expect(request.note).toContain('她穿白裙，持钥匙。');
    expect(request.note).not.toContain('她用钥匙推开车站的门。');expect(h.analyses).toHaveLength(2);
  });
});
