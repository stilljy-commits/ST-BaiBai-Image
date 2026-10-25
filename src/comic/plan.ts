import type { ImagePlan } from '@/autoTag/protocol';
import type { CharTagEntry } from '@/state/charTags';
import { comicWardrobeUpdates, comicCostumeUpdates, finalizeComicCharacters, type ComicWardrobeLedger } from './characters';
import type { ComicCostumes } from './costume';
import { parseComicSections, comicSectionCharacters, writeComicSections } from './sections';

/** Use an exact, already shared panel location to recover its Base camera.
 * No layout invention or semantic rewriting: ambiguous/missing anchors fall back. */
function nativeFraming(image:ImagePlan['images'][number]):ImagePlan['images'][number]['characters'] {
  const locations=[...new Set(image.characters.map(c=>c.panel?.trim()).filter((p):p is string=>!!p))];
  return image.characters.map(character=>{
    const panel=character.panel?.trim();if(!panel)return character;
    const at=image.tag.indexOf(panel);if(at<0||image.tag.indexOf(panel,at+panel.length)>=0)return character;
    const end=Math.min(image.tag.length,...locations.filter(p=>p!==panel).map(p=>image.tag.indexOf(p,at+panel.length)).filter(i=>i>=0));
    const camera=image.tag.slice(at+panel.length,end).match(/\b(?:medium close[- ]?up|close[- ]?up|upper body|bust shot|waist[- ]up|medium shot|full body(?: view)?|wide shot|headshot|portrait)\b/i)?.[0];
    return camera?{...character,framing:camera}:character;
  });
}

/** Applies the same local completion to standard/simple/fast results. Only
 * accepted wardrobe states are shared, keyed by original source order. */
export function finalizeComicPlan(plan:ImagePlan,entries:readonly CharTagEntry[],ledger?:ComicWardrobeLedger,locked:ReadonlySet<string>=new Set()):void {
  let outfits:Record<string,string>={};
  let costumes:ComicCostumes={};
  let previousLine=-Infinity;
  for(const image of [...plan.images].sort((a,b)=>a.sourceLine-b.sourceLine)){
    outfits={...outfits,...ledger?.before(image.sourceLine)};
    costumes={...costumes,...ledger?.costumesBefore(image.sourceLine)};
    const current=entries.map(e=>({...e,fields:{...e.fields}}));
    for(const change of plan.changes){
      if(change.field==='new'&&!current.some(e=>e.name===change.name)){
        try{current.push({name:change.name,fields:JSON.parse(change.value),raw:'',nl:change.nl??'',source:'ai',desc:'',history:[]});}catch{/* Existing plan validation owns malformed introductions. */}
      }
    }
    for(const change of [...plan.changes].sort((a,b)=>a.sourceLine-b.sourceLine)){
      if(change.field==='new'||change.sourceLine>image.sourceLine||locked.has(change.name))continue;
      const entry=current.find(e=>e.name===change.name);
      if(entry&&Object.hasOwn(entry.fields,change.field)){
        entry.fields[change.field as keyof typeof entry.fields]=change.value;
        if(change.field==='outfit'&&change.sourceLine>previousLine){
          outfits[change.name]=change.value;
          costumes[change.name]=null;
          ledger?.accept(change.sourceLine,{[change.name]:change.value},{[change.name]:null});
        }
      }
    }
    const sections=parseComicSections(image.tag);
    const draft=sections?comicSectionCharacters(sections):nativeFraming(image);
    const updates=comicWardrobeUpdates(draft,outfits,costumes),costumeUpdates=comicCostumeUpdates(draft,outfits,costumes);
    if(sections){
      const characters=finalizeComicCharacters(draft,{entries:current,outfits,costumes});
      image.tag=writeComicSections(sections,characters);image.characters=[];
    }else image.characters=finalizeComicCharacters(draft,{entries:current,outfits,costumes});
    ledger?.accept(image.sourceLine,updates,costumeUpdates);
    previousLine=image.sourceLine;
  }
}
