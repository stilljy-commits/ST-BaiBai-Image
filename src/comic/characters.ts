import type { ImageCharacterPrompt } from '@/autoTag/protocol';
import type { CharTagEntry, CharTagField } from '@/state/charTags';
import { comicCosplayPrefix, inheritComicCosplay, withComicCostume, withComicCosplay, type ComicCostumes } from './costume';
import { conflictingClothing, conflictsWithOwnClothing, isBareColor } from './clothingExclusions';

const apparel = /\b(?:coat|jacket|blazer|cardigan|hoodie|sweater|shirt|blouse|vest|uniform|dress|skirt|pants|trousers|shorts|robe|kimono|yukata|suit|apron|scarf|gloves|hat|cap|boots|shoes|socks|stockings|tights|leggings|swimsuit|leotard|bodysuit|armor|armour|cape|costume|clothes|clothing|outfit)\b/i;
const cosplay = /\b(?:cosplay(?:ing)?|dressed as)\b/i;
const parts=(value:string)=>value.split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
const key=(value:string)=>value.toLowerCase().replace(/\s+/g,' ').trim();
const garmentKey=(value:string)=>key(value).replace(/^(?:wearing|dressed in|clad in)\s+(?:(?:a|an|the)\s+)?/,'');
const head=(tag:string)=>tag.split(/\nText:/i)[0];
function withoutTemplateIdentity(tag:string):string {
  const at=tag.search(/\nText:/i),body=at<0?tag:tag.slice(0,at),tail=at<0?'':tag.slice(at);
  return parts(body).filter(value=>!/^character name\s*\((?:copyright|work) name\)$/i.test(value)).join(', ')+tail;
}
function append(tag:string,value:string):string {
  if(!value.trim())return tag;
  const at=tag.search(/\nText:/i),body=at<0?tag:tag.slice(0,at),tail=at<0?'':tag.slice(at);
  const seen=new Set(parts(body).map(key));
  return [body,...parts(value).filter(v=>!seen.has(key(v)))].filter(Boolean).join(', ')+tail;
}
function costumeTag(tag:string,prefix:string|null|undefined):string{
  if(prefix===undefined)return tag;
  const at=tag.search(/\nText:/i),body=at<0?tag:tag.slice(0,at),tail=at<0?'':tag.slice(at);
  if(prefix!==null&&comicCosplayPrefix(body)===prefix)return tag;
  return append(withComicCostume(body,null)+tail,prefix??'');
}
function without(tag:string,values:string[]):string {
  const at=tag.search(/\nText:/i),body=at<0?tag:tag.slice(0,at),tail=at<0?'':tag.slice(at);
  const excluded=new Set(values.flatMap(parts).filter(value=>apparel.test(value)||cosplay.test(value)).map(garmentKey));
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
    const needle=key(v);if(!needle||needle==='girl'||needle==='boy'||needle==='other'||isBareColor(v)||conflictsWithOwnClothing(v,positive))return false;
    return !(' '+own.replace(/[^\p{L}\p{N}_]+/gu,' ')+' ').includes(' '+needle.replace(/[^\p{L}\p{N}_]+/gu,' ')+' ');
  }))].join(', ');
}
export interface ComicCharacterContext {
  entries?: readonly CharTagEntry[];
  /** Mutable only within one source-ordered analysis result. Empty means no default garment. */
  outfits?: Record<string,string>;
  costumes?: ComicCostumes;
}
const frameOf=(character:ImageCharacterPrompt)=>character.framing?`${character.framing}, ${head(character.tag)}`:head(character.tag);
const detailClothes=(character:ImageCharacterPrompt)=>/\b(?:close[- ]?up|headshot|portrait|(?:face|head|hands?|neck|chest|torso) (?:only|view))\b/i.test(character.framing??head(character.tag))||
  character.outfit===''&&/\b(?:upper body|bust shot|waist[- ]up)\b/i.test(character.framing??head(character.tag));
function costumeTimeline(characters:readonly ImageCharacterPrompt[],known:Record<string,string>,costumes:ComicCostumes){
  const current:ComicCostumes={...Object.fromEntries(Object.entries(known).flatMap(([name,value])=>{const prefix=comicCosplayPrefix(value);return prefix?[[name,prefix]]:[];})),...costumes};
  const updates:ComicCostumes={};
  const values=characters.map(character=>{
    const {name}=character;
    const explicit=character.cosplay===null||character.wardrobe===''||character.outfit===''&&!detailClothes(character)&&character.clothingVisible!==false?null:
      character.cosplay?withComicCosplay('',inheritComicCosplay(character.cosplay,current[name])):comicCosplayPrefix(character.wardrobe??'')??comicCosplayPrefix(character.outfit??'')??comicCosplayPrefix(head(character.tag));
    if(explicit!==undefined){current[name]=explicit;updates[name]=explicit;}
    return current[name];
  });
  return {updates,values};
}
export function comicCostumeUpdates(characters:readonly ImageCharacterPrompt[],known:Record<string,string>={},costumes:ComicCostumes={}):ComicCostumes {
  return costumeTimeline(characters,known,costumes).updates;
}
export function needsComicClothingHistory(characters:readonly ImageCharacterPrompt[]):boolean {
  return characters.some(c=>c.clothingVisible!==false&&visibleClothing(frameOf(c))&&
    (c.outfit===undefined&&c.wardrobe===undefined||c.cosplay!=null&&(!c.cosplay.work||!c.cosplay.costume)||c.cosplay===undefined&&!comicCosplayPrefix(c.wardrobe??c.outfit??head(c.tag))));
}
/** A detail cut-in cannot replace a complete wardrobe. Trust ordered Base/V1
 * body views for later changes; without a reliable panel frame use the first
 * legacy body entry. A first detail may seed missing state. Explicit wardrobe wins. */
