import {describe,it,expect} from 'vitest';
import {comicReasoningCapability,comicReasoningKey,comicReasoningOverride,normalizeComicReasoningMap} from './comicReasoning';
import type {ApiChannel} from '@/state/settings';
const channel:ApiChannel={id:'secondary',name:'test',provider:'openai',url:'https://api.deepseek.com/v1',key:'not-for-key',model:'deepseek-flash',temperature:1,maxTokens:1000,timeoutSec:60,stream:false,excludeParams:[],reasoningEffort:'max'};
describe('per model task reasoning preferences',()=>{
 it('keeps follow byte compatible and overrides only task request fields',()=>{
  const before=JSON.stringify(channel);expect(comicReasoningOverride(channel,'follow')).toBeUndefined();
  expect(comicReasoningOverride(channel,'off')).toEqual({thinking:{type:'disabled'}});
  expect(comicReasoningOverride(channel,'low')).toEqual({thinking:{type:'enabled'},reasoning_effort:'low'});expect(JSON.stringify(channel)).toBe(before);
 });
 it('scopes choices by connection and model without persisting credentials',()=>{
  expect(comicReasoningKey(channel)).not.toContain('not-for-key');
  expect(comicReasoningKey({...channel,url:'https://user:pass@api.deepseek.com/v1?key=secret'})).not.toMatch(/pass|secret/);
  expect(comicReasoningKey({...channel,model:'other'})).not.toBe(comicReasoningKey(channel));
  expect(comicReasoningKey({...channel,id:'another'})).not.toBe(comicReasoningKey(channel));
  expect(comicReasoningKey(channel,'fast')).toBe(comicReasoningKey(channel));
  expect(comicReasoningKey(channel,'standard')).not.toBe(comicReasoningKey(channel));
  expect(comicReasoningKey(channel,'standard')).not.toBe(comicReasoningKey(channel,'simple'));
 });
 it('does not send DeepSeek parameters to unknown endpoints or unrecognized model aliases',()=>{
  expect(comicReasoningOverride({...channel,url:'https://proxy.example/v1'},'off')).toBeUndefined();
  expect(comicReasoningOverride({...channel,model:'some-future-model'},'low')).toBeUndefined();
  expect(comicReasoningOverride(null,'off')).toBeUndefined();
 });
 it('uses the host Vertex mapper without pretending minimal Gemini 3 is fully disabled',()=>{
  const vertex={...channel,provider:'vertexai' as const,url:'',model:'gemini-3.7-flash'};
  expect(comicReasoningCapability(vertex)).toMatchObject({low:true,off:false});expect(comicReasoningOverride(vertex,'off')).toBeUndefined();
  expect(comicReasoningOverride(vertex,'low')).toEqual({reasoning_effort:'low'});
  expect(comicReasoningOverride({...vertex,model:'gemini-2.5-flash'},'off')).toEqual({reasoning_effort:'min'});
  expect(comicReasoningCapability({...vertex,model:'unknown-model'})).toMatchObject({low:false,off:false});
  for(const model of ['gemini-3.99-flash','gemini-3-flash-image','gemini-2.5-flash-live'])expect(comicReasoningCapability({...vertex,model})).toMatchObject({low:false,off:false});
 });
 it('normalizes stored maps without converting arbitrary truthy values to a mode',()=>{
  expect(normalizeComicReasoningMap({a:'off',b:'low',c:'follow',d:'none',e:true})).toEqual({a:'off',b:'low',c:'follow'});
  expect(normalizeComicReasoningMap([])).toEqual({});
  expect(normalizeComicReasoningMap({a:'adaptive'})).toEqual({});
 });
});
