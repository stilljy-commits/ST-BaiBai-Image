<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import Icon from '@/components/Icon.vue';
import { saveImageFile } from '@/floor/download';
import { copyText } from '@/st/clipboard';
import { modalHost } from '@/state/ui';

/**
 * 图片灯箱(楼层卡片点击放大)。
 *
 * 为什么自建而不用 ST 原生:ST 的灯箱入口 `.mes_img` 只是个 class,真正的
 * expandMessageMedia 读的是 `chat[mesid].extra.media[data-index]` 数据模型,且该函数
 * 模块私有、未导出到 context——光加 class 会直接 bail。走官方 extra.media 那条路能白嫖
 * 灯箱,但图片会被挂到 `.mes_media_wrapper`(.mes_text 的兄弟节点),脱离 tag 的行内位置,
 * 与「图出现在 tag 所在段落」的核心设计冲突,还得再维护一份与 extra.bbiImage 平行的存储。
 *
 * 【长按保存】移动端能长按保存图片,靠三条约束共同保证,改动时务必保留:
 * 1. 只监听 click,绝不在图片上 preventDefault touchstart/touchend——长按唤出系统菜单时
 *    浏览器不会补发 click,两者天然不冲突;一旦自己拦 touch,长按保存立刻失效。
 * 2. 图片不加 user-select:none / -webkit-touch-callout:none / draggable=false。
 * 3. 显式 touch-action:auto 抵消 ST 的 `body{touch-action:none}`
 *    (css/mobile-styles.css:251,移动端 ≤1000px 全局)——它会干扰部分引擎的长按判定。
 * 【二段放大与平移】点击图片在「适应屏幕 ↔ 原始尺寸」间切换(放大 = 1:1 检查
 * 脸/手等细节,决定留还是重绘)。放大后的平移分两条路:
 * - 桌面:鼠标拖拽(pointer 事件只认 pointerType==='mouse',5px 阈值区分点击与拖动);
 * - 移动:stage 的原生溢出滚动,**不监听任何 touch 事件**(见上面三条约束)。
 * stage 居中用图片 margin:auto 而非 justify-content:center——后者会把放大后
 * 左/上两侧的溢出挤出滚动可达区(移动端「只能上下滚」的元凶)。
 */

const props = defineProps<{
  src: string;
  /** 提示词原文(复制用);空则不显示复制按钮。 */
  prompt?: string;
  /** 下载文件名。 */
  filename?: string;
  /** 有值才显示删除按钮。 */
  deletable?: boolean;
}>();

const emit = defineEmits<{ close: []; delete: [] }>();

/** 适应屏幕 ↔ 原始尺寸。 */
const zoomed = ref(false);

/** tags/提示词面板默认收起,点顶部按钮才展开。 */
const showInfo = ref(false);

/** 滚动容器(放大后平移用)。 */
const stage = ref<HTMLElement | null>(null);

/** 拖动平移后的那次 click 要吞掉,否则一拖完图片就缩回去了。 */
let suppressClick = false;

/** 点击切换缩放;放大时把点击点滚到视口中央(点哪看哪)。 */
async function onImageClick(event: MouseEvent): Promise<void> {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (zoomed.value) {
    zoomed.value = false;
    return;
  }
  const img = event.currentTarget as HTMLImageElement;
  const rect = img.getBoundingClientRect();
  const ratioX = (event.clientX - rect.left) / rect.width;
  const ratioY = (event.clientY - rect.top) / rect.height;
  zoomed.value = true;
  await nextTick();
  const el = stage.value;
  if (el) {
    el.scrollLeft = img.offsetWidth * ratioX - el.clientWidth / 2;
    el.scrollTop = img.offsetHeight * ratioY - el.clientHeight / 2;
  }
}

/**
 * 鼠标拖拽平移(仅放大态、仅鼠标)。
 * 触屏不碰:触摸平移交给 stage 的原生溢出滚动(img 上的 touch-action:auto 就是
 * 为它和长按保存留的),自己拦触摸会违反顶部的长按保存三约束。
 */
let pan: { x: number; y: number; left: number; top: number; moved: boolean } | null = null;

