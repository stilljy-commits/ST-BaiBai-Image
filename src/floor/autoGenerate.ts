/**
 * 「写入 tag 后自动生成图片」握手(autoTag.autoGenerate,默认开)。
 *
 * 时序：runner / 编辑器写入前标记本次槽位 → 正文保存成功 → 任务层消费标记并入队。
 * 不等待卡片挂载、滚动、屏幕位置或宿主渲染；卡片只展示任务状态。
 * 标记一次性，写回失败撤销，切聊天/删楼清空；已有图和在途任务不会重复启动。
 *
 * 两种模式(mode):
 * - 'auto':自动流程(runner 写完 tag)。仅在「这条提示词还没有图」时才开跑,
 *   已有结果/在途任务时让位给用户手动操作。
 * - 'force':用户明确点了「应用并重新生成」(提示词编辑弹窗)。无条件开跑 ——
 *   来回改回旧提示词时该桶可能已有历史(phase=ready),但用户要的就是新图。
 */

/** 标记模式:见文件头注释。 */
export type AutoGenerateMode = 'auto' | 'force';

/** 卡片展示相位(与 Card.vue 的 Phase 同构;这里只列判定用得到的)。 */
export type AutoGeneratePhase = 'pending' | 'queued' | 'generating' | 'ready' | 'stale' | 'error';

const flags = new Map<string, AutoGenerateMode>();

function key(chatId: string, messageId: number, swipeId: number, seq: number): string {
  return `${chatId}|${messageId}|${swipeId}|${seq}`;
}

export function markForAutoGenerate(
  chatId: string,
  messageId: number,
  swipeId: number,
  seq: number,
  mode: AutoGenerateMode = 'auto',
): void {
  flags.set(key(chatId, messageId, swipeId, seq), mode);
}

/** 消费本槽位的自动生成标记:有则删除并返回其模式(只触发一次),无则 null。 */
export function consumeAutoGenerate(
  chatId: string,
  messageId: number,
  swipeId: number,
  seq: number,
): AutoGenerateMode | null {
  const k = key(chatId, messageId, swipeId, seq);
  const mode = flags.get(k);
  if (mode === undefined) return null;
  flags.delete(k);
  return mode;
}

/**
 * 该不该真的开跑。**刻意做成纯函数**:Card.vue 没有单测(仓里没装 jsdom /
 * @vue/test-utils,vitest 跑在 node 环境),判定留在组件里就锁不住。
 *
 * 'auto' 放过 pending 与 **stale**:stale 的含义正是「tag 变了、当前提示词还没有图」,
 * 这恰恰是该自动出图的时刻。曾经这里只放 pending,导致楼层「重新生成 tag」在已出过图的
 * 楼层上静默失效(新 tag 写进去了、卡片却停在旧图不动);多 tag 楼层更怪 —— 有旧图的
 * 槽位被拦、纯新增的槽位照跑,看起来「一半在生成一半不动」。
 *
 * ready / queued / generating / error 仍然不放:已有本提示词的结果、已有在途任务,
 * 或上一轮刚失败(重试交给用户点,免得错误配置下自动重试打满后端)。
 */
export function shouldAutoGenerate(mode: AutoGenerateMode, phase: AutoGeneratePhase): boolean {
  if (mode === 'force') return true;
  return phase === 'pending' || phase === 'stale';
}

/** 撤销某楼层的全部标记(写回正文失败时调用)。 */
export function clearAutoGenerateForFloor(chatId: string, messageId: number): void {
  const prefix = `${chatId}|${messageId}|`;
  for (const k of [...flags.keys()]) {
    if (k.startsWith(prefix)) flags.delete(k);
  }
}

/** 清空全部标记(切聊天 / 删楼后的全量重建时调用)。 */
export function clearAutoGenerateFlags(): void {
  flags.clear();
}
