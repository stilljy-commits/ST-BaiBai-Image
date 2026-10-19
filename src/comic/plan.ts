import type { ImagePlan } from '@/autoTag/protocol';
import type { CharTagEntry } from '@/state/charTags';
import { finalizeComicCharacters, type ComicWardrobeLedger } from './characters';
import { parseComicSections, comicSectionCharacters, writeComicSections } from './sections';

/** Applies the same local completion to standard/simple/fast results. Only
 * accepted explicit wardrobes are shared, keyed by original source order. */
export function finalizeComicPlan(plan:ImagePlan,entries:readonly CharTagEntry[],ledger?:ComicWardrobeLedger,locked:ReadonlySet<string>=new Set()):void {
  let outfits:Record<string,string>={};
  let previousLine=-Infinity;
  for(const image of [...plan.images].sort((a,b)=>a.sourceLine-b.sourceLine)){
    outfits={...outfits,...ledger?.before(image.sourceLine)};
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
          ledger?.accept(change.sourceLine,{[change.name]:change.value});
        }
      }
    }
    const sections=parseComicSections(image.tag);
    const draft=sections?comicSectionCharacters(sections):image.characters;
    const updates=Object.fromEntries(draft.filter(c=>c.outfit!==undefined).map(c=>[c.name,c.outfit!]));
    if(sections){
      const characters=finalizeComicCharacters(draft,{entries:current,outfits});
      image.tag=writeComicSections(sections,characters);image.characters=[];
    }else image.characters=finalizeComicCharacters(draft,{entries:current,outfits});
    ledger?.accept(image.sourceLine,updates);
    previousLine=image.sourceLine;
  }
}
