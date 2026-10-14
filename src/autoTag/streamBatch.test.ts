import { describe, it, expect } from 'vitest';
import { prepareStreamBatch, splitStreamBatch } from './streamBatch';
import { parseImagePlan } from './protocol';
import { buildAutoTagMessages, captureAutoTagEnvironment, expandNlSections } from './prompt';
import { settings, DEFAULT_NAI_V5_SPEC, DEFAULT_NAI_V5_THINKING } from '@/state/settings';
import type { STContext } from '@/st/context';
const jobs=[{id:'a',input:{raw:'',intent:'门口',text:'她开门。\n<bbi_image><tag>old</tag></bbi_image>\n他递来钥匙。',prefix:'她穿白裙。',sourceLine:10}},
  {id:'b',input:{raw:'',intent:'出发',text:'他们离开车站。',prefix:'',sourceLine:20}}];
describe('paired marker planning',()=>{
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
});
