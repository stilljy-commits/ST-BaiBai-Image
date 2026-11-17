import { mergeVisualChanges, type VisualChanges, type VisualState } from './visualArchive';

interface RecordState { ordinal: number; text: string; marker: string; state?: VisualState }
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
    if (!contiguous.length) return {prefix};
    // Verify every replaced segment and separator, not just a coincidentally matching last sentence.
    let cursor=0,previousMarker='',coveredEnd=0,covered=true;
    const facts: string[] = [];
    for(const record of contiguous){
      const anchor=record.text.trim(),found=prefix.indexOf(anchor,cursor);
      if(found<0 || prefix.slice(cursor,found).trim()!==previousMarker) return {prefix};
      cursor=found+anchor.length;previousMarker=record.marker;
      covered &&= !!record.state && record.state.complete !== false;
      if (covered && record.state) {
        const tail = prefix.slice(cursor).trimStart();
        coveredEnd = tail.startsWith(record.marker) ? prefix.length - tail.length + record.marker.length : cursor;
        facts.push(record.state.facts);
      }
    }
    return {
      prefix: coveredEnd ? prefix.slice(coveredEnd).trimStart() : prefix,
      facts: facts.length ? facts.join('；') : undefined,
      changes: mergeVisualChanges(...contiguous.map(record => record.state?.changes)),
    };
  }
}
