/** Temporary costume provenance, never a character's permanent fandom. */
export interface ComicCosplay { character:string; work?:string; costume?:string; }
/** Independent temporary provenance. Null explicitly ends cosplay; omission keeps it. */
export type ComicCostumes = Record<string,string|null>;
const pieces=(value:string)=>normalizeComicOutfit(value).split(/[,;\n]/).map(v=>v.trim()).filter(Boolean);
const nameKey=(value:string)=>value.toLowerCase().replace(/[_\s]+/g,' ').trim();
function targetSource(value:string):ComicCosplay|undefined{
  const target=value.trim().replace(/\s*\(cosplay\)$/i,'');
  const skin=target.match(/^(.+?)\s+\(([^()]+)\)\s+\(([^()]+)\)$/),qualified=target.match(/^(.+?)\s+\(([^()]+)\)$/);
  const character=(skin?.[1]??qualified?.[1]??target).trim();
  if(!character||!skin&&!qualified&&/^(?:(?:anime|bunny|girl|school|uniform|character|costume|outfit|cosplay|default|unknown|traditional|generic|maid|nurse|military|french|chinese|ancient|medieval|oriental|european|victorian|western|princess|pirate|witch|festival)\s*)+$/i.test(character)||
    /[<>\r\n]|\b(?:standing|sitting|holding|wearing|walking|leaning|dressed)\b/i.test(character))return;
  return {character,...(skin?{costume:skin[2].trim(),work:skin[3].trim()}:qualified?{work:qualified[2].trim()}:{})};
}
function sourceValue(value:string):ComicCosplay|undefined{
  const sentence=value.match(/^(?:(?:she|he|they) (?:is |are )?)?wearing (.+?)['’]s(?: (.*?))? (?:outfit|costume)(?: from (.+?))?[.]?$/i);
  if(sentence)return {character:sentence[1].trim(),...(sentence[2]?.trim()?{costume:sentence[2].trim()}:{}),...(sentence[3]?.trim()?{work:sentence[3].trim()}: {})};
  const as=value.match(/^(?:cosplay(?:ing)? as|dressed as)\s+(.+)$/i),suffix=value.match(/^(.+?)\s+(?:cosplay|costume)$/i);
  if(as||suffix||/\(cosplay\)$/i.test(value))return targetSource(as?.[1]??suffix?.[1]??value);
}
const sourcePart=(value:string)=>!!sourceValue(value);
export function comicCosplaySource(value:string):ComicCosplay|undefined{
  const sources=pieces(value).map(sourceValue).filter((v):v is ComicCosplay=>!!v);
  return sources.find(v=>v.work)??sources[0];
}
/** Recover only an explicitly labelled source, never guess it from garment names. */
export function comicCosplayPrefix(value:string):string|undefined {
  const parts=pieces(value),sources=parts.filter(sourcePart);
  return sources.length&&parts.some(v=>/^cosplay$/i.test(v)||sourcePart(v))?['cosplay',...sources].join(', '):undefined;
}
function sameTarget(next:ComicCosplay,previous:ComicCosplay):boolean{
  const n=nameKey(next.character),p=nameKey(previous.character);
  // Recognize a generic bunny descriptor after a previously confirmed name;
  // never interpret it as an official skin name or map a new work locally.
  return n===p||n===p+' bunny'||n===p+' bunny girl';
}
export function inheritComicCostume(next:string|undefined,previous:string|null|undefined):string|undefined{
  if(!next||!previous)return next;
  const n=comicCosplaySource(next),p=comicCosplaySource(previous);
  if(!n||!p||!sameTarget(n,p)||n.work&&p.work&&nameKey(n.work)!==nameKey(p.work))return next;
  const inherited={...n,character:p.character,...(!n.work&&p.work?{work:p.work}:{}),...(!n.costume&&p.costume?{costume:p.costume}:{})};
  return inherited.work!==n.work||inherited.costume!==n.costume?withComicCosplay('',inherited):next;
}
export function comicCosplayContext(costumes:ComicCostumes):string{
  const complete=Object.fromEntries(Object.entries(costumes).flatMap(([name,value])=>{const source=value?comicCosplaySource(value):undefined;return source?.work?[[name,source]]:[];}));
  return '【程序已确认cosplay来源】'+JSON.stringify(complete)+'\n上表用于复用完整字段，不是省略许可。每张图仍须明确来源；未列出的依据正文／资料填写已明确的角色与作品，不凭服装猜作品或版本。';
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
  const source=comicCosplaySource(previous);if(!source||nameKey(next.character)!==nameKey(source.character))return next;
  const {work,costume}=source;
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
  if(typeof value==='string'){
    const source=sourceValue(value.trim())??(/\([^()]+\)$/.test(value.trim())?targetSource(value.trim()):undefined);
    return source?.work?readComicCosplay(source):undefined;
  }
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
