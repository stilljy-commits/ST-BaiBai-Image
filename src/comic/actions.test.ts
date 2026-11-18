import { describe, expect, it } from 'vitest';
import { parseImagePlan } from '@/autoTag/protocol';
import { prepareStreamBatch } from '@/autoTag/streamBatch';
import { parseImageTagContent, serializeImageTag } from '@/st/imageTagRegex';
import { buildNaiParameters } from '@/backends/nai';
import { settings, type NaiSettings } from '@/state/settings';
import { finalizeComicPlan } from './plan';

const panel = 'This is the main panel.';
const inset = 'This is the inset panel.';
const batch = prepareStreamBatch([{ id:'one', input:{text:'成年旅人甲和乙一起出行。',prefix:'',raw:'',intent:'两人互动',sourceLine:0} }],[],true);
const scenarios = [
  {name:'shared horseback embrace',action:'hug',sourcePose:'sitting astride behind her on the same horse, facing forward, arms around her waist',targetPose:'sitting astride in front of him on the same horse, facing forward, held around the waist from behind'},
  {name:'bench shoulder contact',sourcePose:'sitting beside her on a bench, torso facing forward, leaning her head on her shoulder',targetPose:'sitting beside her on the same bench, feet resting on the ground, supporting her head with her shoulder'},
  {name:'opposite sides of a table',sourcePose:'seated across the table from her, extending a map over the tabletop',targetPose:'seated facing her across the table, reaching forward to receive the map'},
  {name:'mutual handholding',action:'holding hands',mutual:true,sourcePose:'standing facing her, right hand clasping her left hand',targetPose:'standing facing her, left hand clasping her right hand'},
  {name:'helping another stand',sourcePose:'standing beside the chair, holding her forearm to support her',targetPose:'rising from the chair, feet planted on the floor, supported at the forearm'},
  {name:'shared sofa support',sourcePose:'reclining on the sofa with her back supported by a cushion, holding an open book',targetPose:'reclining beside her on the same sofa, head turned toward the book'},
];

function readPlan(interactions: unknown[], comicV2 = true, options: {panel?:string;duplicate?:boolean;otherPanel?:boolean} = {}) {
  const location = options.panel ?? panel;
  const characters = [
    {name:'甲',panel:location,tag:'girl, short black hair',outfit:'red coat',nl:''},
    {name:'乙',panel:options.otherPanel?inset:location,tag:'girl, brown hair',outfit:'blue coat',nl:''},
    ...(options.duplicate?[{name:'甲',panel:location,tag:'girl, smiling',nl:''}]:[]),
  ];
  const legacy = `<image>\n@page\nSFW, 2girls, comic, 1 panel\n@panel P1\n${location} Wide shot.\n@character C1 甲\ngirl, short black hair\n@outfit\nred coat\n@character C2 乙\ngirl, brown hair\n@outfit\nblue coat\n</image>`;
  return parseImagePlan(JSON.stringify({changes:[],images:[{position:'M1',tag:comicV2?`SFW, 2girls, comic, 1 panel, ${location} Wide shot.`:legacy,
    characters:comicV2?characters:[],interactions}]}),batch.target.segments,1,1,batch.markerTargets);
}

function transmitted(plan: ReturnType<typeof readPlan>, mode:'standard'|'simple'|'fast'='standard', comicV2=true) {
  finalizeComicPlan(plan,[]);
  const image=parseImageTagContent(serializeImageTag(plan.images[0]));
  const nai:NaiSettings={...settings.nai,model:'nai-diffusion-5-full',comicMode:true,comicV2,comicAnalysisMode:mode,activeArtistId:'',qualityTags:'',undesiredContent:''};
  return (buildNaiParameters(nai,{prompt:image.tag,characters:image.characters,seed:42}).v4_prompt as any).caption;
}

