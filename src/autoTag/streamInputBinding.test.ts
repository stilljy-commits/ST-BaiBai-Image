import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any,target:null as any,begin:vi.fn(),feed:vi.fn(),done:vi.fn(),reconcile:vi.fn(async()=>true),stop:vi.fn()}));
vi.mock('@/st/context',async original=>({...await original<typeof import('@/st/context')>(),getContext:()=>h.ctx}));
vi.mock('@/autoTag/streamRunner',()=>({beginStreamSession:h.begin,feedStreamText:h.feed,finishStreamInput:h.done,markStreamHostFinished:vi.fn(),streamRecoveryTarget:()=>h.target,
  reconcileStreamFloor:h.reconcile,cancelStreamSessions:vi.fn(),stopCurrentStream:h.stop,invalidateStreamOwners:vi.fn()}));
vi.mock('@/floor/generateSlot',()=>({startMarkedFloorGeneration:vi.fn()}));
class Bus {
  handlers=new Map<string,Array<(...args:any[])=>any>>();
  on(event:string,fn:(...args:any[])=>any){const list=this.handlers.get(event)||[];list.push(fn);this.handlers.set(event,list);}
  async emit(event:string,...args:any[]){for(const fn of [...(this.handlers.get(event)||[])])await fn(...args);}
}
const events={GENERATION_STARTED:'start',GENERATION_ENDED:'end',GENERATION_STOPPED:'stop',CHARACTER_MESSAGE_RENDERED:'render',CHAT_CHANGED:'chat',
  MESSAGE_DELETED:'delete',MESSAGE_SWIPED:'swipe',STREAM_TOKEN_RECEIVED:'token'};
let bus:Bus,win:EventTarget&{fetch:typeof fetch;location:{href:string}},doc:EventTarget&{visibilityState:string};
let fetchOriginal:ReturnType<typeof vi.fn>,bind:()=>void;
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const raw='data: {"choices":[{"delta":{"content":"女主走进房间。\\n[img: 进入房间]"}}]}\n\ndata: [DONE]\n\n';
beforeEach(async()=>{
  vi.resetModules();vi.clearAllMocks();vi.stubGlobal('localStorage',{getItem:()=>null});vi.stubGlobal('toastr',{warning:vi.fn()});
  h.target=null;bus=new Bus();fetchOriginal=vi.fn(async()=>new Response(raw,{headers:{'content-type':'text/event-stream'}}));
  win=Object.assign(new EventTarget(),{fetch:fetchOriginal as typeof fetch,location:{href:'http://tt.local/'}});
  doc=Object.assign(new EventTarget(),{visibilityState:'visible',createElement:()=>({}),getElementById:()=>null,querySelector:()=>null});vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
  h.ctx={getCurrentChatId:()=> 'A',eventSource:bus,eventTypes:events,chat:[{name:'User',is_user:true,mes:'继续'}]};
  const {settings}=await import('@/state/settings');settings.enabled=true;settings.autoTag.enabled=true;settings.autoTag.streamGen=true;
  bind=(await import('./runner')).bindAutoTagging;
});
afterEach(()=>{win.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();});
const request=()=>win.fetch('/api/backends/chat-completions/generate',{method:'POST',body:JSON.stringify({type:'normal',stream:true})});

describe('automatic tag binding with independent input',()=>{
  it('feeds the main response while an earlier host stream-event listener remains blocked',async()=>{
    let release!:()=>void;const gate=new Promise<void>(r=>release=r);bus.on('token',()=>gate);bind();await bus.emit('start','normal',{},false);
    const blocked=bus.emit('token','女主走进房间。\n[img: 进入房间]');const response=await request();
    await vi.waitFor(()=>expect(h.done).toHaveBeenCalledOnce());expect(h.feed).toHaveBeenCalledWith('女主走进房间。\n[img: 进入房间]');
    expect(h.reconcile).not.toHaveBeenCalled();release();await blocked;expect(h.feed).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe(raw);expect(fetchOriginal).toHaveBeenCalledTimes(1);
  });
  it('reconciles on foreground recovery before the late rendered event and does not reconcile twice',async()=>{
    bind();await bus.emit('start','normal',{},false);const response=await request();await vi.waitFor(()=>expect(h.done).toHaveBeenCalledOnce());
    h.target={chatId:'A',floor:1,type:'normal'};win.dispatchEvent(new Event('focus'));await flush();expect(h.reconcile).toHaveBeenCalledOnce();
    await bus.emit('render',1,'normal');expect(h.reconcile).toHaveBeenCalledOnce();await response.text();
  });
  it('finishes the host-event fallback on generation-ended instead of waiting for rendering',async()=>{
    bind();await bus.emit('start','normal',{},false);await bus.emit('token','女主走进房间。\n[img: 进入房间]');
    h.target={chatId:'A',floor:1,type:'normal'};await bus.emit('end',2);expect(h.done).toHaveBeenCalledOnce();expect(h.reconcile).toHaveBeenCalledOnce();
  });
  it('does not let an unrelated quiet end flush the still-active main stream',async()=>{
    bind();await bus.emit('start','normal',{},false);h.ctx.streamingProcessor={messageId:1,isFinished:false};await bus.emit('end',2);
    expect(h.done).not.toHaveBeenCalled();expect(h.reconcile).not.toHaveBeenCalled();
  });
  it('cancels observation on stop while leaving the already returned main response readable',async()=>{
    let controller!:ReadableStreamDefaultController<Uint8Array>;
    fetchOriginal.mockResolvedValueOnce(new Response(new ReadableStream({start:c=>controller=c}),{headers:{'content-type':'text/event-stream'}}));
    bind();await bus.emit('start','normal',{},false);const response=await request();await bus.emit('stop');
    controller.enqueue(new TextEncoder().encode(raw));controller.close();expect(await response.text()).toBe(raw);await flush();
    expect(h.feed).not.toHaveBeenCalled();expect(h.done).not.toHaveBeenCalled();expect(h.stop).toHaveBeenCalledOnce();
  });
});