function onPointerDown(event: PointerEvent): void {
  if (!zoomed.value || event.pointerType !== 'mouse' || event.button !== 0) return;
  const el = stage.value;
  if (!el) return;
  pan = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onPointerMove(event: PointerEvent): void {
  const el = stage.value;
  if (!pan || !el) return;
  const dx = event.clientX - pan.x;
  const dy = event.clientY - pan.y;
  if (!pan.moved && Math.hypot(dx, dy) < 5) return; // 阈值内算点击,保留点击缩放
  pan.moved = true;
  el.scrollLeft = pan.left - dx;
  el.scrollTop = pan.top - dy;
}

function onPointerUp(): void {
  if (pan?.moved) suppressClick = true;
  pan = null;
}

/** 放大态平移时拦掉图片原生拖拽残影;非放大态保持原生行为,一概不动。 */
function onDragStart(event: DragEvent): void {
  if (zoomed.value) event.preventDefault();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
  }
}

onMounted(() => {
  // 捕获阶段:抢在 ST 的全局快捷键之前拿到 Esc
  document.addEventListener('keydown', onKeydown, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true);
});

async function copyPrompt(): Promise<void> {
  await copyText(props.prompt ?? '', '提示词已复制');
}

function save(): void {
  saveImageFile(props.src, props.filename);
}

const promptText = computed(() => (props.prompt ?? '').trim());
</script>

<template>
  <!-- Teleport 到 modalHost(.bbi-root 直接子级):灯箱需要 --bbi-* 主题变量,
       而 lightbox.ts 的容器挂在 shadow root 顶层、在 .bbi-root 之外拿不到变量。
       与 ConfirmDialog 同款手法。 -->
  <Teleport :to="modalHost" :disabled="!modalHost">
    <!-- 遮罩自身承接关闭点击;图片与操作栏 stop 掉,避免误关 -->
    <div class="bbi-lightbox" @click="emit('close')">
      <div class="bbi-lightbox__bar" @click.stop>
        <button class="bbi-lb-btn" type="button" title="保存图片" @click="save">
          <Icon name="download" :size="18" />
        </button>
        <button
          v-if="promptText"
          class="bbi-lb-btn"
          :class="{ 'bbi-lb-btn--on': showInfo }"
          type="button"
          :title="showInfo ? '收起提示词' : '查看提示词/TAGS'"
          :aria-expanded="showInfo"
          @click="showInfo = !showInfo"
        >
          <Icon name="text" :size="18" />
        </button>
        <button
          v-if="promptText"
          class="bbi-lb-btn"
          type="button"
          title="复制提示词"
          @click="copyPrompt"
        >
          <Icon name="copy" :size="18" />
        </button>
        <button
          v-if="deletable"
          class="bbi-lb-btn bbi-lb-btn--danger"
          type="button"
          title="删除这张图"
          @click="emit('delete')"
        >
          <Icon name="trash" :size="18" />
        </button>
        <button class="bbi-lb-btn" type="button" title="关闭 (Esc)" @click="emit('close')">
          <Icon name="close" :size="18" />
        </button>
      </div>

      <!-- 图片容器:zoomed 时滚动(触屏)/ 鼠标拖拽查看原图 -->
      <div
        ref="stage"
        class="bbi-lightbox__stage"
        :data-zoomed="zoomed ? '1' : ''"
        @click.stop="emit('close')"
      >
        <img
          class="bbi-lightbox__img"
          :src="src"
          alt="生图结果"
          :data-zoomed="zoomed ? '1' : ''"
          @click.stop="onImageClick"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @dragstart="onDragStart"
        />
      </div>

      <!-- tags/提示词:默认收起,点顶部 text 按钮展开;悬浮在图片底部,不挤压图片 -->
      <Transition name="bbi-lb-info">
        <p v-if="promptText && showInfo" class="bbi-lightbox__prompt" @click.stop>{{ promptText }}</p>
      </Transition>
    </div>
  </Teleport>
</template>