function wardrobeTimeline(characters:readonly ImageCharacterPrompt[],known:Record<string,string>={},costumes:ComicCostumes={}) {
  const updates:Record<string,string>={},explicit=new Set<string>(),bodySeen=new Set<string>();
  const provenance=costumeTimeline(characters,known,costumes).values,snapshots:Record<string,string>[]=[];
  for(const [index,character] of characters.entries()){
    snapshots.push({...known,...updates});
    const {name,wardrobe,outfit}=character;
    if(wardrobe!==undefined){updates[name]=wardrobe?withComicCostume(wardrobe,provenance[index]):'';explicit.add(name);continue;}
    if(outfit===undefined||explicit.has(name)||character.clothingVisible===false)continue;
    // Native outfit means complete current clothing. A main upper-body view can
    // therefore update it; a face/hand cut-in cannot. Base/V1 framing is trusted
    // for state ownership even if the actor accidentally says "full body".
    const detail=detailClothes(character);
    if(detail&&(Object.hasOwn(known,name)||Object.hasOwn(updates,name)))continue;
    if(!detail){if(bodySeen.has(name)&&!character.framing)continue;bodySeen.add(name);}
    updates[name]=outfit?withComicCostume(outfit,provenance[index]):'';
  }
  return {updates,snapshots};
}
export function comicWardrobeUpdates(characters:readonly ImageCharacterPrompt[],known:Record<string,string>={},costumes:ComicCostumes={}):Record<string,string> {
  return wardrobeTimeline(characters,known,costumes).updates;
}
/** No model calls, no semantic clothing guesses, and no error/retry for optional
 * fields. Metadata is consumed into final tags, so manual tag edits stay final. */
export function finalizeComicCharacters(characters:readonly ImageCharacterPrompt[],context:ComicCharacterContext={}):ImageCharacterPrompt[] {
  const outfits=context.outfits??{},costumes=context.costumes??{},entries=new Map(context.entries?.map(e=>[e.name,e]));
  const timeline=wardrobeTimeline(characters,outfits,costumes),provenance=costumeTimeline(characters,outfits,costumes);
  Object.assign(outfits,timeline.updates);Object.assign(costumes,provenance.updates);
  const result=characters.map((character,index)=>{
    const entry=entries.get(character.name),old=timeline.snapshots[index][character.name],costume=provenance.values[index];
    const {outfit,wardrobe,cosplay:_,panel,negative,clothingVisible,framing,...plain}=character;
    const frame=frameOf(character);
    const showClothes=clothingVisible!==false&&visibleClothing(frame);
    let tag=withoutTemplateIdentity(character.tag);
    if(outfit!==undefined||wardrobe!==undefined){
      tag=without(tag,[entry?.fields.outfit??'',old??'',outfit??'',wardrobe??'']);
      const visible=outfit??wardrobe!;
      if(showClothes&&visible)tag=append(tag,visibleComicOutfit(withComicCostume(visible,costume),frame));
    }else if(showClothes&&!apparel.test(head(tag))&&!cosplay.test(head(tag))){
      const fallback=Object.hasOwn(timeline.snapshots[index],character.name)?old:
        entry&&(!entry.fields.fandom||confirmedAppearanceField(entry,'outfit'))?entry.fields.outfit:undefined;
      if(fallback!==undefined||costume)tag=append(tag,visibleComicOutfit(withComicCostume(fallback??'',costume),frame));
    }
    tag=costumeTag(tag,showClothes?costume:null);
    if(panel?.trim()&&!head(tag).includes(panel.trim()))tag=panel.trim()+' '+tag;
    return {...plain,tag,...(negative?.trim()?{negative:negative.trim()}: {})};
  });
  return result.map((character,index)=>{
    const inferred=result.flatMap((other,i)=>i!==index&&other.name!==character.name&&
      !!characters[index].panel&&characters[index].panel===characters[i].panel?conflictingClothing(character.tag,other.tag):[]).slice(0,4);
    const negative=safeNegative([character.negative??'',...inferred].join(', '),character.tag);
    const {negative:_,...rest}=character;return {...rest,...(negative?{negative}: {})};
  });
}

/** Requests completing out of order never restore an older wardrobe or send
 * later facts to an earlier picture. Original source positions own the records. */
export class ComicWardrobeLedger {
  private records=new Map<number,Record<string,string>>();
  private costumes=new Map<number,ComicCostumes>();
  before(line:number):Record<string,string>{return Object.assign({},...([...this.records].filter(([at])=>at<line).sort(([a],[b])=>a-b).map(([,value])=>value)));}
  costumesBefore(line:number):ComicCostumes{return Object.assign({},...([...this.costumes].filter(([at])=>at<line).sort(([a],[b])=>a-b).map(([,value])=>value)));}
  accept(line:number,outfits:Record<string,string>,costumes:ComicCostumes={}):void{if(Number.isFinite(line)){this.records.set(line,{...this.records.get(line),...outfits});this.costumes.set(line,{...this.costumes.get(line),...costumes});}}
}
