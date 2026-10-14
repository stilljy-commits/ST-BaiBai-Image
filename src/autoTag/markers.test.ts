import { describe, expect, it } from 'vitest';
import { contextWithoutRepeatedTarget, markerSegments, prefixBefore } from './markers';

describe('stream analysis narrative context', () => {
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
