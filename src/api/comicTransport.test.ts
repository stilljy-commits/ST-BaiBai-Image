import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('@/st/context',()=>({getContext:()=>({getRequestHeaders:()=>({'Content-Type':'application/json'})})}));
import {readSseContent,requestCompletion} from './client';
import type {ApiChannel} from '@/state/settings';
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const frame=(content:string)=>new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');
const channel:ApiChannel={id:'c',name:'c',url:'https://api.deepseek.com/v1',key:'dummy-credential',model:'deepseek-flash',temperature:1,maxTokens:2000,timeoutSec:60,stream:false,excludeParams:[],reasoningEffort:'max'};
afterEach(()=>vi.unstubAllGlobals());
describe('incremental comic transport',()=>{
 it('delivers final-answer chunks before EOF and never emits native thought chunks',async()=>{
  let controller!:ReadableStreamDefaultController<Uint8Array>;const response=new Response(new ReadableStream({start(c){controller=c;}}));
  const seen:string[]=[],pending=readSseContent(response,text=>seen.push(text));
  controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'not final output'}}]})+'\n\n'));
  controller.enqueue(frame('{"pages":['));await flush();expect(seen).toEqual(['{"pages":[']);
  controller.enqueue(frame(']}'));controller.close();expect(await pending).toBe('{"pages":[]}');expect(seen.at(-1)).toBe('{"pages":[]}');
 });
 it('propagates consumer errors instead of silently swallowing them as JSON parse failures',async()=>{
  let cancelled=false;const response=new Response(new ReadableStream({start(c){c.enqueue(frame('answer'));},cancel(){cancelled=true;}}));
  await expect(readSseContent(response,()=>{throw Error('caller validation');})).rejects.toThrow('caller validation');expect(cancelled).toBe(true);
 });
 it('changes only this request reasoning and stream while using the correct channel credential',async()=>{
  const fetch=vi.fn(async(_url:unknown,_init?:RequestInit)=>new Response(new ReadableStream({start(c){c.enqueue(frame('ok'));c.close();}})));
  vi.stubGlobal('fetch',fetch);const before=JSON.stringify(channel);
  await requestCompletion(channel,[{role:'user',content:'ordinary travel scene'}],{stream:true,reasoningOverride:{thinking:{type:'disabled'}}});
  const body=JSON.parse(fetch.mock.calls[0][1]!.body as string);
  expect(body).toMatchObject({chat_completion_source:'custom',custom_url:channel.url,stream:true});
  expect(JSON.parse(body.custom_include_body)).toEqual({thinking:{type:'disabled'}});
  expect(JSON.parse(body.custom_include_headers)).toEqual({Authorization:'Bearer dummy-credential'});
  expect(body).not.toHaveProperty('proxy_password');expect(JSON.stringify(channel)).toBe(before);
 });
});
