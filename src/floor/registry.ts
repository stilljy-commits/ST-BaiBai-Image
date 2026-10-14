import type { VNode } from 'vue';

/**
 * 楼层卡片挂载记录表（DESIGN-FLOOR-UI.md §6.2）。
 *
 * key = (chatId, mesid, swipeId, seq)：
 * - mesid 定位楼层，seq 定位楼层内第 N 个锚点（DOM 顺序 = tag 序号）。
 * - swipeId 进 key，滑动切换时各 swipe 的记录互不污染。
 * - 重水合时同锚点的槽位直接 patch（hydrate.ts 差分策略）；锚点更换或槽位消失
 *   时必须 render(null, container) 显式卸载旧 vnode，再挂新树。
 */
export interface SlotRecord {
  /**
   * vnode 的渲染容器：锚点 div 的 shadow root（hydrate.ts 给每个锚点 attachShadow，
   * 让卡片与 ST 全局样式双向隔离）。render(null, container) 卸载。
   */
  container: ShadowRoot;
  vnode: VNode;
}

export class SlotRegistry {
  private records = new Map<string, SlotRecord>();

  key(chatId: string | undefined, mesid: number, swipeId: number | undefined, seq: number, slotId?: string): string {
    return `${chatId ?? '-'}|${mesid}|${swipeId ?? '-'}|${slotId ? `id:${slotId}` : seq}`;
  }

  /** 某消息的全部槽位 key（跨 swipeId）。重水合该消息前用它清理旧记录。 */
  keysByMessage(chatId: string | undefined, mesid: number): string[] {
    const prefix = `${chatId ?? '-'}|${mesid}|`;
    return [...this.records.keys()].filter(key => key.startsWith(prefix));
  }

  has(key: string): boolean {
    return this.records.has(key);
  }

  get(key: string): SlotRecord | undefined {
    return this.records.get(key);
  }

  set(key: string, record: SlotRecord): void {
    this.records.set(key, record);
  }

  delete(key: string): void {
    this.records.delete(key);
  }

  /** 全部记录（卸载时遍历用）。 */
  all(): SlotRecord[] {
    return [...this.records.values()];
  }

  /** 全部 key（卸载时遍历用）。 */
  keys(): string[] {
    return [...this.records.keys()];
  }

  clear(): void {
    this.records.clear();
  }

  get size(): number {
    return this.records.size;
  }
}
