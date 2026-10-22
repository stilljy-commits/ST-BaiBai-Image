import type { ImageCharacterPrompt } from '@/autoTag/protocol';
import type { CharTagEntry, CharTagField } from '@/state/charTags';

const apparel = /\b(?:coat|jacket|blazer|cardigan|hoodie|sweater|shirt|blouse|vest|uniform|dress|skirt|pants|trousers|shorts|robe|kimono|yukata|suit|apron|scarf|gloves|hat|cap|boots|shoes|socks|stockings|tights|leggings|swimsuit|leotard|bodysuit|armor|armour|cape|costume|clothes|clothing|outfit)\b/i;
const cosplay = /\b(?:cosplay(?:ing)?|dressed as)\b/i;
const colors = /\b(?:red|blue|green|yellow|white|black|brown|purple|pink|orange|grey|gray|silver|golden|navy|beige)\b/gi;
const parts=(value:string)=>value.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
const key=(value:string)=>value.toLowerCase().replace(/\s+/g,' ').trim();
const garmentKey=(value:string)=>key(value).replace(/^(?:wearing|dressed in|clad in)\s+(?:(?:a|an|the)\s+)?/,'');
const head=(tag:string)=>tag.split(/\nText:/i)[0];
function append(tag:string,value:string):string {
  if(!value.trim())return tag;
  const at=tag.search(/\nText:/i),body=at<0?tag:tag.slice(0,at),tail=at<0?'':tag.slice(at);
  const seen=new Set(parts(body).map(key));
  return [body,...parts(value).filter(v=>!seen.has(key(v)))].filter(Boolean).join(', ')+tail;
}
function without(tag:string,values:string[]):string {
  const at=tag.search(/\nText:/i),body=at<0?tag:tag.slice(0,at),tail=at<0?'':tag.slice(at);
  const excluded=new Set(values.flatMap(parts).map(garmentKey));
  return parts(body).filter(v=>!excluded.has(garmentKey(v))).join(', ')+tail;
}
export function userAppearanceField(entry:CharTagEntry,field:CharTagField):boolean {
  return entry.source!=='ai'||entry.history.some(h=>h.floor<0&&(h.field===field||h.field==='new'));
}
function confirmedAppearanceField(entry:CharTagEntry,field:CharTagField):boolean {
  return userAppearanceField(entry,field)||entry.history.some(h=>h.field===field);
}
/** Automatic fandom profiles identify the character without redesigning every
 * default trait. User/book fields and explicit current changes are preserved. */
export function comicFixedFields(entry:CharTagEntry,explicit:ReadonlySet<string>=new Set()):Partial<CharTagEntry['fields']> {
  return Object.fromEntries(Object.entries(entry.fields).filter(([field,value])=>value&&
    (!entry.fields.fandom||field==='fandom'||field==='sex'||confirmedAppearanceField(entry,field as CharTagField)||explicit.has(field))));
}
export function visibleClothing(tag:string):boolean {
  const body=head(tag);
  return !/\b(?:face|head|eyes?|mouth)\s+(?:close[- ]?up|only)|\bclose[- ]?up of (?:the )?(?:face|head|eyes?|mouth)|\b(?:headshot|portrait)\b/i.test(body)||
    /\b(?:upper body|medium shot|full body|wide shot|waist|torso)\b/i.test(body);
}
/** Filter only standalone garment tags for an unambiguous upper-body crop.
 * Keep the complete wardrobe for later panels. Free-form sentences, costume
 * names and mixed garment descriptions are left to the model, never rewritten. */
