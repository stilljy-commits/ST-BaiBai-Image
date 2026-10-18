import { describe, expect, it } from 'vitest';
import { normalizeComicRuleTabs, renameComicRuleTab, selectComicRuleTab, updateComicRuleText } from './comicRuleTabs';

describe('five saved comic rule groups', () => {
  it.each(['原有规则\n 保留原来的空格与自然语言。', ''])('migrates the old single text without changing it: %j', rules => {
    const state = normalizeComicRuleTabs({ comicExtraRules: rules });
    expect(state.comicExtraRuleTabs).toHaveLength(5);
    expect(state.activeComicExtraRuleTab).toBe(0);
    expect(state.comicExtraRules).toBe(rules);
    expect(state.comicExtraRuleTabs.map(tab => tab.rules)).toEqual([rules, '', '', '', '']);
  });

  it('keeps five independent edits, names and the selected group through a settings round trip', () => {
    let state = normalizeComicRuleTabs({ comicExtraRules: '旧规则' });
    for (let index = 0; index < 5; index++) {
      selectComicRuleTab(state, index);
      renameComicRuleTab(state, `作品 ${index + 1}`);
      updateComicRuleText(state, `本作规则 ${index + 1}\n保留中文、English、@page 与换行。`);
    }
    state = normalizeComicRuleTabs(JSON.parse(JSON.stringify(state)));
    expect(state.activeComicExtraRuleTab).toBe(4);
    for (let index = 0; index < 5; index++) {
      selectComicRuleTab(state, index);
      expect(state.comicExtraRuleTabs[index].name).toBe(`作品 ${index + 1}`);
      expect(state.comicExtraRules).toBe(`本作规则 ${index + 1}\n保留中文、English、@page 与换行。`);
    }
  });

  it('treats an empty selected group as disabled without falling back to another group', () => {
    const state = normalizeComicRuleTabs({ comicExtraRules: '第一组要求' });
    selectComicRuleTab(state, 1);
    expect(state.comicExtraRules).toBe('');
    updateComicRuleText(state, '第二组要求');
    updateComicRuleText(state, '');
    selectComicRuleTab(state, 0);
    expect(state.comicExtraRules).toBe('第一组要求');
    selectComicRuleTab(state, 1);
    expect(normalizeComicRuleTabs(state).comicExtraRules).toBe('');
  });

  it('repairs malformed stored groups and ignores invalid selections without losing valid text', () => {
    const state = normalizeComicRuleTabs({ comicExtraRules: 'legacy', activeComicExtraRuleTab: 99,
      comicExtraRuleTabs: [{ name: '旅行', rules: '已有旅行规则' }, null, { name: 3, rules: '有效内容' }] });
    expect(state.comicExtraRuleTabs).toHaveLength(5);
    expect(state.comicExtraRuleTabs[2]).toEqual({ name: '方案 3', rules: '有效内容' });
    const before = JSON.stringify(state);
    for (const index of [-1, 5, 1.5, NaN]) selectComicRuleTab(state, index);
    expect(JSON.stringify(state)).toBe(before);
    expect(state.comicExtraRules).toBe('已有旅行规则');
  });
});
