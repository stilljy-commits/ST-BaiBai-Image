import {describe,it,expect} from 'vitest';
import {restoreStreamMarkers} from './streamHandoff';
import {findMarkers} from './markers';
const a='第一位成年旅人已经走进展厅，仔细查看墙上的地图。',b='第二位成年旅人随后走来，两人在门口讨论路线。';
const source=a+'\n[img: 门口相见]\n'+b+'\n[img: 讨论路线]';
const ordinals=new Set([0,1]);
describe('source-proven final marker recovery',()=>{
 it('restores accepted markers at the exact same words while preserving whitespace and presentation markup',()=>{
  const text=source.replace(/\[img:[^\]]+\]/g,'').replace('，','，\n\n');
  const next=restoreStreamMarkers(text,source,ordinals)!;
  expect(findMarkers(next).map(marker=>marker.intent)).toEqual(['门口相见','讨论路线']);
  expect(next.replace(/\s|\[img:[^\]]+\]/g,'')).toBe(text.replace(/\s/g,''));
 });
 it('restores only a missing marker and does not duplicate a surviving one',()=>{
  const text=source.replace('[img: 门口相见]','');
  expect(findMarkers(restoreStreamMarkers(text,source,ordinals)!).map(marker=>marker.intent)).toEqual(['门口相见','讨论路线']);
  expect(restoreStreamMarkers(source,source,ordinals)).toBeNull();
 });
 it('never restores unaccepted markers or replaces an explicitly rewritten marker',()=>{
  const text=source.replace(/\[img:[^\]]+\]/g,'');
  expect(findMarkers(restoreStreamMarkers(text,source,new Set([1]))!).map(marker=>marker.intent)).toEqual(['讨论路线']);
  expect(restoreStreamMarkers(source.replace('门口相见','已经改写的画面'),source,ordinals)).toBeNull();
 });
 it('refuses changed, deleted, reordered and short prose',()=>{
  for(const text of [source.replace('展厅','车站'),b+'\n'+a,a,''])expect(restoreStreamMarkers(text,source,ordinals)).toBeNull();
  expect(restoreStreamMarkers('短句。','短句。[img: 画面]',new Set([0]))).toBeNull();
 });
 it('handles repeated intentions by source boundary rather than text search',()=>{
  const repeated=source.replace('[img: 讨论路线]','[img: 门口相见]'),text=repeated.replace(/\[img:[^\]]+\]/g,'');
  const next=restoreStreamMarkers(text,repeated,ordinals)!;
  expect(next.indexOf('[img: 门口相见]')).toBeLessThan(next.indexOf(b));
  expect(next.lastIndexOf('[img: 门口相见]')).toBeGreaterThan(next.indexOf(b));
 });
 it('limits continued generations to their unchanged suffix',()=>{
  const prefix='此前已经保存的正文与图片。\n';
  const text=prefix+source.replace(/\[img:[^\]]+\]/g,'');
  const next=restoreStreamMarkers(text,source,ordinals,[],true)!;
  expect(next.startsWith(prefix)).toBe(true);expect(findMarkers(next)).toHaveLength(2);
  expect(restoreStreamMarkers(text,source,ordinals)).toBeNull();
 });
 it('does not interpret footer examples as narrative image ownership',()=>{
  const footer='\n<summary>附录例子 [img: 文档样例]</summary>',text=source.replace(/\[img:[^\]]+\]/g,'')+footer;
  const next=restoreStreamMarkers(text,source+footer,ordinals,['summary'])!;
  expect(findMarkers(next,['summary'])).toHaveLength(2);expect(next).toContain(footer);
 });
});