export function visibleComicOutfit(outfit:string,tag:string):string {
  if(!visibleClothing(tag))return '';
  if(!/\b(?:upper body|bust shot|waist[- ]up|chest close[- ]?up|(?:neck|chest|torso) and (?:chest|neck|torso) view)\b/i.test(head(tag))||
    /\b(?:full body|wide shot|lower body|cowboy shot)\b/i.test(head(tag)))return outfit;
  return parts(outfit).filter(part=>{
    // Only adjective + a single recognized lower garment, not a named costume
    // or a sentence which may also describe visible clothing or a held object.
    return !/^(?:(?:white|black|blue|red|green|yellow|pink|purple|brown|grey|gray|gold|golden|silver|navy|beige|sky[- ]blue|light|dark|matte|opaque|sheer|tight|seamless|pleated|long|short|knee[- ]high|over[- ]knee|thigh[- ]high|high[- ]heeled|heeled|leather|silk|cotton)\s+)*(?:boots|shoes|socks|stockings|tights|leggings|pants|trousers|shorts|skirt)$/i.test(part);
  }).join(', ');
}
function safeNegative(value:string,positive:string):string {
  const own=key(head(positive));
  return [...new Set(parts(value).filter(v=>{
    const needle=key(v);if(!needle||needle==='girl'||needle==='boy'||needle==='other')return false;
    return !(' '+own.replace(/[^\p{L}\p{N}_]+/gu,' ')+' ').includes(' '+needle.replace(/[^\p{L}\p{N}_]+/gu,' ')+' ');
  }))].join(', ');
}
/** Only clear color alternatives for the SAME garment are inferred locally.
 * Different garment types may be layered and must not be guessed as exclusive. */
function conflictingGarments(own:string,other:string):string[] {
  const mine=parts(head(own)).filter(v=>apparel.test(v));
  return parts(head(other)).filter(candidate=>{
    if(!apparel.test(candidate))return false;
    const hues=[...candidate.matchAll(colors)].map(m=>m[0].toLowerCase());
    const garment=key(candidate.replace(colors,' '));if(!hues.length||!garment)return false;
    return mine.some(v=>key(v.replace(colors,' '))===garment&&
      [...v.matchAll(colors)].length>0&&![...v.matchAll(colors)].some(m=>hues.includes(m[0].toLowerCase())));
  });
}
export interface ComicCharacterContext {
  entries?: readonly CharTagEntry[];
  /** Mutable only within one source-ordered analysis result. Empty means no default garment. */
  outfits?: Record<string,string>;
}
/** No model calls, no semantic clothing guesses, and no error/retry for optional
 * fields. Metadata is consumed into final tags, so manual tag edits stay final. */
export function finalizeComicCharacters(characters:readonly ImageCharacterPrompt[],context:ComicCharacterContext={}):ImageCharacterPrompt[] {
  const outfits=context.outfits??{},entries=new Map(context.entries?.map(e=>[e.name,e]));
  const result=characters.map(character=>{
    const entry=entries.get(character.name),old=outfits[character.name];
    const {outfit,panel,negative,clothingVisible,framing,...plain}=character;
    const frame=framing?`${framing}, ${head(character.tag)}`:character.tag;
    const showClothes=clothingVisible!==false&&visibleClothing(frame);
    let tag=character.tag;
    if(outfit!==undefined){
      tag=without(tag,[entry?.fields.outfit??'',old??'']);
      outfits[character.name]=outfit;
      if(showClothes)tag=append(tag,visibleComicOutfit(outfit,frame));
    }else if(showClothes&&!apparel.test(head(tag))&&!cosplay.test(head(tag))){
      const fallback=Object.hasOwn(outfits,character.name)?outfits[character.name]:
        entry&&(!entry.fields.fandom||confirmedAppearanceField(entry,'outfit'))?entry.fields.outfit:undefined;
      if(fallback!==undefined)tag=append(tag,visibleComicOutfit(fallback,frame));
    }
    if(panel?.trim()&&!head(tag).includes(panel.trim()))tag=panel.trim()+' '+tag;
    return {...plain,tag,...(negative?.trim()?{negative:negative.trim()}: {})};
  });
  return result.map((character,index)=>{
    const inferred=result.flatMap((other,i)=>i!==index&&other.name!==character.name&&
      !!characters[index].panel&&characters[index].panel===characters[i].panel?conflictingGarments(character.tag,other.tag):[]);
    const negative=safeNegative([character.negative??'',...inferred].join(', '),character.tag);
    const {negative:_,...rest}=character;return {...rest,...(negative?{negative}: {})};
  });
}

/** Requests completing out of order never restore an older wardrobe or send
 * later facts to an earlier picture. Original source positions own the records. */
export class ComicWardrobeLedger {
  private records=new Map<number,Record<string,string>>();
  before(line:number):Record<string,string>{return Object.assign({},...([...this.records].filter(([at])=>at<line).sort(([a],[b])=>a-b).map(([,value])=>value)));}
  accept(line:number,outfits:Record<string,string>):void{if(Number.isFinite(line))this.records.set(line,{...this.records.get(line),...outfits});}
}
