import { afterEach, describe, expect, it } from 'vitest';
import { buildAutoTagMessages, captureAutoTagEnvironment } from './prompt';
import { prepareStreamBatch, splitStreamBatch } from './streamBatch';
import { parseImagePlan } from './protocol';
import { parseImageTagContent, serializeImageTag } from '@/st/imageTagRegex';
import { settings } from '@/state/settings';
import type { STContext } from '@/st/context';

const originalNai = JSON.parse(JSON.stringify(settings.nai));
afterEach(() => { Object.assign(settings.nai, JSON.parse(JSON.stringify(originalNai))); });

const jobs = [
  { id:'first', input:{text:'小雪走出车站。',intent:'走出车站',sourceLine:5,raw:'',prefix:''} },
  { id:'second', input:{text:'小雪把地图递给同伴。',intent:'递出地图',sourceLine:8,raw:'',prefix:''} },
  { id:'third', input:{text:'两人走过广场。',intent:'走过广场',sourceLine:11,raw:'',prefix:''} },
];
const ctx = {chat:[{name:'Char',is_user:false,is_system:false,mes:jobs.map(j=>j.input.text).join('\n')}],name1:'User',name2:'Char',chatMetadata:{}} as unknown as STContext;
function fixture(v2 = true, text = true, mode: 'simple' | 'standard' = 'simple', nl = false) {
  const profile = {naiCharPrompts:true,nl,lockedSize:'landscape' as const};
  const environment = captureAutoTagEnvironment(profile);
  environment.backend = 'nai';
  Object.assign(environment.nai,{model:'nai-diffusion-5-full',comicMode:true,comicV2:v2,comicText:text,comicAnalysisMode:mode,comicPanelStyle:'slice',comicNsfwRules:false,comicExtraRules:''});
  return {profile,environment};
}
async function build(v2 = true, text = true, fixed = true) {
  const {profile,environment} = fixture(v2,text);
  const batch = prepareStreamBatch(jobs,[],true);
  const messages = await buildAutoTagMessages(ctx,0,{...settings.autoTag,minImages:3,maxImages:3},null,batch.target,null,batch.instructions,profile,environment,fixed?'fixed-markers':'select-scenes');
  const prompt = messages.find(m=>m.content.startsWith('【漫画分析·简单模式】'))!.content;
  const sample = JSON.parse(prompt.match(/\n(\{"changes":\[\],"images":.*\})/)![1]);
  return {messages,prompt,sample,batch,environment,profile};
}

