<script setup lang="ts">
import { computed, nextTick } from 'vue';
import BbiTextarea from '@/components/BbiTextarea.vue';
import { settings } from '@/state/settings';
import { ensureComicRuleTabs, renameComicRuleTab, selectComicRuleTab, updateComicRuleText } from '@/state/comicRuleTabs';

ensureComicRuleTabs(settings.nai);
const tabs = computed(() => settings.nai.comicExtraRuleTabs!);
const active = computed(() => settings.nai.activeComicExtraRuleTab ?? 0);
const name = computed({
  get: () => tabs.value[active.value].name,
  set: (value: string) => renameComicRuleTab(settings.nai, value),
});
const rules = computed({
  get: () => settings.nai.comicExtraRules ?? '',
  set: (value: string) => updateComicRuleText(settings.nai, value),
});
const label = (index: number) => tabs.value[index].name.trim() || `方案 ${index + 1}`;

function onTabKey(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  let index: number;
  if (event.key === 'ArrowRight') index = (active.value + 1) % tabs.value.length;
  else if (event.key === 'ArrowLeft') index = (active.value + tabs.value.length - 1) % tabs.value.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.value.length - 1;
  else return;
  event.preventDefault();
  const parent = (event.currentTarget as HTMLElement).parentElement;
  selectComicRuleTab(settings.nai, index);
  void nextTick(() => parent?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus());
}
</script>

<template>
  <div class="comic-extra-rules">
    <div class="bbi-field-label">漫画模式附加规则</div>
    <div class="comic-rule-tabs" role="tablist" aria-label="漫画附加规则方案">
      <button
        v-for="(_, index) in tabs"
        :id="`bbi-comic-rule-tab-${index}`"
        :key="index"
        type="button"
        role="tab"
        class="comic-rule-tab"
        :class="{ 'is-active': active === index }"
        :aria-selected="active === index"
        aria-controls="bbi-comic-rule-panel"
        :tabindex="active === index ? 0 : -1"
        :title="`${label(index)}${active === index ? '（当前生效）' : '（点击切换生效）'}`"
        @click="selectComicRuleTab(settings.nai, index)"
        @keydown="onTabKey"
      >{{ label(index) }}</button>
    </div>
    <div id="bbi-comic-rule-panel" role="tabpanel" :aria-labelledby="`bbi-comic-rule-tab-${active}`">
      <label class="comic-rule-name">
        <span class="bbi-field-label">方案名称</span>
        <input v-model="name" class="bbi-input" type="text" maxlength="24" placeholder="例如：旅行日常" />
      </label>
      <BbiTextarea
        v-model="rules"
        :rows="6"
        :max-rows="14"
        aria-label="当前方案的漫画附加规则"
        placeholder="直接写画面需求，例如：以人物互动为主，背景简洁，连续场景保持衣着与道具一致。"
      />
    </div>
    <p class="bbi-field-hint" aria-live="polite">
      当前仅「{{ label(active) }}」生效，五组内容分别保存。可用中文或英文描述画面需求，画面偏好优先于默认取舍；图片数量、对白开关仍按对应设置执行。清空本组表示不追加规则，修改与切换从下一轮分析生效。
    </p>
  </div>
</template>

<style scoped>
.comic-extra-rules { min-width: 0; }
.comic-rule-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 5px;
  margin: 8px 0 10px;
}
.comic-rule-tab {
  min-width: 0;
  overflow: hidden;
  padding: 7px 5px;
  border: 1px solid var(--bbi-line-strong);
  border-radius: var(--bbi-radius-sm);
  background: var(--bbi-surface);
  color: var(--bbi-ink-soft);
  font: inherit;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.comic-rule-tab.is-active {
  border-color: var(--bbi-accent);
  background: var(--bbi-accent-soft);
  color: var(--bbi-accent);
  font-weight: 600;
}
.comic-rule-tab:focus-visible { outline: 2px solid var(--bbi-accent); outline-offset: 2px; }
.comic-rule-name { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.comic-rule-name > .bbi-field-label { flex: 0 0 auto; }
.comic-rule-name > input { min-width: 0; flex: 1; }
</style>
