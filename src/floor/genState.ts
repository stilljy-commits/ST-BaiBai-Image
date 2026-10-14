import { reactive } from 'vue';

/**
 * 楼层卡片「生成运行态」的模块级 store。
 *
 * 为什么必须放在组件外:卡片的生命周期由水合决定,不由它自己决定。任一槽位出图成功都会
 * 调 hydrateMessage 重水合,而重水合会卸载**整楼**卡片(hydrate.ts)——ST 重渲染楼层时
 * 锚点 DOM 本身也会重建。运行态若存在组件 ref 里,卡片一被重建就清零:兄弟卡片的
 * 「生成中…」凭空消失、退回 pending,而 autoGenerate 标记早已消费掉不会再跑。
 * 把 phase/error/controller 提到这里,卡片退化成纯展示层,重建后按 key 认领回自己的状态。
 *
 * key = chatId|messageId|swipeId|seq,与 floor/registry.ts、floor/autoGenerate.ts 同构
 * (DESIGN-FLOOR-UI.md §8.1 的「任务身份」)。
 */

/** 运行态相位。派生态(pending/ready/stale)由卡片按 props 自行判断,不进 store。 */
export type GenPhase = 'queued' | 'generating' | 'error';

export interface GenRecord {
  phase: GenPhase;
  /** error 相位的错误信息;其余相位为空串。 */
  error: string;
  /**
   * 队列中前面还有几个任务(ComfyUI 服务端队列)。
   * 0 = 已轮到自己执行;null = 未知(NAI 无队列概念,或队列接口不可用)。
   */
  queueAhead: number | null;
  /**
   * 限流退避进度:非 null 表示请求失败了、正在等着重试(见 backends/naiRateLimit.ts)。
   * 必须让用户看见 —— 否则卡片会挂着一动不动的「生成中…」几十秒,
   * 用户只会以为卡死了,再点一次,那就白白多压一个请求上去。
   */
  retry: { attempt: number; max: number } | null;
  /**
   * 发起时的 promptHash。重水合后卡片用它确认「在途任务属于当前提示词」——
   * 用户中途改了 tag,key 不变但 hash 变,旧任务的结果已无意义(见 reconcile)。
   */
  hash: string;
  /**
   * 本次任务的唯一票据。**key 不足以标识任务**:同一槽位可以先后跑多个任务
   * (取消后重绘、reconcile 后重来),它们共用 key。旧任务迟到的回调必须凭票据认领,
   * 否则会改到新任务的记录上——例如 A 被 abort 后以非 AbortError 失败(HTTP 500/429
   * 与 abort 撞在一起),其 catch 会把**正在跑的 B** 标成 error:UI 显示红字报错、
   * 「取消」按钮变回「重绘」,用户还能在 B 之上再开一个任务。
   */
  token: number;
}

export function slotKey(chatId: string, messageId: number, swipeId: number, seq: number, slotId?: string): string {
  return `${chatId}|${messageId}|${swipeId}|${slotId ? `id:${slotId}` : seq}`;
}

/** 展示态:进 reactive,卡片 computed 直接读。 */
const records = reactive(new Map<string, GenRecord>());

/**
 * AbortController 另存一张普通 Map,不进 reactive:
 * controller 不是展示数据,包成 Proxy 只有开销没有收益。
 */
const controllers = new Map<string, AbortController>();

export function getGenRecord(key: string): GenRecord | undefined {
  return records.get(key);
}

/** 单调递增的任务票据。 */
let nextToken = 1;

/** 本次任务的句柄:signal 传给后端,token 用于所有回写(防旧任务改到新任务头上)。 */
export interface GenHandle {
  signal: AbortSignal;
  token: number;
}

/**
 * 开始一次生成:登记运行态并返回本次任务句柄。
 * 同 key 已有在途任务时先中止旧的(同一槽位不允许两个任务并存,后发者为准)。
 */
export function beginGen(key: string, hash: string, phase: GenPhase = 'generating'): GenHandle {
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  const token = nextToken++;
  records.set(key, { phase, error: '', queueAhead: null, retry: null, hash, token });
  return { signal: controller.signal, token };
}

/** 票据不符 = 调用来自已被取代的旧任务,一律忽略。 */
function owned(key: string, token: number): GenRecord | null {
  const record = records.get(key);
  return record && record.token === token ? record : null;
}

