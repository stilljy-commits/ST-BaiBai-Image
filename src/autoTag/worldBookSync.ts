import { getContext } from '@/st/context';
import { settings } from '@/state/settings';

const TITLE = '【正文配图标记';
const RANGE = /(本楼配图数量(?:必须)?(?:控制)?在\s*)\d+\s*[~～]\s*\d+(\s*张(?:之间|以内)?)/;
const MAX = /(本楼配图数量不超过\s*)\d+(\s*张)/;
let chain: Promise<unknown> = Promise.resolve();

export function rewriteCountLine(text: string, min: number, max: number): string {
  return RANGE.test(text) ? text.replace(RANGE, `$1${min}~${max}$2`) : text.replace(MAX, `$1${max}$2`);
}
/** Changes only the existing count line. No startup write or automatic creation. */
export function syncWorldBookRule(): Promise<boolean> {
  const name = settings.autoTag.streamWorldBook?.trim();
  if (!name) return Promise.resolve(false);
  const min = settings.autoTag.minImages, max = settings.autoTag.maxImages;
  const task = chain.then(async () => {
    const ctx = getContext(); if (!ctx?.getRequestHeaders) return false;
    const response = await fetch('/api/worldinfo/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name }) });
    if (!response.ok) throw new Error(`读取世界书失败 (${response.status})`);
    const data = await response.json() as { entries?: Record<string, { content?: string }> };
    const rules = Object.values(data.entries ?? {}).filter(entry => entry.content?.trimStart().startsWith(TITLE));
    if (!rules.length) throw new Error('没有找到正文配图标记规则条目');
    let changed = false;
    for (const rule of rules) {
      if (!RANGE.test(rule.content!) && !MAX.test(rule.content!)) throw new Error('规则条目缺少可同步的数量行');
      const next = rewriteCountLine(rule.content!, min, max); changed ||= next !== rule.content; rule.content = next;
    }
    if (!changed) return true;
    const saved = await fetch('/api/worldinfo/edit', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name, data }) });
    if (!saved.ok) throw new Error(`保存世界书失败 (${saved.status})`);
    toastr.success(`世界书配图数量已同步为 ${min}~${max}`, '柏宝绘');
    return true;
  }).catch(error => { toastr.warning(String(error), '柏宝绘·世界书同步'); return false; });
  chain = task; return task;
}
