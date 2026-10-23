/** Temporary costume provenance, never a character's permanent fandom. */
export interface ComicCosplay { character:string; work?:string; costume?:string; }
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
export function withComicCosplay(outfit:string,cosplay?:ComicCosplay):string {
  outfit=normalizeComicOutfit(outfit);
  if(!cosplay)return outfit;
  const phrase=`wearing ${cosplay.character}'s${cosplay.costume?' '+cosplay.costume:''} outfit${cosplay.work?' from '+cosplay.work:''}.`;
  const garments=outfit.split(/[,;\n]/).map(v=>v.trim()).filter(v=>v&&!/^cosplay$/i.test(v)&&!/^wearing .+\boutfit(?: from .+)?\.$/i.test(v));
  return ['cosplay',phrase,...garments].join(', ');
}
