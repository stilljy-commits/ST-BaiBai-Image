import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
import {buildVertexRequest,currentVertexSettings,geminiText} from './vertex';
import {extractContent,readSseContent,requestCompletion,testChannel} from './client';
import type {ApiChannel} from '@/state/settings';
const channel:ApiChannel={id:'vertex',name:'Vertex',provider:'vertexai',vertexAuthMode:'full',vertexRegion:'global',vertexSecretId:'saved-credential-id',url:'',key:'OLD-UNRELATED-KEY',model:'gemini-test',temperature:1,maxTokens:8192,timeoutSec:60,stream:false,excludeParams:[],reasoningEffort:''};
const messages=[{role:'system' as const,content:'Return JSON only.'},{role:'user' as const,content:'A traveler walks into a station.'}];
beforeEach(()=>{h.ctx={getRequestHeaders:()=>({'content-type':'application/json'}),chatCompletionSettings:{chat_completion_source:'vertexai',vertexai_auth_mode:'full',vertexai_model:'gemini-test',vertexai_region:'global',secret_id:'saved-credential-id'}};});
afterEach(()=>vi.unstubAllGlobals());
describe('Vertex independent channels',()=>{
 it.each(['full','express'] as const)('uses saved host credentials in %s mode without copying keys',mode=>{
  const body=buildVertexRequest({...channel,vertexAuthMode:mode},messages,true);
  expect(body).toMatchObject({chat_completion_source:'vertexai',vertexai_auth_mode:mode,vertexai_region:'global',secret_id:'saved-credential-id',messages,model:'gemini-test',stream:true,use_sysprompt:true,tool_choice:'none'});
  for(const key of ['reverse_proxy','proxy_password','custom_include_headers','custom_include_body'])expect(body).not.toHaveProperty(key);
  expect(JSON.stringify(body)).not.toContain('OLD-UNRELATED-KEY');expect(body).not.toHaveProperty('reasoning_effort');
 });
 it('passes only explicit effort and keeps routing intact when exclusions contain identity fields',()=>{
  expect(buildVertexRequest({...channel,reasoningEffort:'low',excludeParams:['temperature','secret_id','chat_completion_source','stream']},messages,false)).toMatchObject({chat_completion_source:'vertexai',secret_id:'saved-credential-id',stream:false,reasoning_effort:'low'});
  expect(buildVertexRequest({...channel,excludeParams:['temperature']},messages,false)).not.toHaveProperty('temperature');
 });
 it('reads only whitelisted public settings without changing the main connection',()=>{
  h.ctx.chatCompletionSettings.proxy_password='PRIVATE';const before=JSON.stringify(h.ctx);
  expect(currentVertexSettings()).toEqual({provider:'vertexai',vertexAuthMode:'full',vertexRegion:'global',vertexSecretId:'saved-credential-id',model:'gemini-test'});
  expect(JSON.stringify(h.ctx)).toBe(before);
 });
 it('does not silently turn a proxy or another provider into direct Google',()=>{
  h.ctx.chatCompletionSettings.reverse_proxy='https://proxy.example';expect(()=>currentVertexSettings()).toThrow('反向代理');
  h.ctx.chatCompletionSettings.chat_completion_source='openai';expect(()=>currentVertexSettings()).toThrow('选择 Google Vertex');
 });
 it('accepts raw Gemini output without mixing thoughts or requiring OpenAI fields',()=>{
  const data={candidates:[{content:{parts:[{thought:true,text:'private thought'},{text:'{"images":'},{text:'[]}'}]}}]};
  expect(geminiText(data)).toBe('{"images":[]}');expect(extractContent(data)).toBe('{"images":[]}');
  expect(geminiText({candidates:[{content:{parts:[{thought:true,text:'not an answer'}]}}]})).toBe('');
 });
 it('parses split Gemini SSE, native thoughts, CRLF, and a final event without a newline',async()=>{
  const raw=['data: '+JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'ignore'}]}}]}),'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'你'}]}}]}),'data: '+JSON.stringify({candidates:[{content:{parts:[{text:'好'}]}}]})].join('\r\n\r\n');
  const bytes=new TextEncoder().encode(raw);const resp=new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
  await expect(readSseContent(resp)).resolves.toBe('你好');
 });
 it('makes a separate host request without generateRaw or an OpenAI base URL',async()=>{
  h.ctx.generateRaw=vi.fn();const fetch=vi.fn(async(_url:unknown,_options?:RequestInit)=>new Response(JSON.stringify({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:1}})));
  vi.stubGlobal('fetch',fetch);await expect(requestCompletion(channel,messages)).resolves.toBe('ok');
  expect(fetch).toHaveBeenCalledOnce();expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({chat_completion_source:'vertexai',messages});expect(h.ctx.generateRaw).not.toHaveBeenCalled();
 });
 it('does not retry Vertex errors against /v1 OpenAI alternate routes',async()=>{
  const fetch=vi.fn(async()=>new Response('missing saved credential',{status:404}));vi.stubGlobal('fetch',fetch);
  expect(await testChannel(channel)).toMatchObject({ok:false});expect(fetch).toHaveBeenCalledOnce();
 });
});
