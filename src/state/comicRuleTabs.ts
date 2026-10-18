/** Five saved rule groups; comicExtraRules remains the active text consumed by every analysis mode. */
export interface ComicRuleTab {
  name: string;
  rules: string;
}
export interface ComicRuleTabsState {
  comicExtraRules?: string;
  comicExtraRuleTabs?: ComicRuleTab[];
  activeComicExtraRuleTab?: number;
}
export const COMIC_RULE_TAB_COUNT = 5;
const defaultName = (index: number) => `方案 ${index + 1}`;
const validIndex = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) < COMIC_RULE_TAB_COUNT;

/** Old single-text settings migrate verbatim to the first group, including an intentionally empty value. */
export function normalizeComicRuleTabs(raw: unknown, defaultRules = '') {
  const value = raw && typeof raw === 'object' ? raw as ComicRuleTabsState : {};
  const legacy = typeof value.comicExtraRules === 'string' ? value.comicExtraRules : defaultRules;
  const stored = Array.isArray(value.comicExtraRuleTabs) ? value.comicExtraRuleTabs : [];
  const active = validIndex(value.activeComicExtraRuleTab) ? value.activeComicExtraRuleTab : 0;
  const tabs = Array.from({ length: COMIC_RULE_TAB_COUNT }, (_, index): ComicRuleTab => {
    const tab = stored[index];
    return {
      name: typeof tab?.name === 'string' ? tab.name.trim().slice(0, 24) || defaultName(index) : defaultName(index),
      rules: typeof tab?.rules === 'string' ? tab.rules : index === active ? legacy : '',
    };
  });
  return { comicExtraRuleTabs: tabs, activeComicExtraRuleTab: active, comicExtraRules: tabs[active].rules };
}

export function ensureComicRuleTabs(state: ComicRuleTabsState): void {
  if (!Array.isArray(state.comicExtraRuleTabs) || state.comicExtraRuleTabs.length !== COMIC_RULE_TAB_COUNT
    || !state.comicExtraRuleTabs.every(tab => tab && typeof tab.name === 'string' && typeof tab.rules === 'string')
    || !validIndex(state.activeComicExtraRuleTab)) Object.assign(state, normalizeComicRuleTabs(state));
}

export function selectComicRuleTab(state: ComicRuleTabsState, index: number): void {
  if (!validIndex(index)) return;
  ensureComicRuleTabs(state);
  state.comicExtraRuleTabs![state.activeComicExtraRuleTab!].rules = state.comicExtraRules ?? '';
  state.activeComicExtraRuleTab = index;
  state.comicExtraRules = state.comicExtraRuleTabs![index].rules;
}

export function updateComicRuleText(state: ComicRuleTabsState, text: string): void {
  ensureComicRuleTabs(state);
  state.comicExtraRules = text;
  state.comicExtraRuleTabs![state.activeComicExtraRuleTab!].rules = text;
}

export function renameComicRuleTab(state: ComicRuleTabsState, name: string): void {
  ensureComicRuleTabs(state);
  state.comicExtraRuleTabs![state.activeComicExtraRuleTab!].name = name.slice(0, 24);
}
