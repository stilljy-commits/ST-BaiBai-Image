import {describe,it,expect} from 'vitest';
import {buildNaiParameters} from '@/backends/nai';
import {settings,type NaiSettings} from '@/state/settings';
import {parseImagePlan} from '@/autoTag/protocol';
import {applyPositionedCharRefs} from '@/autoTag/charAnchors';
import {compileComicPage} from '@/autoTag/compactComic';
import {prepareStreamBatch} from '@/autoTag/streamBatch';
import {finalizeComicPlan} from './plan';
import {parseImageTagContent,serializeImageTag} from '@/st/imageTagRegex';
import type {CharTagEntry} from '@/state/charTags';
const names=['甲','乙'];
const entries:CharTagEntry[]=names.map((name,i)=>({name,fields:{sex:'girl',fandom:'',hair:i?'brown hair':'silver hair',eyes:'green eyes',skin:'',body:'',extra:'',outfit:i?'blue coat':'red coat'},raw:'',nl:'',history:[],source:'manual',desc:''}));
const batch=prepareStreamBatch([{id:'a',input:{text:'成年旅人甲和乙在车站交接地图。',prefix:'',raw:'',intent:'递地图',sourceLine:10}}],[],true);
const fields={position:'M1',nl:'',negative:'',size:'portrait'};
const v1='<image>\n@page\nSFW, 2girls, comic, 2 panels\n@panel P1\nThis is the upper right panel. Medium shot.\n@character C1 甲\ngirl, holding a map\n@outfit\nred coat\n@negative\nblue coat\n@panel P2\nThis is the lower main panel. Medium shot.\n@character C2 乙\ngirl, receiving a map\n@outfit\nblue coat\n@negative\nred coat\n</image>';
describe('same per-person rendering pipeline in every comic analysis mode',()=>{
 for(const mode of ['standard','simple','fast'] as const)for(const comicV2 of [false,true]){
  it(`${mode} ${comicV2?'V2':'V1'} preserves clothing, locations and exclusions through save/load and actual NAI assembly`,()=>{
   const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2,comicAnalysisMode:mode,comicText:false,comicPanelStyle:'universal',activeArtistId:'',undesiredContent:'',qualityTags:''};
   const plan=mode==='fast'?compileComicPage({id:'M1',scene:'station, afternoon',profiles:[],changes:[],layout:'grid',shots:names.map((name,i)=>({camera:'medium shot',actors:[{name,action:i?'receiving a map':'holding a map',face:'front',omit:[],outfit:i?'blue coat':'red coat',negative:i?'red coat':'blue coat'}]}))},
    {nai,target:batch.target,markers:batch.markerTargets,entries,locked:new Set(),size:'portrait',min:1,max:1}).plan:
    parseImagePlan(JSON.stringify({changes:[],images:[{...fields,tag:comicV2?'SFW, 2girls, comic, 2 panels, station':v1,characters:comicV2?names.map((name,i)=>({name,tag:'girl, medium shot, '+(i?'receiving a map':'holding a map'),nl:'',outfit:i?'blue coat':'red coat',negative:i?'red coat':'blue coat',panel:i?'This is the upper left panel.':'This is the upper right panel.'})):[]}]}),batch.target.segments,1,1,batch.markerTargets);
   for(const image of plan.images)image.tag=applyPositionedCharRefs(image.tag,entries,[],image.sourceLine,'tag',new Set()).text;
   if(mode!=='fast')finalizeComicPlan(plan,entries);
   const saved=parseImageTagContent(serializeImageTag(plan.images[0]));
   const params=buildNaiParameters(nai,{prompt:saved.tag,characters:saved.characters,seed:42});
   const positive=(params.v4_prompt as any).caption,negative=(params.v4_negative_prompt as any).caption;
   expect(positive.char_captions).toHaveLength(2);expect(negative.char_captions).toHaveLength(2);
   expect(positive.base_caption).not.toMatch(/red coat|blue coat|@character|@negative/);
   expect(positive.char_captions[0].char_caption).toContain('red coat');expect(positive.char_captions[1].char_caption).toContain('blue coat');
   expect(positive.char_captions.every((c:any)=>c.char_caption.includes('panel'))).toBe(true);
   expect(negative.char_captions.map((c:any)=>c.char_caption)).toEqual(['blue coat','red coat']);
  });
 }
 it('respects Medium limits without changing the selected model or injecting unsupported custom negatives',()=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full-medium',comicMode:true,comicV2:true,comicText:false};
  const params=buildNaiParameters(nai,{prompt:'SFW, 2girls, comic',characters:[{name:'甲',tag:'girl, red coat',nl:'',negative:'blue coat'}],seed:42});
  expect((params.v4_negative_prompt as any).caption.char_captions[0].char_caption).toBe('');
  expect(nai.model).toBe('nai-diffusion-5-full-medium');expect(params.steps).toBe(14);
 });
 it('changes only conflicting built-in negatives and preserves explicit artist/channel preferences',()=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2:true,comicText:true,activeArtistId:'',undesiredContent:'',qualityTags:''};
  const normal=buildNaiParameters(nai,{prompt:'SFW, comic, text',seed:42});expect(normal.negative_prompt).not.toMatch(/\btext\b|multiple views/);
  const custom=buildNaiParameters({...nai,undesiredContent:'multiple views, text, my custom preference'},{prompt:'SFW, comic',seed:42});
  expect(custom.negative_prompt).toBe('multiple views, text, my custom preference');
 });
 it('keeps V1 non-character dialogue separate from quality words and never puts exclusions in positive captions',()=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2:false,comicText:true,activeArtistId:'',qualityTags:'my quality',undesiredContent:''};
  const prompt=v1.replace('2 panels\n@panel','2 panels\n@non_character\nnarration\nText: 车站。\n@panel');
  const params=buildNaiParameters(nai,{prompt,seed:42}),caption=(params.v4_prompt as any).caption;
  expect(caption.base_caption).toContain('my quality\nText: 车站。');expect(caption.base_caption).not.toContain('blue coat');
  expect(caption.char_captions[0].char_caption).not.toContain('blue coat');
 });
});
