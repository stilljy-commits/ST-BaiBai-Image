import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any,analyses:[] as any[],images:[] as any[],saveWait:null as Promise<void>|null,profile:{nl:false,naiCharPrompts:true,lockedSize:null as string|null}}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
vi.mock('@/api/client',()=>({requestCompletion:(_c:unknown,m:any,o:any)=>new Promise<void>((resolve,reject)=>h.analyses.push({m,o,resolve,reject})),requestViaMainApi:(m:any,o:any)=>new Promise<void>((resolve,reject)=>h.analyses.push({m,o,resolve,reject}))}));
vi.mock('@/autoTag/prompt',()=>({captureAutoTagEnvironment:()=>({profile:{...h.profile}}),buildAutoTagMessages:async(_c:any,_f:any,o:any,_m:any,t:any,a:any,n:any,_p:any,_e:any,planning:any)=>[{role:'user',content:t.promptText,options:o,note:n,library:a,planning}]}));
vi.mock('@/autoTag/bookMemory',()=>({readBookMemory:()=>null}));
vi.mock('@/autoTag/charAnchors',()=>({resolveCharAnchors:(entries:any[])=>({text:JSON.stringify(entries),entries}),applyPositionedCharRefs:(text:string)=>({text,unknown:[]})}));
vi.mock('@/state/charTags',()=>({CHAR_TAG_FIELDS:['sex','hair','eyes','fandom'],BBI_CHAR_EXTRA_KEY:'chars',charTagsBeforeFloor:()=>[],lockedCharTagNames:()=>new Set(),readCharTagFloorDelta:()=>null,makeCharTagFloorDelta:(x:any)=>x,recomputeCharTags:()=>{},createCharTagNewOp:(x:any,r:any)=>({...x,kind:'new',reason:r,at:Date.now()}),createCharTagSetOp:(name:any,field:any,value:any,reason:any)=>({kind:'set',name,field,value,reason,at:Date.now()}),emptyCharFields:()=>({}),applyCharTagOps:(entries:any[],ops:any[])=>[...entries,...ops.filter(op=>op.kind==='new').map(op=>({name:op.name,fields:op.fields,raw:op.raw,nl:op.nl,history:[]}))]}));
vi.mock('@/floor/hydrate',()=>({hydrateMessage:vi.fn()}));
vi.mock('@/floor/storage',()=>({saveImageResult:vi.fn(async()=>{if(h.saveWait)await h.saveWait;return {};})}));
vi.mock('@/st/messageEdit',async importOriginal=>({ ...await importOriginal<typeof import('@/st/messageEdit')>(),ensureFloorRendered:vi.fn(async()=>true) }));
vi.mock('@/generate',()=>({captureGenerationSnapshot:()=>({backend:'nai',nai:{seed:42,model:'nai-diffusion-5-full'},status:{configured:true},comfy:{},orientation:'auto'}),decideSeed:()=>42,
  generateImage:(input:any,signal:any)=>new Promise(resolve=>h.images.push({input,signal,resolve}))}));
import { settings } from '@/state/settings';
import { beginStreamSession, feedStreamText, reconcileStreamFloor, cancelStreamSessions, refreshStreamPreviews } from './streamRunner';
import { saveImageResult } from '@/floor/storage';
import { parseImageTags, parseImageTagContent } from '@/st/imageTagRegex';
import { cancelStreamSlot, retryStreamSlot, streamSlotState } from '@/autoTag/streamState';
const flush=async()=>{for(let i=0;i<35;i++)await Promise.resolve();};
const body='她打开门。\n[img: 门口相见]\n他交出钥匙。\n[img: 钥匙交接]';
const ai=(mes:string)=>({name:'Char',is_user:false,is_system:false,mes,send_date:'same-message',extra:{}});
function finishAnalysis(index:number,count?:number){const task=h.analyses[index];const ids=[...task.m[0].content.matchAll(/⟦(P\d+)⟧/g)].map((m:any)=>m[1]);
  const markers=[...task.m[0].note.matchAll(/图片 position 固定填 "(M\d+)"/g)].map((m:any)=>m[1]);const positions=markers.length?markers:ids;
  task.o.validate(JSON.stringify({images:Array.from({length:count ?? task.m[0].options.maxImages},(_,i)=>({position:positions[i%positions.length],tag:`scene_${index}_${i}`,nl:'',negative:'',characters:[],size:'portrait'})),changes:[]}));task.resolve();}
