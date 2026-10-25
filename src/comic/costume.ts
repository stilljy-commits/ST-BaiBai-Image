/** Temporary costume provenance, never a character's permanent fandom. */
export interface ComicCosplay { character:string; work?:string; costume?:string; }
/** Independent temporary provenance. Null explicitly ends cosplay; omission keeps it. */
export type ComicCostumes = Record<string,string|null>;
const pieces=(value:string)=>normalizeComicOutfit(value).split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
const sourcePart=(value:string)=>/^(?:(?:she|he|they) (?:is |are )?)?wearing .+['’]s .*(?:outfit|costume)\b/i.test(value)||
  /^cosplay(?:ing)? as .+/i.test(value)||/\(cosplay\)$/i.test(value);
/** Recover only an explicitly labelled source, never guess it from garment names. */
export function comicCosplayPrefix(value:string):string|undefined {
  const parts=pieces(value),sources=parts.filter(sourcePart);
  return sources.length&&parts.some(v=>/^cosplay$/i.test(v)||sourcePart(v))?['cosplay',...sources].join(', '):undefined;
}
export function withComicCostume(outfit:string,prefix:string|null|undefined):string {
  outfit=normalizeComicOutfit(outfit);
  if(prefix===undefined)return outfit;
  if(prefix!==null&&comicCosplayPrefix(outfit)===prefix)return outfit;
  return [prefix,...pieces(outfit).filter(v=>!/^cosplay$/i.test(v)&&!sourcePart(v))].filter(Boolean).join(', ');
}
/** Fill only missing fields of the same explicitly named cosplay target. */
export function inheritComicCosplay(next:ComicCosplay,previous:string|null|undefined):ComicCosplay{
  if(!previous)return next;
  const name=next.character.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const pattern=new RegExp(`^(?:(?:she|he|they) (?:is |are )?)?wearing ${name}['’]s(?: (.*?))? (?:outfit|costume)(?: from (.*?))?[.]?$`,'i');
  const match=pieces(previous).map(part=>part.match(pattern)).find(value=>!!value);if(!match)return next;
  const work=match[2]?.trim(),costume=match[1]?.trim();
  if(next.work&&work&&next.work.toLowerCase()!==work.toLowerCase())return next;
  return {...next,...(!next.work&&work?{work}:{}),...(!next.costume&&costume?{costume}:{})};
}
/** Remove only self-declared placeholders, not an actually named/default costume.
 * Old native prompts stay valid; this needs no new model field or request. */
export function normalizeComicOutfit(outfit:string):string {
  const unspecified=/\b(?:version (?:unspecified|unknown)|(?:unspecified|unknown) (?:version|costume|skin))\b/i.test(outfit);
  return outfit.replace(/(['’]s)\s+Costume outfit\b/g,'$1 outfit')
    .replace(/(^|[.]\s+)(?:version (?:unspecified|unknown)|(?:unspecified|unknown) (?:version|costume|skin))[.](?=\s|$)/gi,'$1')
    .split(/[,;\n]/).map(value=>{
      let cleaned=value.trim().replace(/^(?:version (?:unspecified|unknown)|(?:unspecified|unknown) (?:version|costume|skin))[.]\s*/i,'');
      if(unspecified)cleaned=cleaned.replace(/^default (?:outfit|skin|costume)[.]\s*/i,'');
      return cleaned.trim().replace(/[ \t]{2,}/g,' ');
    }).filter(value=>
    value&&!/^(?:version (?:unspecified|unknown)|(?:unspecified|unknown) (?:version|costume|skin))\.?$/i.test(value)&&
    !(unspecified&&/^(?:default (?:outfit|skin|costume))\.?$/i.test(value))
  ).join(', ');
}
const clean=(value:unknown)=>typeof value==='string'&&!/[<>\r\n]/.test(value)?value.trim().slice(0,200):'';
export function readComicCosplay(value:unknown):ComicCosplay|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const raw=value as Record<string,unknown>,character=clean(raw.character);
  if(!character||/^(?:character|character name|unknown|未知)$/i.test(character))return undefined;
  const work=clean(raw.work),costume=clean(raw.costume);
  return {character,...(work&&!/^(?:work|work name|unknown|未知)$/i.test(work)?{work}:{}),
    ...(costume&&!/^(?:costume|costume name|outfit|skin|unknown|unspecified|未知|未指定)$/i.test(costume)?{costume}: {})};
}
/** One fixed, short phrase. Unknown costume versions are simply omitted. */
export function withComicCosplay(outfit:string,cosplay?:ComicCosplay|null):string {
  outfit=normalizeComicOutfit(outfit);
  if(cosplay===null)return withComicCostume(outfit,null);
  if(!cosplay)return outfit;
  const phrase=`wearing ${cosplay.character}'s${cosplay.costume?' '+cosplay.costume:''} outfit${cosplay.work?' from '+cosplay.work:''}.`;
  return withComicCostume(outfit,['cosplay',phrase].join(', '));
}
