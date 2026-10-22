import type { ImageCharacterPrompt } from '@/autoTag/protocol';

interface SectionCharacter extends ImageCharacterPrompt { id:string; }
interface Panel { id:string; description:string; nonCharacter:string; characters:SectionCharacter[]; }
export interface ComicSections { base:string; nonCharacter:string; negative:string; panels:Panel[]; }
export function panelLocation(description:string):string {
  const first=description.trim().match(/^[^.\n]+(?:\.|$)/)?.[0]??'';
  return /\bpanel\b/i.test(first)&&/\b(?:upper|lower|left|right|top|bottom|middle|row|single|vertical|second|third)\b/i.test(first)?first:'';
}
/** The section markers are a plugin protocol, not NAI request fields. Parse
 * locally and fail open to the legacy text path for malformed saved content. */
export function parseComicSections(source:string):ComicSections|null {
  const text=source.trim().replace(/^<image>\s*/i,'').replace(/\s*<\/image>$/i,'').replace(/\r\n?/g,'\n');
  if(!/^@(?:page|position)\b/i.test(text))return null;
  const page:ComicSections={base:'',nonCharacter:'',negative:'',panels:[]};
  let panel:Panel|undefined,character:SectionCharacter|undefined,seenPage=false;
  let write:((value:string)=>void)|undefined,lines:string[]=[];
  const flush=()=>{write?.(lines.join('\n').trim());lines=[];};
  for(const line of text.split('\n')){
    const marker=line.match(/^\s*@(page|panel|character|negative|non_character|outfit|position|center)\b(?:[ \t]+(.*?))?[ \t]*$/i);
    if(!marker){if(/^\s*@\w+/.test(line))return null;if(write)lines.push(line);else if(line.trim())return null;continue;}
    flush();write=undefined;
    const kind=marker[1].toLowerCase(),value=marker[2]?.trim()??'';
    // Hand-authored coordinate protocols have their own semantics. Preserve the
    // old path rather than silently dropping an unknown placement instruction.
    if(kind==='position'||kind==='center')return null;
    if(kind==='page'){if(seenPage||value)return null;seenPage=true;write=v=>{page.base=v;};}
    else if(kind==='panel'){
      if(!seenPage||!value||page.panels.some(p=>p.id===value))return null;
      panel={id:value,description:'',nonCharacter:'',characters:[]};page.panels.push(panel);character=undefined;
      const owned=panel;write=v=>{owned.description=v;};
    }else if(kind==='character'){
      if(!panel||!value)return null;
      const [id,...name]=value.split(/\s+/);
      if(panel.characters.some(c=>c.id===id))return null;
      character={id,name:name.join(' ')||id,tag:'',nl:''};panel.characters.push(character);
      const owned=character;write=v=>{owned.tag=v;};
    }else if(kind==='negative'){
      if(character){const owned=character;write=v=>{owned.negative=v;};}
      else write=v=>{page.negative=v;};
    }else if(kind==='outfit'){
      if(!character)return null;const owned=character;write=v=>{owned.outfit=v;};
    }else if(kind==='non_character'){
      character=undefined;
      if(panel){const owned=panel;write=v=>{owned.nonCharacter=v;};}
      else write=v=>{page.nonCharacter=v;};
    }
  }
  flush();
  if(!seenPage||!page.base||!page.panels.length||page.panels.some(p=>!p.description||p.characters.some(c=>!c.tag)))return null;
  return page;
}
export function comicSectionCharacters(page:ComicSections):ImageCharacterPrompt[]{
  return page.panels.flatMap(panel=>panel.characters.map(({id:_,...character})=>({...character,panel:panelLocation(panel.description),framing:panel.description})));
}
export function comicSectionBase(page:ComicSections):string {
  const parts=[page.base,page.nonCharacter,...page.panels.flatMap(p=>[p.description,p.nonCharacter])].filter(Boolean);
  const visuals:string[]=[],texts:string[]=[];
  for(const part of parts){const at=part.search(/\n?Text:/i);if(at<0)visuals.push(part);else{visuals.push(part.slice(0,at));texts.push(part.slice(at).replace(/^\s*Text:\s*/i,''));}}
  return visuals.filter(Boolean).join(', ')+(texts.length?'\nText: '+texts.join('\n\n'):'');
}
export function writeComicSections(page:ComicSections,characters?:ImageCharacterPrompt[]):string {
  let index=0;
  const out=['<image>','@page',page.base];
  if(page.nonCharacter)out.push('@non_character',page.nonCharacter);
  if(page.negative)out.push('@negative',page.negative);
  for(const panel of page.panels){
    out.push('@panel '+panel.id,panel.description);
    if(panel.nonCharacter)out.push('@non_character',panel.nonCharacter);
    for(const original of panel.characters){
      const character=characters?.[index++]??original;
      out.push('@character '+original.id+(original.name!==original.id?' '+original.name:''),character.tag);
      if(character.outfit!==undefined)out.push('@outfit',character.outfit);
      if(character.negative)out.push('@negative',character.negative);
    }
  }
  return [...out,'</image>'].join('\n');
}
