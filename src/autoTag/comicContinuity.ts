import type { ComicContinuity } from './compactComic';
import type { CharChange } from './protocol';

interface RecordState { ordinal: number; text: string; marker: string; sourceLine: number; state: ComicContinuity; changes: CharChange[]; }
/** Session-only, source ordered. Later completion never supplies earlier requests with future facts. */
export class ComicContinuityLedger {
  private records = new Map<number, RecordState>();
  clear(): void { this.records.clear(); }
  accept(record: RecordState): void { this.records.set(record.ordinal, structuredClone(record)); }
  context(beforeOrdinal: number, prefix: string): { prefix: string; note: string; changes: CharChange[]; outfits: Record<string,string> } {
    const changes=[...this.records.values()].filter(r=>r.ordinal<beforeOrdinal&&prefix.includes(r.text.trim())).sort((a,b)=>a.ordinal-b.ordinal).flatMap(r=>r.changes).filter(c=>c.field!=='new');
    const contiguous: RecordState[] = [];
    for (let i=0;i<beforeOrdinal;i++) {
      const record=this.records.get(i);
      if (!record || !record.state.complete || !record.text.trim()) break;
      contiguous.push(record);
    }
    const last=contiguous.at(-1);
    if (!last) return {prefix,note:'',changes,outfits:{}};
    // Verify every replaced segment and separator, not just a coincidentally matching last sentence.
    let cursor=0,previousMarker='';
    for(const record of contiguous){
      const anchor=record.text.trim(),found=prefix.indexOf(anchor,cursor);
      if(found<0 || prefix.slice(cursor,found).trim()!==previousMarker) return {prefix,note:'',changes,outfits:{}};
      cursor=found+anchor.length;previousMarker=record.marker;
    }
    let rest=prefix.slice(cursor).trimStart();
    if (rest.startsWith(last.marker)) rest=rest.slice(last.marker.length).trimStart();
    const outfits=Object.assign({},...contiguous.map(r=>r.state.outfits));
    return {
      prefix:rest,
      note:'【已确认的此前连续状态｜按正文先后，后项更新前项；不作为选图目标】\n'+contiguous.map(r=>`原文行${r.sourceLine}之后：${r.state.facts}`).join('\n')+'\n当前衣着：'+JSON.stringify(outfits),
      changes, outfits,
    };
  }
}
