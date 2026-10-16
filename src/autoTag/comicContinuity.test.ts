import {describe,it,expect} from 'vitest';
import {ComicContinuityLedger} from './comicContinuity';
const record=(ordinal:number,text:string)=>({ordinal,text,marker:`[img: ${ordinal}]`,sourceLine:ordinal*3,state:{complete:true,facts:`状态${ordinal}`,outfits:{小雪:ordinal?'white sweater':'blue coat'}},changes:[]});
describe('source ordered continuity reuse',()=>{
 it('replaces only verified covered original text and retains the unprocessed remainder',()=>{
  const ledger=new ComicContinuityLedger();ledger.accept(record(0,'已分析的一段。'));
  const result=ledger.context(2,'已分析的一段。\n[img: 0]\n仍在分析的一段。\n[img: 1]');
  expect(result.prefix).toBe('仍在分析的一段。\n[img: 1]');expect(result.note).toContain('状态0');expect(result.outfits.小雪).toBe('blue coat');
 });
 it('does not use later-completing future states for an earlier request or jump over an unfinished gap',()=>{
  const ledger=new ComicContinuityLedger();ledger.accept(record(1,'未来正文。'));
  expect(ledger.context(1,'先前正文。').note).toBe('');expect(ledger.context(3,'未来正文。').note).toBe('');
 });
 it('keeps source text if the cache is incomplete, changed, truncated or not explicitly complete',()=>{
  const ledger=new ComicContinuityLedger();ledger.accept({...record(0,'原文。'),state:{complete:false,facts:'不完整',outfits:{}}});
  expect(ledger.context(1,'原文。').prefix).toBe('原文。');
  ledger.accept(record(0,'原文。'));expect(ledger.context(1,'改写了。').note).toBe('');
 });
 it('does not delete inserted or rewritten facts just because the final cached sentence still matches',()=>{
  const ledger=new ComicContinuityLedger();ledger.accept(record(0,'第一段。'));ledger.accept(record(1,'第二段。'));
  for(const prefix of ['改写第一段。\n[img: 0]\n第二段。\n[img: 1]','第一段。\n[img: 0]\n插入新事实。\n第二段。\n[img: 1]']){
   const result=ledger.context(2,prefix);expect(result.prefix).toBe(prefix);expect(result.note).toBe('');
  }
 });
 it('merges clothes in prose order rather than completion order and isolates record mutation',()=>{
  const ledger=new ComicContinuityLedger(),first=record(0,'第一段。');ledger.accept(record(1,'第二段。'));ledger.accept(first);first.state.facts='外部修改';
  const result=ledger.context(2,'第一段。\n[img: 0]\n第二段。\n[img: 1]');
  expect(result.outfits.小雪).toBe('white sweater');expect(result.note).not.toContain('外部修改');expect(result.note).toContain('状态0');expect(result.note).toContain('状态1');
 });
});
