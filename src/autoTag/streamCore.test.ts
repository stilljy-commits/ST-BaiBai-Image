import { describe, it, expect, vi } from 'vitest';
import { StreamRun } from './streamCore';

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const input={raw:'[img: 门口相见]',intent:'门口相见',text:'她打开门。',prefix:'',sourceLine:0};
describe('streamed task lifetime',()=>{
  it('attaches without waiting for analysis, then saves the same late task once',async()=>{
    const analysis=deferred<string>(),image=deferred<string>();
    const commit=vi.fn(async job=>!!job.result),generate=vi.fn(()=>image.promise),release=vi.fn();
    const run=new StreamRun('run',3,2,true,{analyze:()=>analysis.promise,generate,commit,changed:()=>{},release});
    const job=run.add(input)!;run.attach([job]);expect(job.phase).toBe('analyzing');expect(commit).not.toHaveBeenCalled();
    analysis.resolve('prompt');await flush();expect(generate).toHaveBeenCalledTimes(1);expect(commit).toHaveBeenCalledTimes(1);
    image.resolve('image');await run.settled();expect(job.saved).toBe(true);expect(release).toHaveBeenCalledOnce();
    expect(commit.mock.calls.filter(([j])=>j.result)).toHaveLength(1);
  });
  it('snapshots commits when image arrives during tag write, avoiding double persistence',async()=>{
    const image=deferred<string>(),write=deferred<void>();let writes=0,saves=0;
    const run=new StreamRun<string,string>('race',1,1,true,{analyze:async()=>'prompt',generate:()=>image.promise,
      commit:async job=>{if(++writes===1)await write.promise;if(job.result){saves++;return true;}return false;},changed:()=>{},release:()=>{}});
    const job=run.add(input)!;run.attach([job]);await flush();image.resolve('image');await flush();write.resolve();await run.settled();
    expect(saves).toBe(1);expect(job.saved).toBe(true);
  });
  it('keeps independent identities when identical intentions finish out of order',async()=>{
    const first=deferred<string>(),second=deferred<string>();const seen:string[]=[];
    const run=new StreamRun<string,string>('order',2,2,true,{analyze:job=>job.ordinal?second.promise:first.promise,generate:async p=>p,
      commit:async job=>{if(job.result)seen.push(job.id);return !!job.result;},changed:()=>{},release:()=>{}});
    const a=run.add(input)!,b=run.add(input)!;run.attach([a,b]);second.resolve('second');await flush();first.resolve('first');await run.settled();
    expect(a.id).not.toBe(b.id);expect(seen).toEqual([b.id,a.id]);
  });
  it('respects automatic-image off while explicit retry starts one image',async()=>{
    const generate=vi.fn(async()=>'image');const run=new StreamRun<string,string>('tags',1,1,false,{analyze:async()=>'prompt',generate,
      commit:async job=>!!job.result,changed:()=>{},release:()=>{}});
    const job=run.add(input)!;run.attach([job]);await run.settled();expect(generate).not.toHaveBeenCalled();expect(job.phase).toBe('pending');
    run.retry(job);run.retry(job);await run.settled();expect(generate).toHaveBeenCalledOnce();expect(job.saved).toBe(true);
  });
  it('does not write cancelled late results and releases them',async()=>{
    const image=deferred<string>(),commit=vi.fn(async job=>!!job.result),release=vi.fn();
    const run=new StreamRun<string,string>('cancel',1,1,true,{analyze:async()=>'prompt',generate:()=>image.promise,commit,changed:()=>{},release});
    const job=run.add(input)!;run.attach([job]);await flush();run.cancel();image.resolve('late');await run.settled();
    expect(commit.mock.calls.filter(([j])=>j.result)).toHaveLength(0);expect(release).toHaveBeenCalledOnce();
  });
  it('bounds analysis concurrency and total accepted slots',async()=>{
    const a=deferred<string>(),b=deferred<string>(),c=deferred<string>();let running=0,peak=0;
    const run=new StreamRun<string,string>('budget',3,2,false,{analyze:async job=>{peak=Math.max(peak,++running);const p=await [a,b,c][job.ordinal].promise;running--;return p;},
      generate:async p=>p,commit:async()=>false,changed:()=>{},release:()=>{}});
    run.add(input);run.add(input);run.add(input);expect(run.add(input)).toBeNull();expect(peak).toBe(2);
    a.resolve('a');await flush();b.resolve('b');c.resolve('c');await run.settled();expect(peak).toBe(2);
  });
  it('retains an obtained image for persistence retry without generating again',async()=>{
    const generate=vi.fn(async()=>'image');let fail=true;
    const run=new StreamRun<string,string>('save',1,1,true,{analyze:async()=>'prompt',generate,commit:async job=>{if(job.result&&fail)throw Error('save failed');return !!job.result;},changed:()=>{},release:()=>{}});
    const job=run.add(input)!;run.attach([job]);await run.settled();expect(job.result).toBe('image');expect(job.phase).toBe('error');
    fail=false;run.retry(job);await run.settled();expect(job.saved).toBe(true);expect(generate).toHaveBeenCalledOnce();
  });
});