describe('action relations from analysis JSON through chat storage to NAI',()=>{
  for(const mode of ['standard','simple','fast'] as const) for(const comicV2 of [false,true]) {
    it.each(scenarios)(`${mode} V2=${comicV2} preserves both sides of $name`,scenario=>{
      const plan=readPlan([{panel,source:'甲',target:'乙',...scenario}],comicV2);
      const caption=transmitted(plan,mode,comicV2);
      const [source,target]=caption.char_captions.map((character:any)=>character.char_caption);
      expect(source).toContain(scenario.sourcePose);expect(target).toContain(scenario.targetPose);
      expect(source).not.toContain(scenario.targetPose);expect(target).not.toContain(scenario.sourcePose);
      expect(caption.base_caption).not.toMatch(/source#|target#|mutual#/);
      if(scenario.action){
        expect(source).toContain(`${scenario.mutual?'mutual':'source'}#${scenario.action}`);
        expect(target).toContain(`${scenario.mutual?'mutual':'target'}#${scenario.action}`);
      }
    });
  }

  it('accepts capitalization, whitespace and terminal punctuation differences in the same location',()=>{
    const plan=readPlan([{panel:'THIS  IS THE MAIN PANEL!',source:'甲',target:'乙',...scenarios[0]}]);
    expect(transmitted(plan).char_captions[0].char_caption).toContain('source#hug');
  });

  it('retains a valid unilateral pose without fabricating the absent pose or requesting another analysis',()=>{
    const plan=readPlan([{panel,source:'甲',target:'乙',sourcePose:'standing behind her, arms around her waist'}]);
    const caption=transmitted(plan);
    expect(caption.char_captions[0].char_caption).toContain('standing behind her, arms around her waist');
    expect(caption.char_captions[1].char_caption).not.toMatch(/waist|behind|source#|target#/);
  });

  it('keeps an explicit action pair even when an older model omitted both pose fields',()=>{
    const plan=readPlan([{panel,source:'甲',target:'乙',action:'hug'}]);
    const caption=transmitted(plan);
    expect(caption.char_captions[0].char_caption).toContain('source#hug');
    expect(caption.char_captions[1].char_caption).toContain('target#hug');
  });

  it('does not discard the valid side when the other optional pose is invalid markup',()=>{
    const plan=readPlan([{panel,source:'甲',target:'乙',sourcePose:'<tag>invalid</tag>',targetPose:'sitting in front of her'}]);
    const caption=transmitted(plan);
    expect(caption.char_captions[1].char_caption).toContain('sitting in front of her');
    expect(JSON.stringify(caption)).not.toContain('invalid');
  });

  it.each([{panel:inset},{panel,duplicate:true},{panel,otherPanel:true}])('does not apply an ambiguous or cross-panel relation: %j',options=>{
    const plan=readPlan([{panel,source:'甲',target:'乙',...scenarios[0]}],true,options);
    expect(JSON.stringify(transmitted(plan))).not.toMatch(/#hug|same horse/);
  });

  it('preserves action order and deduplicates repeated pose fragments when finalized again',()=>{
    const plan=readPlan([{panel,source:'甲',target:'乙',action:'hug',sourcePose:'standing behind her, standing behind her',targetPose:'facing forward'}]);
    const first=transmitted(plan);
    const second=transmitted(plan);
    expect(second).toEqual(first);
    expect(first.char_captions[0].char_caption.match(/standing behind her/g)).toHaveLength(1);
  });

  it('leaves explicitly repeated existing weights alone while appending a relation',()=>{
    const plan=readPlan([{panel,source:'甲',target:'乙',...scenarios[0]}]);
    plan.images[0].characters[0].tag+=' , 1.2::red coat::, 1.2::red coat::';
    finalizeComicPlan(plan,[]);
    expect(plan.images[0].characters[0].tag.match(/1\.2::red coat::/g)).toHaveLength(2);
  });

  it.each(['sitting astride a horse, legs on either side of the saddle, facing forward','sitting sidesaddle on a horse, both legs on the left side'])('preserves explicitly selected single-person riding posture: %s',pose=>{
    const plan=readPlan([]);plan.images[0].characters=[{name:'甲',panel,tag:'girl, '+pose,nl:''}];
    const caption=transmitted(plan).char_captions[0].char_caption;
    expect(caption).toContain(pose);
    if(pose.includes('sidesaddle'))expect(caption).not.toContain('astride');
  });
});
