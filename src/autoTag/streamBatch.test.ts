import { describe, it, expect } from 'vitest';
import { prepareStreamBatch, splitStreamBatch } from './streamBatch';
import { parseImagePlan } from './protocol';
import { buildAutoTagMessages, captureAutoTagEnvironment, expandNlSections } from './prompt';
import { settings, DEFAULT_NAI_V5_SPEC, DEFAULT_NAI_V5_THINKING, DEFAULT_NAI_COMIC_SPEC, DEFAULT_NAI_COMIC_THINKING, DEFAULT_NAI_COMIC_V2_SPEC, DEFAULT_NAI_COMIC_V2_THINKING, DEFAULT_NAI_COMIC_UNIVERSAL_GRAMMAR } from '@/state/settings';
import type { STContext } from '@/st/context';
const jobs=[{id:'a',input:{raw:'',intent:'门口',text:'她开门。\n<bbi_image><tag>old</tag></bbi_image>\n他递来钥匙。',prefix:'她穿白裙。',sourceLine:10}},
  {id:'b',input:{raw:'',intent:'出发',text:'他们离开车站。',prefix:'',sourceLine:20}}];
describe('batched marker planning',()=>{
  it.each([false,true])('keeps complete comic V2=%s specs, output schema and facts with a shorter marker decision summary',async(comicV2)=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    const profile={nl:false,naiCharPrompts:true,lockedSize:'portrait' as const};
    const environment=captureAutoTagEnvironment(profile);environment.backend='nai';Object.assign(environment.nai,{model:'nai-diffusion-5-full',comicMode:true,comicV2});
    const ctx={chat:[{name:'Char',is_user:false,is_system:false,mes:'正文'}],name1:'User',name2:'Char',chatMetadata:{}} as unknown as STContext;
    const options={...settings.autoTag,minImages:2,maxImages:2};
    const ordinary=await buildAutoTagMessages(ctx,0,options,null,batch.target,'角色库',batch.instructions,profile,environment);
    const marked=await buildAutoTagMessages(ctx,0,options,null,batch.target,'角色库',batch.instructions,profile,environment,'fixed-markers');
    const oldThinking=comicV2?DEFAULT_NAI_COMIC_V2_THINKING:DEFAULT_NAI_COMIC_THINKING;
    const index=ordinary.findIndex(message=>message.content===oldThinking);expect(index).toBeGreaterThan(-1);
    const contractIndex=ordinary.findIndex(message=>message.content.startsWith('你是严谨的剧情画面规划'));
    expect(marked.filter((_,i)=>i!==index&&i!==contractIndex)).toEqual(ordinary.filter((_,i)=>i!==index&&i!==contractIndex));
    const updated=marked[index].content;
    expect(updated).toContain('每个标记恰好一页');expect(updated).toContain('所属标记的可用 P 编号');
    expect(updated).not.toContain('把目标正文按事件节拍切成');
    expect(updated).not.toContain('第二层|逐页槽位块');
    expect(updated).toContain('不再输出整套角色名单');
    expect(updated).toContain('含不入画者');
    expect(updated).toContain('不把后文状态提前套用');
    expect(updated).toContain('完整分镜直接写入最终 JSON');
    expect(updated).toContain('全部逐图自检与必要纠错');
    expect(marked.some(message=>message.content.includes(comicV2?DEFAULT_NAI_COMIC_V2_SPEC:DEFAULT_NAI_COMIC_SPEC))).toBe(true);
    expect(marked.some(message=>message.content.includes(DEFAULT_NAI_COMIC_UNIVERSAL_GRAMMAR))).toBe(true);
    const contract=marked[contractIndex].content;
    expect(contract).not.toContain('再选图');
    expect(contract).toContain('不得增删页数、合并或遗漏标记');
    // The format example and maintenance rules remain exact, except that archive hits
    // are decisions rather than a mandatory written proof for every known character.
    const sample=(content:string)=>JSON.parse(content.match(/格式固定为：\n([^\n]+)\n/)![1]);
    expect(sample(contract)).toEqual(sample(ordinary[contractIndex].content));
    const maintenance=(content:string)=>content.slice(content.indexOf('7. 角色状态与 changes：')).split('\n').filter(line=>!line.includes('“已建档”只能按'));
    expect(maintenance(contract)).toEqual(maintenance(ordinary[contractIndex].content));
    expect(contract).toContain('含不入画者');
    expect(contract).toContain('未命中就在 changes 中输出 field:"new"');
    expect(contract).toContain('不另写命中名单或证明');
    expect(marked.at(-1)?.content).toBe(ordinary.at(-1)?.content);
  });
  it.each([false,true])('retains captured style, custom rules, text suppression and change positions in compact comic V2=%s prompts',async(comicV2)=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    const profile={nl:false,naiCharPrompts:true,lockedSize:'landscape' as const};
    const environment=captureAutoTagEnvironment(profile);environment.backend='nai';
    Object.assign(environment.nai,{model:'nai-diffusion-5-full',comicMode:true,comicV2,comicText:false,comicPanelStyle:'yonkoma',comicGutter:'boxed',comicLighting:true,comicExtraRules:'TEST_CUSTOM_RULE: preserve the red umbrella.'});
    const ctx={chat:[{name:'Char',is_user:false,is_system:false,mes:'正文'}],name1:'User',name2:'Char',chatMetadata:{}} as unknown as STContext;
    const messages=await buildAutoTagMessages(ctx,0,{...settings.autoTag,minImages:2,maxImages:2},null,batch.target,'角色库',batch.instructions,profile,environment,'fixed-markers');
    const text=messages.map(message=>message.content).join('\n');
    for(const rule of ['TEST_CUSTOM_RULE: preserve the red umbrella.','经典四格','全封闭内枠','连续场景光影','本会话已关闭对白上画','永久变化的 position 是新状态开始生效的位置','含不入画者'])expect(text).toContain(rule);
    const contract=messages.find(message=>message.content.startsWith('你是严谨的剧情画面规划'))!.content;
    const sample=JSON.parse(contract.match(/格式固定为：\n([^\n]+)\n/)![1]).images[0];
    expect(sample.size).toBe('landscape');expect(sample.tag).not.toMatch(/Text:|Chinese text|speech bubble/i);
    expect(JSON.stringify(sample.characters)).not.toMatch(/Text:|speech bubble/i);
    expect(sample.characters).toHaveLength(comicV2?2:0);
    // A brief summary does not interfere with the parser or the permanent-change timeline.
    const plan=parseImagePlan('<thinking>沿用已知状态。</thinking>'+JSON.stringify({images:[{...sample,position:'P3'},{...sample,position:'P2'}],changes:[{name:'小雪',field:'hair',value:'short red hair',position:'P2'}]}),batch.target.segments,2,2);
    expect(splitStreamBatch(plan,batch).map(image=>image.sourceLine)).toEqual([12,20]);
    expect(plan.changes[0].sourceLine).toBe(12);
  });
  it('leaves illustration analysis unchanged when fixed markers are provided',async()=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    const profile={nl:false,naiCharPrompts:true,lockedSize:'portrait' as const};
    const environment=captureAutoTagEnvironment(profile);environment.backend='nai';environment.nai.comicMode=false;
    const ctx={chat:[{name:'Char',is_user:false,is_system:false,mes:'正文'}],name1:'User',name2:'Char',chatMetadata:{}} as unknown as STContext;
    const options={...settings.autoTag,minImages:2,maxImages:2};
    const ordinary=await buildAutoTagMessages(ctx,0,options,null,batch.target,'角色库',batch.instructions,profile,environment);
    const marked=await buildAutoTagMessages(ctx,0,options,null,batch.target,'角色库',batch.instructions,profile,environment,'fixed-markers');
    expect(marked).toEqual(ordinary);
  });
  it('shares global checks while retaining the complete comic V2 spec and thinking checklist',async()=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    const profile={nl:false,naiCharPrompts:true,lockedSize:'portrait' as const};
    const environment=captureAutoTagEnvironment(profile);environment.backend='nai';environment.nai.model='nai-diffusion-5-full';environment.nai.comicMode=true;environment.nai.comicV2=true;
    const ctx={chat:[{name:'Char',is_user:false,is_system:false,mes:'正文'}],name1:'User',name2:'Char',chatMetadata:{}} as unknown as STContext;
    const messages=await buildAutoTagMessages(ctx,0,{...settings.autoTag,minImages:2,maxImages:2},null,batch.target,'角色库',batch.instructions,profile,environment);
    expect(messages.some(message=>message.content.includes(DEFAULT_NAI_COMIC_V2_SPEC))).toBe(true);
    expect(messages.some(message=>message.content===DEFAULT_NAI_COMIC_V2_THINKING)).toBe(true);
    expect(batch.instructions).toContain('只统一执行一次');expect(batch.instructions).toContain('全部逐图自检');expect(batch.instructions).toContain('保留必要复核与纠错');
  });
  it('keeps the complete model spec, thinking and facts in the real prompt builder',async()=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    const profile={nl:false,naiCharPrompts:true,lockedSize:'portrait' as const};
    const environment=captureAutoTagEnvironment(profile);environment.backend='nai';environment.nai.comicMode=false;
    const options={...settings.autoTag,minImages:2,maxImages:2,prompts:{...settings.autoTag.prompts,naiV5Spec:'',naiV5Thinking:''}};
    const ctx={chat:[{name:'Char',is_user:false,is_system:false,mes:jobs.map(job=>job.input.text).join('\n')}],name1:'User',name2:'Char',chatMetadata:{}} as unknown as STContext;
    const messages=await buildAutoTagMessages(ctx,0,options,null,batch.target,'固定角色外貌资料',batch.instructions,profile,environment);
    expect(messages.some(message=>message.content===expandNlSections(DEFAULT_NAI_V5_SPEC,false))).toBe(true);
    expect(messages.some(message=>message.content===expandNlSections(DEFAULT_NAI_V5_THINKING,false))).toBe(true);
    const last=messages.at(-1)!.content;expect(last).toContain('固定角色外貌资料');
    for(const fact of ['她开门。','他递来钥匙。','他们离开车站。','门口','出发'])expect(last).toContain(fact);
  });
  it('retains all target facts and maps unique positions to original physical lines',()=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    expect(batch.target.segments.map(s=>[s.id,s.sourceLine,s.text])).toEqual([['P1',10,'她开门。'],['P2',12,'他递来钥匙。'],['P3',20,'他们离开车站。']]);
    expect(batch.instructions).toContain('门口');expect(batch.instructions).toContain('出发');expect(batch.instructions).toContain('P1、P2');
    const plan=parseImagePlan(JSON.stringify({images:[{position:'P3',tag:'departure',characters:[]},{position:'P2',tag:'key',characters:[]}],changes:[]}),batch.target.segments,2,2);
    expect(splitStreamBatch(plan,batch).map(i=>[i.tag,i.sourceLine])).toEqual([['key',12],['departure',20]]);
  });
  it('rejects two images in one marker even if the overall image count is correct',()=>{
    const batch=prepareStreamBatch(jobs,['bbi_image']);
    const plan=parseImagePlan(JSON.stringify({images:[{position:'P1',tag:'a'},{position:'P2',tag:'b'}],changes:[]}),batch.target.segments,2,2);
    expect(()=>splitStreamBatch(plan,batch)).toThrow(/重复|错配/);
  });
  it('keeps independent owners in a three-marker part with reversed results',()=>{
    const batch=prepareStreamBatch([...jobs,{id:'c',input:{raw:'',intent:'到家',text:'她推开家门。',prefix:'',sourceLine:30}}],['bbi_image']);
    const plan=parseImagePlan(JSON.stringify({images:[{position:'P4',tag:'home'},{position:'P3',tag:'leave'},{position:'P2',tag:'keys'}],changes:[]}),batch.target.segments,3,3);
    expect(splitStreamBatch(plan,batch).map(image=>image.tag)).toEqual(['keys','leave','home']);
  });
});
