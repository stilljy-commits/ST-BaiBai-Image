<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { fetchNaiAccount, naiDefaultFreeImages, type NaiAccount } from '@/backends/naiAccount';

const props = defineProps<{ endpoint: { id: string; url: string; key: string } }>();
const root = ref<HTMLElement | null>(null), account = ref<NaiAccount | null>(null), loading = ref(false), error = ref(''), updated = ref(0);
let revision = 0, controller: AbortController | undefined, debounce: ReturnType<typeof setTimeout> | undefined, poll: ReturnType<typeof setInterval> | undefined;
const configured = computed(() => Boolean(props.endpoint.url.trim() && props.endpoint.key.trim()));
const number = (value: number | null) => value === null ? '未返回' : value.toLocaleString('zh-CN');
const freeImages = computed(() => naiDefaultFreeImages(account.value?.usage ?? null));
const updatedLabel = computed(() => updated.value ? new Date(updated.value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '');
const tierLabel = computed(() => account.value?.tier === null || !account.value ? '' : ['Free', 'Tablet', 'Scroll', 'Opus'][account.value.tier] || '');

async function refresh() {
  clearTimeout(debounce);
  if (loading.value || !configured.value) return;
  const owner = ++revision, connection = { url: props.endpoint.url, key: props.endpoint.key };
  controller?.abort(); const request = controller = new AbortController(); loading.value = true; error.value = '';
  try {
    const value = await fetchNaiAccount(connection, request.signal);
    if (owner !== revision || request.signal.aborted) return;
    account.value = value; updated.value = Date.now();
  } catch (failure) {
    if (owner !== revision || request.signal.aborted) return;
    error.value = failure instanceof Error ? failure.message : '暂时无法读取余额';
  } finally { if (owner === revision) { loading.value = false; controller = undefined; } }
}

watch(() => [props.endpoint.id, props.endpoint.url, props.endpoint.key], () => {
  revision++; controller?.abort(); controller = undefined; clearTimeout(debounce);
  // Clear synchronously, before an old request can show another account's balance.
  account.value = null; updated.value = 0; error.value = ''; loading.value = false;
  if (configured.value) debounce = setTimeout(refresh, 600);
}, { immediate: true, flush: 'sync' });

function refreshIfStale() {
  if (document.visibilityState === 'hidden' || Date.now() - updated.value < 60_000) return;
  if (root.value?.closest('.bbi-collapsible')?.classList.contains('is-open') === false) return;
  void refresh();
}
onMounted(() => {
  poll = setInterval(refreshIfStale, 60_000);
  window.addEventListener('focus', refreshIfStale); document.addEventListener('visibilitychange', refreshIfStale);
});
onBeforeUnmount(() => {
  revision++; controller?.abort(); clearTimeout(debounce); clearInterval(poll);
  window.removeEventListener('focus', refreshIfStale); document.removeEventListener('visibilitychange', refreshIfStale);
});
</script>

<template>
  <section ref="root" class="nai-account" aria-label="当前接入账号余额" :aria-busy="loading">
    <div class="nai-account__head">
      <span>当前账号余额<span v-if="tierLabel" class="nai-account__tier"> · {{ tierLabel }}</span></span>
      <button class="bbi-btn nai-account__refresh" type="button" :disabled="loading || !configured" aria-label="刷新当前接入账号余额" @click="refresh">
        <Icon name="refresh" :size="13" />{{ loading ? '读取中…' : '刷新' }}
      </button>
    </div>
    <div v-if="account" class="nai-account__values" aria-live="polite">
      <div class="nai-account__value">
        <span class="nai-account__label">Anlas 余额</span>
        <strong>{{ number(account.totalAnlas) }}</strong>
        <span class="nai-account__detail">订阅 {{ number(account.subscriptionAnlas) }} · 购买 {{ number(account.purchasedAnlas) }}</span>
      </div>
      <div class="nai-account__value">
        <span class="nai-account__label">V5 免费额度</span>
        <template v-if="account.usage">
          <strong>{{ account.usage.unavailable ? '暂不可用' : `${account.usage.percent}%` }}</strong>
          <span class="nai-account__detail">约 {{ number(freeImages) }} 张<span v-if="!account.usage.unavailable">（默认参数估算）</span></span>
          <span v-if="account.usage.purchasedPercent" class="nai-account__detail">另有额外额度 {{ account.usage.purchasedPercent }}%</span>
        </template>
        <span v-else class="nai-account__detail">该账号未返回免费额度</span>
      </div>
    </div>
    <p v-else-if="!configured" class="nai-account__hint">填写当前接入点的 API Key 后显示余额。</p>
    <p v-else-if="!error" class="nai-account__hint" role="status">{{ loading ? '正在读取当前账号…' : '准备查询余额…' }}</p>
    <p v-if="error" class="nai-account__error" role="status">{{ error }}<span v-if="account">，当前显示上次读取结果。</span></p>
    <div v-if="account" class="nai-account__foot">
      <span v-if="account.active === false">订阅未激活</span>
      <span v-else-if="account.usage">免费张数随模型、尺寸和步数变化。</span>
      <span v-else>余额来自当前接入点</span>
      <span>更新于 {{ updatedLabel }}</span>
    </div>
  </section>
</template>

<style scoped>
.nai-account { margin: 6px 0 18px; padding: 12px 14px; border: 1px solid var(--bbi-line); border-radius: var(--bbi-radius); background: var(--bbi-surface-2); }
.nai-account__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; font-weight: 600; }
.nai-account__tier, .nai-account__label, .nai-account__detail, .nai-account__hint, .nai-account__foot { color: var(--bbi-ink-muted); }
.nai-account__tier { font-weight: 400; }
.nai-account__refresh { flex: none; display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 4px 8px; font-size: 12px; }
.nai-account__values { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 12px; }
.nai-account__value { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.nai-account__value + .nai-account__value { padding-left: 16px; border-left: 1px solid var(--bbi-line); }
.nai-account__label, .nai-account__detail, .nai-account__hint, .nai-account__error, .nai-account__foot { font-size: 12px; line-height: 1.65; }
.nai-account__value strong { font-size: 22px; line-height: 1.25; font-weight: 650; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; color: var(--bbi-ink); }
.nai-account__hint, .nai-account__error { margin: 10px 0 0; }
.nai-account__error { color: var(--bbi-danger); }
.nai-account__foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-top: 10px; }
@media (max-width: 400px) { .nai-account { padding: 10px 12px; } .nai-account__values { gap: 10px; } .nai-account__value + .nai-account__value { padding-left: 10px; } }
</style>
