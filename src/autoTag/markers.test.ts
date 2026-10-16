import { describe, expect, it } from 'vitest';
import { contextWithoutRepeatedTarget, markerSegments, prefixBefore, findMarkers, MarkerScanner, replaceMarkers } from './markers';
import { prepareTargetText } from './clean';

describe('stream analysis narrative context', () => {
  it('ignores placeholder examples without rejecting short genuine scene intents',()=>{
    expect(findMarkers('格式 [img: ...]\n[img: ……]\n[img: 中文画面意图]\n[img: 站台]')).toHaveLength(1);
    expect(findMarkers('[img: 站台]')[0].intent).toBe('站台');
  });
  it.each(['【正文回答字数统计】','【本轮字数统计】','## 正文字数统计','**字数统计**','【信息小结】','【本轮输出信息】'])('ignores %s footer even when it has a plausible real intent',heading=>{
    const story='旅人走到站台。\r\n[img: 站台相见]\r\n';
    const footer=heading+'\r\n本轮约6000字。\r\n[img: 旅人在站台挥手]';
    expect(findMarkers(story+footer).map(m=>m.intent)).toEqual(['站台相见']);
    expect(prepareTargetText(story+footer,[]).segments.map(s=>s.text)).toEqual(['旅人走到站台。']);
    expect(replaceMarkers(story+footer,['<slot>'])).toBe(story.replace('[img: 站台相见]','<slot>')+footer);
  });
  it('does not hide story dialogue mentioning statistics, and resumes at an explicit story section',()=>{
    const text='她指着纸上“字数统计”的标题。\n[img: 看纸张]\n【本轮字数统计】\n100字\n[img: 忽略]\n<now_plot>\n旅人推开门。\n[img: 推门]\n</now_plot>';
    expect(findMarkers(text).map(m=>m.intent)).toEqual(['看纸张','推门']);
    expect(markerSegments(text)[1].sourceLine).toBe(6);
  });
  it.each(['<draft>\n【字数统计】\n[img: 草稿]\n</draft>','<!--\n【字数统计】\n[img: 注释]\n-->'])('does not let hidden bookkeeping headings crop the following real prose',hidden=>{
    const text=hidden+'\n旅人推开门。\n[img: 推门]';
    expect(findMarkers(text).map(m=>m.intent)).toEqual(['推门']);
    expect(prepareTargetText(text,[]).segments.map(s=>s.text)).toEqual(['旅人推开门。']);
  });
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
