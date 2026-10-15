import { describe, expect, it } from 'vitest';
import { contextWithoutRepeatedTarget, markerSegments, prefixBefore, findMarkers, MarkerScanner, replaceMarkers } from './markers';
import { prepareTargetText } from './clean';

describe('stream analysis narrative context', () => {
  it('ignores planned markers in open and closed drafts, retaining only actual story markers',()=>{
    const scanner=new MarkerScanner();
    const draft='<draft>\n只是在规划画面。\n[img: 门口]\n';
    expect(scanner.feed(draft)).toEqual([]);
    const text=draft+'</draft>\n<now_plot>\n她走到车站门口。\n[img: 门口]\n</now_plot>';
    expect(scanner.feed(text).map(marker=>marker.intent)).toEqual(['门口']);
    expect(findMarkers(text).map(marker=>marker.index)).toEqual([text.lastIndexOf('[img: 门口]')]);
    expect(markerSegments(text)[0].segment).not.toContain('规划画面');
  });
  it('preserves physical lines and replacements when a draft repeats the final marker intent',()=>{
    const draft='<draft>😀规划。\r\n[img: 门口]\r\n</draft>\r\n';
    const text=draft+'<now_plot>\r\n她走到车站门口。\r\n[img: 门口]\r\n</now_plot>';
    const segment=markerSegments(text)[0];
    expect(segment.segment).toBe('她走到车站门口。');expect(segment.sourceLine).toBe(4);
    expect(prepareTargetText(segment.segment,[]).segments[0].sourceLine+segment.sourceLine).toBe(prepareTargetText(text,[]).segments[0].sourceLine);
    expect(replaceMarkers(text,['<image-slot>'])).toBe(draft+'<now_plot>\r\n她走到车站门口。\r\n<image-slot>\r\n</now_plot>');
  });
  it('ignores markers in configured hidden blocks and unfinished comments without hiding the next real story',()=>{
    expect(findMarkers('<hidden>\n[img: 计划]', ['hidden'])).toEqual([]);
    expect(findMarkers('<!-- <draft> [img: 计划] -->\n她到达。\n[img: 到达]').map(marker=>marker.intent)).toEqual(['到达']);
    expect(findMarkers('<!-- [img: 未闭合注释]')).toEqual([]);
    expect(findMarkers('<draft_notes>\n[img: 计划]\n</draft_notes>\n她到达。\n[img: 到达]').map(marker=>marker.intent)).toEqual(['到达']);
  });
  it('keeps earlier outfit, props and scene facts, while sending the whole target once', () => {
    const text='她穿着白裙，手里拿着钥匙。\n[img: 交接钥匙]\n她用钥匙打开车站的门。\n[img: 推门]';
    const segments=markerSegments(text),prefix=prefixBefore(text,1,6000),target=segments[1].segment;
    const before=contextWithoutRepeatedTarget(prefix,target);
    expect(before).toContain('白裙'); expect(before).toContain('拿着钥匙'); expect(before).not.toContain(target);
    expect(before+'\n'+target).toContain('她用钥匙打开车站的门。');
  });
  it('removes a repeated tail when the full target exceeds the prefix window', () => {
    const target='她推开门。\n'+'车站的光线照进走廊。'.repeat(800);
    expect(contextWithoutRepeatedTarget(target.slice(-6000),target)).toBe('');
    expect(target).toContain('她推开门');
  });
  it('keeps an ambiguous partial match and an empty target unchanged', () => {
    expect(contextWithoutRepeatedTarget('旧场景。部分相同','部分相同但实际不同')).toBe('旧场景。部分相同');
    expect(contextWithoutRepeatedTarget('旧场景。','')).toBe('旧场景。');
  });
});