function finishImage(index:number){h.images[index].resolve({result:{url:`data:image/png;base64,image${index}`,filename:'fake.png',revoke:vi.fn()},seed:42,size:'portrait',backend:'nai',charactersApplied:false,meta:{backend:'nai'}});}
function previewDocument(){
  const hosts=new Map<string,any>();
  const element=()=>({id:'',style:{cssText:''},children:[] as any[],
    appendChild(child:any){this.children.push(child);if(child.id)hosts.set(child.id,child);return child;},
    replaceChildren(...children:any[]){this.children=children;},remove(){hosts.delete(this.id);}});
  vi.stubGlobal('document',{getElementById:(id:string)=>hosts.get(id)??null,createElement:()=>element(),body:element(),querySelector:()=>({querySelector:()=>null})});
  return hosts;
}
beforeEach(()=>{
  h.analyses=[];h.images=[];h.saveWait=null;vi.clearAllMocks();
  h.profile={nl:false,naiCharPrompts:true,lockedSize:null};
  h.ctx={chat:[{name:'User',is_user:true,is_system:false,mes:'开始',send_date:'user'}],name1:'User',name2:'Char',getCurrentChatId:()=> 'A',chatMetadata:{},saveChat:vi.fn(async()=>{}),updateMessageBlock:vi.fn(),eventSource:{on:()=>{},emit:vi.fn()},eventTypes:{MESSAGE_EDITED:'edited',MESSAGE_UPDATED:'updated'}};
  settings.enabled=true;settings.defaultBackend='nai';settings.nai.comicMode=false;
  Object.assign(settings.autoTag,{enabled:true,streamGen:true,streamPreview:false,streamGapSupplement:false,autoGenerate:true,minImages:0,maxImages:2,retryCount:0,streamAnalysisConcurrency:2});
  vi.stubGlobal('toastr',{warning:vi.fn(),info:vi.fn(),success:vi.fn()});
  vi.stubGlobal('document',{getElementById:()=>null,querySelector:()=>({querySelector:()=>null})});
});
afterEach(()=>{cancelStreamSessions();vi.unstubAllGlobals();});
const story=(count:number)=>Array.from({length:count},(_,i)=>`事件${i}发生。\n[img: 画面${i}]`).join('\n');
async function attachStory(text:string){h.ctx.chat.push(ai(text));await reconcileStreamFloor(1,'A');await flush();}
async function pendingStory(text=body){beginStreamSession('A');feedStreamText(text);await flush();await attachStory(text);}

