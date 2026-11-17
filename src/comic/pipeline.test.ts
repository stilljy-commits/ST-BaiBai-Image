import {describe,it,expect} from 'vitest';
import {buildNaiParameters} from '@/backends/nai';
import {settings,type NaiSettings} from '@/state/settings';
import {parseImagePlan} from '@/autoTag/protocol';
import {applyPositionedCharRefs} from '@/autoTag/charAnchors';
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
 it('anchors horseback embrace to both riders in the same panel only',()=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2:true};
  const panel='This is the large main panel.';
  const cutIn='This is the small upper right panel.';
  const raw={...fields,tag:`SFW, 1girl, 1boy, comic, 2 panels, ${panel} Medium shot, riders sharing one horse. ${cutIn} Close-up on her face.`,
   characters:[{name:'甲',panel,tag:'boy, pulling a cloak'},{name:'乙',panel,tag:'girl, covering her face'},
    {name:'乙',panel:cutIn,tag:'girl, close-up on her face'}],
   interactions:[{panel,source:'甲',target:'乙',action:'hug',sourcePose:'sitting behind her on the same horse, arms around her waist',
    targetPose:'sitting in front of him on the same horse, held around the waist from behind'},
    {panel:cutIn,source:'甲',target:'乙',action:'hug',sourcePose:'leaning forward',targetPose:'looking ahead'}],
  };
  const plan=parseImagePlan(JSON.stringify({changes:[],images:[raw]}),batch.target.segments,1,1,batch.markerTargets);
  finalizeComicPlan(plan,entries);
  const saved=serializeImageTag(plan.images[0]);
  expect(saved).not.toContain('sourcePose');
  const image=parseImageTagContent(saved);
  const caption=(buildNaiParameters(nai,{prompt:image.tag,characters:image.characters,seed:42}).v4_prompt as any).caption;
  const [rear,front,detail]=caption.char_captions.map((item:any)=>item.char_caption);
  expect(rear).toContain('source#hug, sitting behind her on the same horse, arms around her waist');
  expect(front).toContain('target#hug, sitting in front of him on the same horse, held around the waist from behind');
  expect(detail).not.toMatch(/#hug|looking ahead|same horse/);
 });

 it.each([true,false])('sends paired action tags to separate NAI character prompts in V2=%s',comicV2=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2};
  const actors=[{name:'甲',tag:'girl, source#hug, standing behind her',nl:''},{name:'乙',tag:'girl, target#hug, facing forward',nl:''}];
  const base='SFW, 2girls, comic, 1 panel, train station';
  const legacy=`<image>\n@page\n${base}\n@panel P1\nThis single panel fills the page.\n@character C1 甲\n${actors[0].tag}\n@character C2 乙\n${actors[1].tag}\n</image>`;
  const plan=parseImagePlan(JSON.stringify({changes:[],images:[{...fields,tag:comicV2?base:legacy,characters:comicV2?actors:[],
   visualState:{complete:true,facts:'两人在站台相遇',changes:{}}}]}),batch.target.segments,1,1,batch.markerTargets);
  finalizeComicPlan(plan,entries);
  const saved=serializeImageTag(plan.images[0]);
  expect(saved).not.toMatch(/visualState|两人在站台相遇/);
  const image=parseImageTagContent(saved);
  const caption=(buildNaiParameters(nai,{prompt:image.tag,characters:image.characters,seed:42}).v4_prompt as any).caption;
  expect(caption.base_caption).not.toMatch(/source#|target#/);
  expect(caption.char_captions[0].char_caption).toContain('source#hug');
  expect(caption.char_captions[0].char_caption).not.toContain('target#hug');
  expect(caption.char_captions[1].char_caption).toContain('target#hug');
  expect(caption.char_captions[1].char_caption).not.toContain('source#hug');
 });

 for(const mode of ['standard','simple','fast'] as const)for(const comicV2 of [false,true]){
  it(`${mode} ${comicV2?'V2':'V1'} compiles structured costume metadata and keeps it out of other actors and the Base`,()=>{
   const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2,comicAnalysisMode:mode,naturalLanguage:false,comicPanelStyle:'universal',activeArtistId:'',undesiredContent:'',qualityTags:''};
   const cosplay={character:'Hero',work:'Example Work',costume:'Festival'},wardrobe='white jacket, blue trousers, black boots';
   const legacy=`<image>\n@page\nSFW, 2girls, comic, 1 panel\n@panel P1\nThis single panel fills the page. Upper body.\n@character C1 甲\ngirl, silver hair, upper body\n@outfit\nwhite jacket\n@wardrobe\n${wardrobe}\n@cosplay\n${JSON.stringify(cosplay)}\n@character C2 乙\ngirl, brown hair, upper body\n@outfit\nblue coat\n</image>`;
   const plan=parseImagePlan(JSON.stringify({changes:[],images:[{...fields,tag:comicV2?'SFW, 2girls, comic, 1 panel, station':legacy,characters:comicV2?[{name:'甲',tag:'girl, silver hair, upper body',nl:'',wardrobe,outfit:'white jacket',cosplay},{name:'乙',tag:'girl, brown hair, upper body',nl:'',outfit:'blue coat'}]:[]}]}),batch.target.segments,1,1,batch.markerTargets);
   finalizeComicPlan(plan,entries);
   const saved=parseImageTagContent(serializeImageTag(plan.images[0])),caption=(buildNaiParameters(nai,{prompt:saved.tag,characters:saved.characters,seed:42}).v4_prompt as any).caption;
   expect(caption.base_caption).not.toMatch(/Hero|cosplay|white jacket|@wardrobe/);
   expect(caption.char_captions[0].char_caption).toContain("Hero's Festival outfit from Example Work.");
   expect(caption.char_captions[0].char_caption).not.toMatch(/black boots|blue trousers|red coat|@cosplay/);
   expect(caption.char_captions[1].char_caption).toContain('blue coat');expect(caption.char_captions[1].char_caption).not.toContain('Hero');
   expect(entries[0].fields.fandom).toBe('');
  });
  it(`${mode} ${comicV2?'V2':'V1'} sends a temporary cosplay costume only to its wearer with nl disabled`,()=>{
   const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2,comicAnalysisMode:mode,naturalLanguage:false,comicPanelStyle:'universal',activeArtistId:'',undesiredContent:'',qualityTags:''};
   // Synthetic outfit: verify source/version transport, not a canonical costume reconstruction.
   const outfit="cosplay, She is wearing Hero's Festival costume from Example Work., white jacket, blue leggings, white boots";
   const source=v1.replace('Medium shot.','Upper body.').replace('red coat\n@negative',outfit+'\n@negative');
   const plan=parseImagePlan(JSON.stringify({changes:[],images:[{...fields,tag:comicV2?'SFW, 2girls, comic, 2 panels, station':source,characters:comicV2?[{name:'甲',tag:'girl, silver hair, upper body',nl:'',outfit,panel:'This is the upper right panel.'},{name:'乙',tag:'girl, brown hair, medium shot',nl:'',panel:'This is the lower main panel.'}]:[]}]}),batch.target.segments,1,1,batch.markerTargets);
   finalizeComicPlan(plan,entries);
   const saved=parseImageTagContent(serializeImageTag(plan.images[0]));
   const caption=(buildNaiParameters(nai,{prompt:saved.tag,characters:saved.characters,seed:42}).v4_prompt as any).caption;
   expect(caption.base_caption).not.toMatch(/Festival|cosplay|white jacket/);
   expect(caption.char_captions[0].char_caption).toContain("Hero's Festival costume from Example Work");
   expect(caption.char_captions[0].char_caption).toContain('white jacket');
   expect(caption.char_captions[0].char_caption).not.toMatch(/red coat|white boots|blue leggings/);
   expect(caption.char_captions[1].char_caption).toContain('blue coat');
   expect(caption.char_captions[1].char_caption).not.toMatch(/cosplay|Festival|white jacket/);
   expect(entries[0].fields.fandom).toBe('');expect(plan.changes).toEqual([]);
  });
  it(`${mode} ${comicV2?'V2':'V1'} preserves clothing, locations and exclusions through save/load and actual NAI assembly`,()=>{
   const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2,comicAnalysisMode:mode,comicPanelStyle:'universal',activeArtistId:'',undesiredContent:'',qualityTags:''};
   const plan=parseImagePlan(JSON.stringify({changes:[],images:[{...fields,tag:comicV2?'SFW, 2girls, comic, 2 panels, station':v1,characters:comicV2?names.map((name,i)=>({name,tag:'girl, medium shot, '+(i?'receiving a map':'holding a map'),nl:'',outfit:i?'blue coat':'red coat',negative:i?'red coat':'blue coat',panel:i?'This is the upper left panel.':'This is the upper right panel.'})):[]}]}),batch.target.segments,1,1,batch.markerTargets);
   for(const image of plan.images)image.tag=applyPositionedCharRefs(image.tag,entries,[],image.sourceLine,'tag',new Set()).text;
   finalizeComicPlan(plan,entries);
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
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full-medium',comicMode:true,comicV2:true};
  const params=buildNaiParameters(nai,{prompt:'SFW, 2girls, comic',characters:[{name:'甲',tag:'girl, red coat',nl:'',negative:'blue coat'}],seed:42});
  expect((params.v4_negative_prompt as any).caption.char_captions[0].char_caption).toBe('');
  expect(nai.model).toBe('nai-diffusion-5-full-medium');expect(params.steps).toBe(14);
 });
 it('changes only conflicting built-in negatives and preserves explicit artist/channel preferences',()=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2:true,activeArtistId:'',undesiredContent:'',qualityTags:''};
  const normal=buildNaiParameters(nai,{prompt:'SFW, comic, text',seed:42});expect(normal.negative_prompt).not.toContain('multiple views');
  expect(normal.negative_prompt).toMatch(/\btext\b/);
  const custom=buildNaiParameters({...nai,undesiredContent:'multiple views, text, my custom preference'},{prompt:'SFW, comic',seed:42});
  expect(custom.negative_prompt).toBe('multiple views, text, my custom preference');
 });
 it('removes old V1 narration, retaining layout and leaving exclusions out of positive captions',()=>{
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2:false,activeArtistId:'',qualityTags:'my quality',undesiredContent:''};
  const prompt=v1.replace('2 panels\n@panel','2 panels\n@non_character\nnarration\nText: 车站。\n@panel');
  const params=buildNaiParameters(nai,{prompt,seed:42}),caption=(params.v4_prompt as any).caption;
  expect(caption.base_caption).toContain('my quality');expect(caption.base_caption).not.toMatch(/Text:|车站。/);expect(caption.base_caption).not.toContain('blue coat');
  expect(caption.char_captions[0].char_caption).not.toContain('blue coat');
 });
});