<style scoped>
.bbi-lightbox {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  /* 与 base.css 的遮罩同款:部分移动端 WebView 不认 inset/百分比链,显式给视口高 */
  height: 100vh;
  height: 100dvh;
  z-index: 10050;
  display: flex;
  flex-direction: column;
  /* 全屏相册式:无 padding/gap,图片直接占满视口;按钮栏与 tags 面板均为悬浮层 */
  background: oklch(0 0 0 / 0.92);
  backdrop-filter: blur(6px);
}

.bbi-lightbox__bar {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 2;
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  /* 悬浮在图片上方:留出安全边距,半透明渐变垫底保证浅色图上按钮可读 */
  padding: 12px 16px;
  background: linear-gradient(to bottom, oklch(0 0 0 / 0.45), transparent);
}

.bbi-lb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: 1px solid oklch(1 0 0 / 0.18);
  border-radius: var(--bbi-radius-pill);
  background: oklch(1 0 0 / 0.1);
  color: oklch(1 0 0 / 0.92);
  cursor: pointer;
  transition:
    background var(--bbi-dur) var(--bbi-ease),
    border-color var(--bbi-dur) var(--bbi-ease);
}

.bbi-lb-btn:hover {
  background: oklch(1 0 0 / 0.2);
  border-color: oklch(1 0 0 / 0.4);
}

.bbi-lb-btn--danger:hover {
  background: var(--bbi-danger);
  border-color: var(--bbi-danger);
  color: #fff;
}

/* tags 按钮的激活态:面板展开时高亮,提示当前可见 */
.bbi-lb-btn--on {
  background: oklch(1 0 0 / 0.28);
  border-color: oklch(1 0 0 / 0.55);
}

/* 居中不用 justify-content/align-items:center:放大后图片比容器宽时,flex 居中
   会把左/上两侧的溢出挤出滚动可达区(移动端「只能上下滚」的元凶)。
   改用图片自身 margin:auto——小时居中,大时自动边距归零、起点对齐,四向皆可滚。 */
.bbi-lightbox__stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: auto;
}

.bbi-lightbox__img {
  display: block;
  margin: auto;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: var(--bbi-radius-sm);
  cursor: zoom-in;
  /* 抵消 ST 的 body{touch-action:none}(css/mobile-styles.css:251):
     它会干扰部分引擎的长按保存判定,也会挡住放大后的触屏原生滚动。见 <script> 顶部注释。 */
  touch-action: auto;
}

/* 原始尺寸:超出部分由 __stage 滚动(触屏)/ 鼠标拖拽查看 */
.bbi-lightbox__img[data-zoomed='1'] {
  max-width: none;
  max-height: none;
  cursor: grab;
}

.bbi-lightbox__img[data-zoomed='1']:active {
  cursor: grabbing;
}

/* 放大态找回细滚动条(base.css 在 .bbi-root 内全局隐藏了滚动条),
   给个「现在看到哪了」的位置感 */
.bbi-lightbox__stage[data-zoomed='1'] {
  scrollbar-width: thin;
  scrollbar-color: oklch(1 0 0 / 0.3) transparent;
}

.bbi-lightbox__stage[data-zoomed='1']::-webkit-scrollbar {
  width: 6px;
  height: 6px;
  display: block;
}

.bbi-lightbox__stage[data-zoomed='1']::-webkit-scrollbar-thumb {
  background: oklch(1 0 0 / 0.25);
  border-radius: 3px;
}

.bbi-lightbox__prompt {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  max-height: 40%;
  overflow-y: auto;
  margin: 0;
  padding: 14px 16px;
  /* 底部渐变垫底:面板悬浮在图片上时文字始终可读 */
  background: linear-gradient(to top, oklch(0 0 0 / 0.78), oklch(0 0 0 / 0.45) 70%, transparent);
  color: oklch(1 0 0 / 0.88);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  /* 提示词要可选中复制,故此处不禁用选择 */
  user-select: text;
}

/* tags 面板展开/收起过渡:自下而上滑入淡入 */
.bbi-lb-info-enter-active,
.bbi-lb-info-leave-active {
  transition:
    transform 0.22s var(--bbi-ease, ease),
    opacity 0.22s var(--bbi-ease, ease);
}

.bbi-lb-info-enter-from,
.bbi-lb-info-leave-to {
  transform: translateY(14px);
  opacity: 0;
}
</style>