/** 本任务是否仍是该槽位的当前任务(落盘前自检,别把旧任务的图写进 extra)。 */
export function isCurrentGen(key: string, token: number): boolean {
  return !!owned(key, token);
}

/** 相位推进(queued → generating):任务不变,只改展示。 */
export function setGenPhase(key: string, token: number, phase: GenPhase): void {
  const record = owned(key, token);
  if (record) record.phase = phase;
}

/** 更新排队位置(ComfyUI 轮询期间上报)。 */
export function setQueueAhead(key: string, token: number, ahead: number | null): void {
  const record = owned(key, token);
  if (record) record.queueAhead = ahead;
}

/** 更新限流退避进度(NAI 重试期间上报;传 null 表示已不在退避中)。 */
export function setGenRetry(
  key: string,
  token: number,
  retry: { attempt: number; max: number } | null,
): void {
  const record = owned(key, token);
  if (record) record.retry = retry;
}

/** 生成成功/放弃:清运行态,卡片回落到派生态(ready/stale/pending)。 */
export function clearGen(key: string, token?: number): void {
  // 不带 token 表示无条件清(取消/全量重建);带 token 时只有本任务仍在位才清
  if (token !== undefined && !owned(key, token)) return;
  controllers.delete(key);
  records.delete(key);
}

/** 生成失败:保留 error 相位与信息(重水合后仍能看到失败原因),controller 已无用。 */
export function failGen(key: string, token: number, message: string): void {
  const record = owned(key, token);
  if (!record) return;
  controllers.delete(key);
  record.phase = 'error';
  record.error = message;
  record.queueAhead = null;
  // 退避已经结束(重试次数用尽才走到这儿),别让红字上面还挂着「稍后重试」
  record.retry = null;
}

/** 用户取消:中止在途请求并清运行态。无在途任务时是安全空操作。 */
export function cancelGen(key: string): void {
  controllers.get(key)?.abort();
  clearGen(key);
}

/**
 * 提示词已变时的对账:在途任务的 hash 与当前卡片 hash 不一致 → 该任务属于旧提示词,
 * 中止并清掉(卡片随即按 stale/pending 展示)。error 相位同理作废,不然改完 tag
 * 还挂着上一版的报错。返回 true 表示确实清理了。
 */
export function reconcileGen(key: string, hash: string): boolean {
  const record = records.get(key);
  if (!record || record.hash === hash) return false;
  cancelGen(key);
  return true;
}

/** 中止并清空全部(切聊天 / 删楼后的全量重建)。 */
export function clearAllGen(): void {
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  records.clear();
}

/**
 * 中止并清掉某 swipe 下「已不存在的槽位」记录(seq >= keepCount)。
 *
 * 为什么需要它:reconcileGen 只能由**挂载着的卡片**触发,而槽位可能整个消失——
 * 用户把 tag 从正文里删掉、或 swipe 到 tag 更少的一版,那些槽位再也没有卡片来对账,
 * 记录(尤其 failGen 留下的 error)会永久留在 Map 里;之后同一 key 若重新出现
 * (重新生成 tag,回到相同 messageId|swipeId|seq),新卡片会认领到上一轮的旧报错。
 *
 * **只删越界槽位**,不动 seq < keepCount 的:hydrateMessage 在每次出图成功后都会跑,
 * 那时兄弟槽位往往正在生成中,连它们一起清会把在途请求全 abort 掉
 * ——那正是本次重构要修的 bug,不能在这儿以另一种形式复现。
 */
export function pruneGenSlots(
  chatId: string,
  messageId: number,
  swipeId: number,
  keepCount: number,
  keepIds?: ReadonlySet<string>,
): void {
  const prefix = `${chatId}|${messageId}|${swipeId}|`;
  for (const key of [...records.keys()]) {
    if (!key.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (suffix.startsWith('id:')) { if (keepIds && !keepIds.has(suffix.slice(3))) cancelGen(key); continue; }
    const seq = Number(suffix);
    if (Number.isInteger(seq) && seq >= keepCount) cancelGen(key);
  }
}

/** 当前在途(queued/generating)任务数,按后端并发闸门统计用。 */
export function activeGenCount(): number {
  let count = 0;
  for (const record of records.values()) {
    if (record.phase === 'queued' || record.phase === 'generating') count++;
  }
  return count;
}
