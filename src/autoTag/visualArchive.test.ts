import { describe, expect, it } from 'vitest';
import { parseVisualState, readVisualArchive, resolveVisualValue, visualPoint, visualStory, VISUAL_EXTRA } from './visualArchive';
import type { STMessage } from '@/st/context';

const story = (mes: string): STMessage => ({ name: 'AI', is_user: false, is_system: false, mes });
function saved(chat: STMessage[], floor: number, prefix: string, changes = {}) {
  const message = chat[floor];
  const basis = readVisualArchive(chat, floor, []).basis;
  message.extra = { [VISUAL_EXTRA]: { v: 1, branches: {
    [message.swipe_id ?? 0]: { basis, points: [visualPoint(visualStory(prefix, []), changes, '场景在车站')] },
  } } };
}

describe('current look across AI floors', () => {
  it('opens with the current value or the fixed fallback, including an explicit empty outfit', () => {
    const fixed = { outfit: 'blue coat', hair: 'black hair' };
    expect(resolveVisualValue('hair', { hair: 'ponytail' }, fixed)).toBe('ponytail');
    expect(resolveVisualValue('hair', { hair: null }, fixed)).toBe('black hair');
    expect(resolveVisualValue('hair', {}, fixed)).toBe('black hair');
    expect(resolveVisualValue('outfit', { outfit: '' }, fixed)).toBe('');
    expect(resolveVisualValue('makeup', {}, fixed)).toBe('');
  });

  it('trusts a visual summary only when the model confirmed coverage and used valid fields', () => {
    const changes = { 小满: { outfit: '', hair: 'ponytail', makeup: null } };
    expect(parseVisualState({ complete: true, facts: ' 站台等车 ', changes })).toEqual({ facts: '站台等车', changes });
    expect(parseVisualState({ complete: false, facts: '站台等车', changes })).toBeUndefined();
    expect(parseVisualState({ complete: true, facts: '站台等车', changes: { 小满: { outfit: [] } } })).toBeUndefined();
  });

  it('retains an outfit and a temporary look after an absent chapter; preserves subsequent unprocessed prose', () => {
    const first = '小满换了黄雨衣，扎好马尾。';
    const chat = [story(first + '\n<bbi_image><pending>出门</pending></bbi_image>\n她放下钥匙。'), story('齐远独自在站台等车。')];
    saved(chat, 0, first, { 小满: { outfit: 'yellow raincoat', hair: 'ponytail' } });
    const state = readVisualArchive(chat, 2, []);
    expect(state.changes).toEqual({ 小满: { outfit: 'yellow raincoat', hair: 'ponytail' } });
    expect(state.pending).toBe('她放下钥匙。\n\n齐远独自在站台等车。');
    expect(state.pending).not.toContain(first);
  });

  it('merges by field, clears a temporary value, and honors older picture positions', () => {
    const chat = [story('她扎上马尾，涂口红。'), story('她换上灰外套。\n她擦掉口红。')];
    saved(chat, 0, chat[0].mes, { 小满: { hair: 'ponytail', makeup: 'red lipstick' } });
    saved(chat, 1, chat[1].mes, { 小满: { outfit: 'gray jacket', makeup: null } });
    expect(readVisualArchive(chat, 1, [], '她换上灰外套。'.length).changes.小满).toEqual({ hair: 'ponytail', makeup: 'red lipstick' });
    expect(readVisualArchive(chat, 2, []).changes.小满).toEqual({ hair: 'ponytail', outfit: 'gray jacket', makeup: null });
  });

  it('rejects later summaries that depended on an edited or switched version', () => {
    const chat = [story('她换成黄外套。'), story('她走进站台。')];
    chat[0].swipes = [chat[0].mes, '她换成绿外套。'];
    saved(chat, 0, chat[0].mes, { 小满: { outfit: 'yellow coat' } });
    saved(chat, 1, chat[1].mes, { 小满: { makeup: 'silver eyeshadow' } });
    chat[0].swipe_id = 1;
    chat[0].mes = '她换成绿外套。';
    const archive = readVisualArchive(chat, 2, []);
    expect(archive.changes).toEqual({});
    expect(archive.pending).toBe('她换成绿外套。\n\n她走进站台。');
  });
});