describe('real stream runner with fixed groups of three',()=>{
  it.each([1,2,3,5])('waits for story completion when fewer than three markers arrive at limit %s',async(maxImages)=>{
    settings.autoTag.maxImages=maxImages;const text=story(Math.min(2,maxImages));
    beginStreamSession('A');feedStreamText(text);await flush();expect(h.analyses).toHaveLength(0);
    await attachStory(text);expect(h.analyses).toHaveLength(1);
    expect(h.analyses[0].m[0].options).toMatchObject({minImages:Math.min(2,maxImages),maxImages:Math.min(2,maxImages)});
    finishAnalysis(0);await flush();expect(h.images).toHaveLength(Math.min(2,maxImages));
  });
  it('uses 3+2 for a 3-5 range and does not dispatch its short tail before story completion',async()=>{
    Object.assign(settings.autoTag,{minImages:3,maxImages:5,streamAnalysisConcurrency:1});
    beginStreamSession('A');feedStreamText(story(2));await flush();expect(h.analyses).toHaveLength(0);
    feedStreamText(story(3));await flush();expect(h.analyses[0].m[0].options.maxImages).toBe(3);
    finishAnalysis(0);await flush();feedStreamText(story(5));await flush();expect(h.analyses).toHaveLength(1);
    await attachStory(story(5));expect(h.analyses[1].m[0].options).toMatchObject({minImages:2,maxImages:2});
    finishAnalysis(1);await flush();expect(h.analyses).toHaveLength(2);expect(h.images).toHaveLength(5);
    expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(5);
  });
  it('starts at the third marker at a 5-21 range and analyzes nine as 3+3+3',async()=>{
    Object.assign(settings.autoTag,{minImages:5,maxImages:21,streamAnalysisConcurrency:1});
    beginStreamSession('A');feedStreamText(story(2));await flush();expect(h.analyses).toHaveLength(0);
    feedStreamText(story(3));await flush();expect(h.analyses[0].o.source).toBe('流式配图 · 合并3张');
    feedStreamText(story(9));finishAnalysis(0);await flush();finishAnalysis(1);await flush();
    expect(h.analyses.map(task=>task.m[0].options.maxImages)).toEqual([3,3,3]);
    await attachStory(story(9));finishAnalysis(2);await flush();
    expect(h.analyses).toHaveLength(3);expect(h.images).toHaveLength(9);expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(9);
  });
  it('never starts on draft markers or reuses a draft segment for an identical final marker',async()=>{
    settings.autoTag.maxImages=21;
    const draft='<draft>\n'+Array.from({length:3},(_,i)=>`草稿计划${i}。\n[img: 画面${i}]`).join('\n')+'\n';
    beginStreamSession('A');feedStreamText(draft);await flush();expect(h.analyses).toHaveLength(0);
    const text=draft+'</draft>\n<now_plot>\n'+story(3)+'\n</now_plot>';
    feedStreamText(text);await flush();expect(h.analyses).toHaveLength(1);
    expect(h.analyses[0].m[0].content).not.toMatch(/草稿|now_plot/);
    for(let i=0;i<3;i++)expect(h.analyses[0].m[0].content).toContain(`事件${i}发生。`);
    finishAnalysis(0);await flush();await attachStory(text);
    expect(h.ctx.chat[1].mes.startsWith(draft+'</draft>')).toBe(true);
    expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(3);expect(h.analyses).toHaveLength(1);
  });
  it('closes the streaming preview at attachment while uploads are blocked and keeps late images inline',async()=>{
    const hosts=previewDocument();settings.autoTag.streamPreview=true;settings.autoTag.maxImages=3;
    beginStreamSession('A');feedStreamText(story(3));await flush();finishAnalysis(0);await flush();finishImage(0);await flush();
    expect(hosts.size).toBe(1);let release!:()=>void;h.saveWait=new Promise<void>(resolve=>{release=resolve;});
    await attachStory(story(3));expect(hosts.size).toBe(0);
    finishImage(1);finishImage(2);await flush();expect(hosts.size).toBe(0);
    release();await flush();expect(saveImageResult).toHaveBeenCalledTimes(3);
  });
  it('preserves inline saving retry without leaving a preview when storage fails',async()=>{
    const hosts=previewDocument();settings.autoTag.streamPreview=true;
    await pendingStory(story(1));finishAnalysis(0);await flush();
    vi.mocked(saveImageResult).mockRejectedValueOnce(new Error('temporary storage failure'));
    finishImage(0);await flush();expect(hosts.size).toBe(0);
    const slot=parseImageTagContent(parseImageTags(h.ctx.chat[1].mes)[0]).slotId;
    expect(streamSlotState(slot)?.phase).toBe('error');expect(retryStreamSlot(slot)).toBe(true);
    await flush();expect(saveImageResult).toHaveBeenCalledTimes(2);expect(hosts.size).toBe(0);
  });
  it('clears a disabled preview and restores it only during prose streaming',async()=>{
    const hosts=previewDocument();settings.autoTag.streamPreview=true;settings.autoTag.maxImages=3;
    beginStreamSession('A');feedStreamText(story(3));await flush();finishAnalysis(0);await flush();finishImage(0);await flush();
    expect(hosts.size).toBe(1);settings.autoTag.streamPreview=false;refreshStreamPreviews();expect(hosts.size).toBe(0);
    settings.autoTag.streamPreview=true;refreshStreamPreviews();expect(hosts.size).toBe(1);cancelStreamSessions();expect(hosts.size).toBe(0);
  });
  it('reuses immutable new profiles in the next batch without carrying later temporary outfits backwards',async()=>{
    Object.assign(settings.autoTag,{maxImages:6,streamAnalysisConcurrency:1});
    beginStreamSession('A');feedStreamText(story(6));await flush();
    h.analyses[0].o.validate(JSON.stringify({images:[1,2,3].map(i=>({position:`P${i}`,tag:`scene${i}`})),changes:[
      {name:'小雪',field:'new',fields:{sex:'1girl',hair:'silver hair',eyes:'red eyes'},position:'P1',reason:'first appearance'},
      {name:'小雪',field:'outfit',value:'red coat',position:'P1',reason:'temporary outfit'},
    ]}));h.analyses[0].resolve();await flush();
    expect(h.analyses[1].m[0].library).toContain('silver hair');expect(h.analyses[1].m[0].library).not.toContain('red coat');
    expect(h.analyses[1].m[0].note).toContain('段外出现但未进入本次目标段落');
  });
  it('aborts a shared short-tail request only when all its member slots are cancelled',async()=>{
    await pendingStory();const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent),task=h.analyses[0];
    expect(cancelStreamSlot(slots[0].slotId)).toBe(true);expect(task.o.signal.aborted).toBe(false);
    expect(cancelStreamSlot(slots[1].slotId)).toBe(true);expect(task.o.signal.aborted).toBe(true);
    task.reject(new DOMException('cancelled','AbortError'));await flush();expect(h.images).toHaveLength(0);
  });
  it('keeps the host DOM and character metadata intact when late tags and an image finish',async()=>{
    await pendingStory(story(1));expect(h.ctx.updateMessageBlock).toHaveBeenCalledOnce();
    h.analyses[0].o.validate(JSON.stringify({images:[{position:'P1',tag:'doorway',characters:[],size:'portrait'}],
      changes:[{name:'她',field:'new',fields:{sex:'1girl',hair:'black hair',eyes:'blue eyes'},position:'P1',reason:'first appearance'}]}));
    h.analyses[0].resolve();await flush();const saves=h.ctx.saveChat.mock.calls.length,ops=JSON.stringify(h.ctx.chat[1].extra.chars);
    expect(ops).toContain('black hair');finishImage(0);await flush();expect(saveImageResult).toHaveBeenCalledOnce();
    expect(h.ctx.saveChat).toHaveBeenCalledTimes(saves);expect(JSON.stringify(h.ctx.chat[1].extra.chars)).toBe(ops);
    expect(h.ctx.updateMessageBlock).toHaveBeenCalledOnce();expect(h.ctx.eventSource.emit.mock.calls).toHaveLength(2);
  });
  it('maps reversed batch results and out-of-order image completion to their original slots',async()=>{
    settings.autoTag.maxImages=3;beginStreamSession('A');feedStreamText(story(3));await flush();
    h.analyses[0].o.validate(JSON.stringify({images:[{position:'P3',tag:'third'},{position:'P1',tag:'first'},{position:'P2',tag:'second'}],changes:[]}));
    h.analyses[0].resolve();await flush();expect(h.images.map(image=>image.input.prompt)).toEqual(['first','second','third']);
    await attachStory(story(3));const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);
    finishImage(2);await flush();expect(vi.mocked(saveImageResult).mock.calls[0][7]?.slotId).toBe(slots[2].slotId);
    expect(h.ctx.updateMessageBlock).toHaveBeenCalledOnce();
  });
  it('allows a later analysis batch to complete first while retaining slot identities',async()=>{
    settings.autoTag.maxImages=6;beginStreamSession('A');feedStreamText(story(6));await flush();expect(h.analyses).toHaveLength(2);
    await attachStory(story(6));const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);
    finishAnalysis(1);await flush();finishImage(0);await flush();
    expect(vi.mocked(saveImageResult).mock.calls[0][7]?.slotId).toBe(slots[3].slotId);
    finishAnalysis(0);await flush();expect(h.images).toHaveLength(6);expect(h.analyses).toHaveLength(2);
  });
  it('falls back only a malformed batch through individual requests without bypassing concurrency',async()=>{
    Object.assign(settings.autoTag,{maxImages:6,streamAnalysisConcurrency:1});
    beginStreamSession('A');feedStreamText(story(6));await flush();const task=h.analyses[0];
    expect(()=>task.o.validate(JSON.stringify({images:[1,2,3].map(()=>({position:'P1',tag:'wrong'})),changes:[]}))).toThrow(/重复/);
    task.reject(new Error('invalid batch'));await flush();expect(h.analyses).toHaveLength(2);
    for(let i=1;i<=3;i++){expect(h.analyses[i].m[0].options.maxImages).toBe(1);finishAnalysis(i);await flush();}
    expect(h.analyses).toHaveLength(5);expect(h.analyses[4].m[0].options.maxImages).toBe(3);
    finishAnalysis(4);await flush();expect(h.images).toHaveLength(6);
  });
  it('reserves every final pending slot before analysis returns',async()=>{
    await pendingStory();const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);
    expect(slots).toHaveLength(2);expect(slots.every(slot=>slot.pending)).toBe(true);expect(slots[0].slotId).not.toBe(slots[1].slotId);
    finishAnalysis(0);await flush();finishImage(1);await flush();expect(vi.mocked(saveImageResult).mock.calls[0][7]?.slotId).toBe(slots[1].slotId);
    finishImage(0);await flush();expect(saveImageResult).toHaveBeenCalledTimes(2);
    expect(parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent).map(slot=>slot.slotId)).toEqual(slots.map(slot=>slot.slotId));
  });
  it('writes tags without generating images when automatic image generation is disabled',async()=>{
    settings.autoTag.autoGenerate=false;await pendingStory();finishAnalysis(0);await flush();
    expect(h.images).toHaveLength(0);expect(saveImageResult).not.toHaveBeenCalled();
    expect(parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent).every(slot=>!slot.pending&&!!slot.tag)).toBe(true);
  });
  it('shares one budget across repeated cumulative feeds and identical intentions',async()=>{
    const text='第一处相见。\n[img: 相见]\n第二处相见。\n[img: 相见]\n第三处相见。\n[img: 相见]';
    beginStreamSession('A');feedStreamText(text);feedStreamText(text);await flush();expect(h.analyses).toHaveLength(0);
    await attachStory(text);expect(h.analyses).toHaveLength(1);finishAnalysis(0);await flush();
    const slots=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent);expect(slots).toHaveLength(2);expect(new Set(slots.map(slot=>slot.slotId)).size).toBe(2);
    expect(h.ctx.chat[1].mes).not.toContain('[img:');expect(h.images).toHaveLength(2);
  });
  it('supplements only missing slots after marker analysis and shares newly established profiles',async()=>{
    Object.assign(settings.autoTag,{minImages:2,maxImages:5,streamAnalysisConcurrency:1});
    const text='小雪开门。\n[img: 门口]\n小雪把钥匙交给他。';await pendingStory(text);
    const original=parseImageTagContent(parseImageTags(h.ctx.chat[1].mes)[0]).slotId;
    h.analyses[0].o.validate(JSON.stringify({images:[{position:'P1',tag:'doorway'}],changes:[{name:'小雪',field:'new',fields:{sex:'1girl',hair:'silver hair',eyes:'red eyes'},position:'P1',reason:'first appearance'}]}));
    h.analyses[0].resolve();await flush();expect(h.analyses).toHaveLength(2);expect(h.images).toHaveLength(1);
    expect(h.analyses[1].m[0].options).toMatchObject({minImages:1,maxImages:1});expect(h.analyses[1].m[0].library).toContain('silver hair');
    expect(h.analyses[0].m[0].planning).toBe('fixed-markers');expect(h.analyses[1].m[0].planning).toBeUndefined();
    expect(h.analyses[1].o.source).toBe('流式配图 · 文末补充');finishAnalysis(1,1);await flush();
    const ids=parseImageTags(h.ctx.chat[1].mes).map(parseImageTagContent).map(slot=>slot.slotId);expect(ids).toHaveLength(2);expect(ids).toContain(original);
  });
  it('does not save a late image into another chat',async()=>{
    await pendingStory(story(1));finishAnalysis(0);await flush();h.ctx.getCurrentChatId=()=> 'B';cancelStreamSessions('B');
    finishImage(0);await flush();expect(saveImageResult).not.toHaveBeenCalled();
  });
  it('keeps a completed floor running when the next prose generation begins in the same chat',async()=>{
    await pendingStory(story(1));finishAnalysis(0);await flush();beginStreamSession('A');finishImage(0);await flush();
    expect(saveImageResult).toHaveBeenCalledOnce();expect(vi.mocked(saveImageResult).mock.calls[0][0]).toBe(1);
  });
  it('frees rewritten final markers without generating a stale image or losing surviving batch members',async()=>{
    settings.autoTag.maxImages=3;beginStreamSession('A');feedStreamText(story(3));await flush();
    const final=story(3).replace('[img: 画面2]','[img: 重写画面]');await attachStory(final);expect(h.analyses).toHaveLength(2);
    finishAnalysis(0);finishAnalysis(1);await flush();expect(h.images).toHaveLength(3);
    for(let i=0;i<3;i++)finishImage(i);await flush();expect(saveImageResult).toHaveBeenCalledTimes(3);
    expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(3);
  });
  it('counts existing images against the whole-floor limit when continuing prose',async()=>{
    const existing='<bbi_image><tag>old scene</tag><size>portrait</size></bbi_image>';
    h.ctx.chat.push(ai('原文。\n'+existing));beginStreamSession('A','continue');const more='续写。\n[img: 续写一]\n后续。\n[img: 续写二]';
    feedStreamText(more);await flush();expect(h.analyses).toHaveLength(0);h.ctx.chat[1].mes+='\n'+more;
    await reconcileStreamFloor(1,'A');await flush();expect(h.analyses).toHaveLength(1);expect(h.analyses[0].m[0].options.maxImages).toBe(1);
    expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(2);expect(h.ctx.chat[1].mes).toContain(existing);
  });
  it('uses frozen language and orientation settings for late model results',async()=>{
    h.profile.lockedSize='landscape';await pendingStory(story(1));h.profile.nl=true;h.profile.lockedSize=null;
    h.analyses[0].o.validate(JSON.stringify({images:[{position:'P1',tag:'doorway',nl:'Unexpected natural language',size:'portrait',characters:[{name:'她',tag:'girl, opening door',nl:'Extra description'}]}],changes:[]}));
    h.analyses[0].resolve();await flush();expect(h.images[0].input).toMatchObject({nl:'',size:'landscape',characters:[{name:'她',tag:'girl, opening door',nl:''}]});
  });
  it('analyzes an uncovered long tail without duplicating the already illustrated opening',async()=>{
    settings.autoTag.maxImages=5;settings.autoTag.streamGapSupplement=true;const text='她开门。\n[img: 门口]\n'+'两人走过街道并进入车站。'.repeat(140);
    await pendingStory(text);finishAnalysis(0);await flush();expect(h.analyses).toHaveLength(2);
    expect(h.analyses[1].m[0].options).toMatchObject({minImages:0,maxImages:4});expect(h.analyses[1].m[0].content).toContain('进入车站');
    expect(h.analyses[1].m[0].content).not.toContain('她开门');finishAnalysis(1,1);await flush();expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(2);
  });
  it('does not add an optional long-gap request after the minimum is already met by default',async()=>{
    settings.autoTag.maxImages=5;const text='她开门。\n[img: 门口]\n'+'两人走过街道并进入车站。'.repeat(140);
    await pendingStory(text);finishAnalysis(0);await flush();expect(h.analyses).toHaveLength(1);expect(h.images).toHaveLength(1);
  });
  it('ignores long metadata and its markers even with optional gap filling enabled',async()=>{
    Object.assign(settings.autoTag,{maxImages:6,streamGapSupplement:true});
    const metadata='<summary>\n'+('已经叙述过的摘要。'.repeat(220))+'\n[img: 摘要伪标记]\n</summary>\n<action>\n[img: 选项伪标记]\n</action>\n<UpdateVariable>\n'+('变量更新。'.repeat(220))+'\n</UpdateVariable>';
    const text=story(3)+'\n两人结束散步。\n'+metadata;
    beginStreamSession('A');feedStreamText(text);await flush();expect(h.analyses).toHaveLength(1);
    await attachStory(text);finishAnalysis(0);await flush();expect(h.analyses).toHaveLength(1);
    expect(h.images).toHaveLength(3);expect(parseImageTags(h.ctx.chat[1].mes)).toHaveLength(3);
    expect(h.ctx.chat[1].mes).toContain(metadata);
  });
  it('excludes metadata from required supplements and keeps the caller request exactly at the missing minimum',async()=>{
    Object.assign(settings.autoTag,{minImages:2,maxImages:5});
    const text='她开门。\n[img: 门口]\n两人来到广场。\n<summary>摘要不得选图。</summary>\n<UpdateVariable>变量不得选图。</UpdateVariable>';
    await pendingStory(text);finishAnalysis(0);await flush();expect(h.analyses).toHaveLength(2);
    expect(h.analyses[1].m[0].options).toMatchObject({minImages:1,maxImages:1});
    expect(h.analyses[1].m[0].content).toContain('来到广场');expect(h.analyses[1].m[0].content).not.toMatch(/摘要不得|变量不得/);
  });
  it('keeps earlier continuity facts without repeating the complete current batch in its task note',async()=>{
    Object.assign(settings.autoTag,{maxImages:6,streamAnalysisConcurrency:1});
    const text='她穿白裙，持钥匙。\n[img: 钥匙]\n她走过街道。\n[img: 街道]\n她来到车站。\n[img: 车站]\n她用钥匙推开车站的门。\n[img: 推门]\n他跟上来。\n[img: 同行]\n两人入内。\n[img: 入内]';
    beginStreamSession('A');feedStreamText(text);await flush();finishAnalysis(0);await flush();const request=h.analyses[1].m[0];
    expect(request.content).toContain('她用钥匙推开车站的门。');expect(request.note).toContain('她穿白裙，持钥匙。');expect(request.note).not.toContain('她用钥匙推开车站的门。');
  });
});
