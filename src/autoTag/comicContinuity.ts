import { mergeVisualChanges, type VisualChanges, type VisualState } from './visualArchive';

interface RecordState { ordinal: number; text: string; marker: string; state: VisualState }
/** Session-only, source ordered. Later completion never supplies earlier requests with future facts. */
export class ComicContinuityLedger {
  private records = new Map<number, RecordState>();
  accept(record: RecordState): void { this.records.set(record.ordinal, structuredClone(record)); }
  confirmed(beforeOrdinal = Infinity): RecordState[] {
    const records: RecordState[] = [];
    for (let i = 0; i < beforeOrdinal; i++) {
      const record = this.records.get(i);
      if (!record || !record.text.trim()) break;
      records.push(record);
    }
    return records;
  }
  context(beforeOrdinal: number, prefix: string): { prefix: string; facts?: string; changes?: VisualChanges } {
    const contiguous = this.confirmed(beforeOrdinal);
    const last=contiguous.at(-1);
    if (!last) return {prefix};
    // Verify every replaced segment and separator, not just a coincidentally matching last sentence.
    let cursor=0,previousMarker='';
    for(const record of contiguous){
      const anchor=record.text.trim(),found=prefix.indexOf(anchor,cursor);
      if(found<0 || prefix.slice(cursor,found).trim()!==previousMarker) return {prefix};
      cursor=found+anchor.length;previousMarker=record.marker;
    }
    let rest=prefix.slice(cursor).trimStart();
    if (rest.startsWith(last.marker)) rest=rest.slice(last.marker.length).trimStart();
    return {
      prefix: rest,
      facts: contiguous.map(record => record.state.facts).join('；'),
      changes: mergeVisualChanges(...contiguous.map(record => record.state.changes)),
    };
  }
}