describe('switchable simple comic analysis',()=>{
  it.each([true,false])('keeps the native V2=%s format and maps three final images back to their markers',async(v2)=>{
    const {messages,prompt,sample,batch}=await build(v2);
    const raw=JSON.stringify({...sample,images:batch.groups.map(group=>({...sample.images[0],position:group.markerId}))});
    const plan=parseImagePlan(raw,batch.target.segments,3,3,batch.markerTargets);
    expect(splitStreamBatch(plan,batch).map(image=>image.sourceLine)).toEqual([5,8,11]);
    for (const image of plan.images) {
      expect(image.size).toBe('landscape');
      expect(image.characters).toHaveLength(v2?2:0);
      expect(image.tag.startsWith('<image>')).toBe(!v2);
      const restored=parseImageTagContent(serializeImageTag(image));
      expect(restored?.tag).toBe(image.tag);
      expect(restored?.characters).toEqual(image.characters);
    }
    expect(messages.some(m=>m.content.startsWith('你是严谨的剧情画面规划')||m.content.includes('【流式漫画页输出前思考清单】'))).toBe(false);
    expect(prompt).not.toContain('<thinking>');
    for (const job of jobs) expect(messages.at(-1)!.content).toContain(job.input.text);
  });

  it.each([true,false])('honors text on/off in V2=%s examples without weakening the output protocol',async(v2)=>{
    const on=await build(v2,true),off=await build(v2,false);
    expect(JSON.stringify(on.sample.images)).toContain('Text: 出发吧。');
    expect(JSON.stringify(off.sample.images)).not.toMatch(/Text:|speech bubble|chinese text/i);
    expect(off.sample.images[0].size).toBe('landscape');
    expect(off.prompt).toContain('本次关闭对白上画');
  });

  it.each([true,false])('uses P positions for whole-floor analysis in V2=%s',async(v2)=>{
    const {prompt,sample,batch}=await build(v2,true,false);
    expect(prompt).toContain('必须满足下限3页');
    expect(sample.images[0].position).toBe('P2');
    const plan=parseImagePlan(JSON.stringify(sample),batch.target.segments,1,3);
    expect(plan.images[0].sourceLine).toBe(8);
  });

  it('keeps four panels, user rules, profile requirements and the settings snapshot',async()=>{
    const {profile,environment}=fixture(true,true,'simple',true);
    environment.nai.comicPanelStyle='yonkoma';environment.nai.comicExtraRules='保留地图上的红色圆形标志。';
    settings.nai.comicAnalysisMode='standard';settings.nai.comicPanelStyle='slice';
    const messages=await buildAutoTagMessages(ctx,0,{...settings.autoTag},null,undefined,'小雪已有固定外貌',undefined,profile,environment);
    const prompt=messages.find(m=>m.content.startsWith('【漫画分析·简单模式】'))!.content;
    const sample=JSON.parse(prompt.match(/\n(\{"changes":\[\],"images":.*\})/)![1]);
    expect(sample.images[0].tag).toContain('4 panels');expect(sample.images[0].characters).toHaveLength(4);
    expect(prompt).toContain('保留地图上的红色圆形标志。');
    expect(prompt).toContain('每条field:"new"还必须附nl');
    expect(messages.at(-1)!.content).toContain('小雪已有固定外貌');
    expect(environment.nai.comicAnalysisMode).toBe('simple');
  });

  it('adapts built-in gutter terms for V2 while preserving editable legacy rules with their meaning',async()=>{
    const {profile,environment}=fixture();
    environment.nai.comicGutter='boxed';
    environment.nai.comicExtraRules='@character段的角色保留蓝围巾；@page保持车站地点。';
    const messages=await buildAutoTagMessages(ctx,0,{...settings.autoTag},null,undefined,undefined,undefined,profile,environment);
    const prompt=messages.find(m=>m.content.startsWith('【漫画分析·简单模式】'))!.content;
    const gutter=prompt.match(/【所选留白】([^\n]+)/)![1];
    expect(gutter).toContain('Base');expect(gutter).not.toContain('@page');
    expect(prompt).toContain(environment.nai.comicExtraRules);
    expect(prompt).toContain('@character指characters人物条目');
    expect(environment.nai.comicExtraRules).toBe('@character段的角色保留蓝围巾；@page保持车站地点。');
  });

  it('switches back to exactly the existing standard prompt and ignores the setting outside comic mode',async()=>{
    const {profile,environment}=fixture();const batch=prepareStreamBatch(jobs,[]);
    const args=[ctx,0,{...settings.autoTag,minImages:3,maxImages:3},null,batch.target,null,batch.instructions,profile] as const;
    delete environment.nai.comicAnalysisMode;
    const legacy=await buildAutoTagMessages(...args,environment,'fixed-markers');
    environment.nai.comicAnalysisMode='standard';
    expect(await buildAutoTagMessages(...args,environment,'fixed-markers')).toEqual(legacy);
    environment.nai.comicMode=false;
    const illustration=await buildAutoTagMessages(...args,environment,'fixed-markers');
    environment.nai.comicAnalysisMode='simple';
    expect(await buildAutoTagMessages(...args,environment,'fixed-markers')).toEqual(illustration);
    environment.nai.comicMode=true;environment.backend='comfyui';
    const comfy=await buildAutoTagMessages(...args,environment,'fixed-markers');
    environment.nai.comicAnalysisMode='standard';
    expect(await buildAutoTagMessages(...args,environment,'fixed-markers')).toEqual(comfy);
  });
});
