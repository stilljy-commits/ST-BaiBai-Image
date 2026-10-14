import { getContext } from '@/st/context';
import { settings } from '@/state/settings';

const TITLE = '【正文配图标记';
const SPACE = '[\\s\\u200b\\u200c\\u200d\\ufeff]*';
const COUNT = `本楼(?:配图|图片|生图)数量${SPACE}`;
const RANGE = new RegExp(`(${COUNT}(?:必须${SPACE})?(?:控制${SPACE})?在${SPACE}[:：]?${SPACE}(?:\\*\\*)?)[0-9０-９]+(${SPACE}[~～〜–—\\-至到]${SPACE})[0-9０-９]+((?:\\*\\*)?${SPACE}张(?:之间|以内)?)`, 'g');
const MAX = new RegExp(`(${COUNT}(?:不超过|最多|上限为)${SPACE}[:：]?${SPACE}(?:\\*\\*)?)[0-9０-９]+((?:\\*\\*)?${SPACE}张)`, 'g');
let chain: Promise<unknown> = Promise.resolve();

function rewriteCountRule(text: string, min: number, max: number): { text: string; matches: number } {
  let matches = 0;
  const next = text.replace(RANGE, (_match, prefix: string, separator: string, suffix: string) => {
    matches++; return `${prefix}${min}${separator}${max}${suffix}`;
  }).replace(MAX, (_match, prefix: string, suffix: string) => {
    matches++; return `${prefix}${max}${suffix}`;
  });
  return { text: next, matches };
}
export function rewriteCountLine(text: string, min: number, max: number): string { return rewriteCountRule(text, min, max).text; }
interface WorldBookData extends Record<string, unknown> {
  entries: Record<string, { content?: string; comment?: string; uid?: number }>;
}

async function readBook(name: string): Promise<WorldBookData> {
  const ctx = getContext()!;
  if (ctx.loadWorldInfo) {
    const data = await ctx.loadWorldInfo(name);
    if (data?.entries && typeof data.entries === 'object') return structuredClone(data) as WorldBookData;
  }
  const response = await fetch('/api/worldinfo/get', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name }), cache: 'no-store' });
  if (!response.ok) throw new Error(`读取世界书失败 (${response.status})`);
  const data = await response.json();
  if (!data?.entries || typeof data.entries !== 'object') throw new Error('世界书没有有效条目');
  return data as WorldBookData;
}
/** Changes only the existing count line. No startup write or automatic creation. */
export function syncWorldBookRule(): Promise<boolean> {
  const name = settings.autoTag.streamWorldBook?.trim();
  if (!name) return Promise.resolve(false);
  const min = settings.autoTag.minImages, max = settings.autoTag.maxImages;
  const task = chain.then(async () => {
    const ctx = getContext(); if (!ctx?.getRequestHeaders) return false;
    const data = await readBook(name);
    const rules = Object.values(data.entries).filter(entry => entry && typeof entry.content === 'string' && entry.content.trimStart().startsWith(TITLE));
    if (!rules.length) throw new Error('没有找到正文配图标记规则条目');
    let changed = false, matched = 0; const skipped: string[] = [];
    for (const rule of rules) {
      const next = rewriteCountRule(rule.content!, min, max);
      if (!next.matches) { skipped.push(rule.comment || String(rule.uid ?? '未命名条目')); continue; }
      matched++; changed ||= next.text !== rule.content; rule.content = next.text;
    }
    if (!matched) throw new Error(`世界书「${name}」的 ${rules.length} 个规则条目没有可识别的数量句：${skipped.join('、')}。支持“本楼配图数量控制在 2~10 张之间”`);
    if (skipped.length) console.warn('[BBI][AutoTagDebug] wi-sync:skipped', JSON.stringify({ book: name, entries: skipped }));
    if (!changed) return true;
    if (ctx.saveWorldInfo) await ctx.saveWorldInfo(name, data, true); // Host updates its activation cache as well as the file.
    else {
      const saved = await fetch('/api/worldinfo/edit', { method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name, data }) });
      if (!saved.ok) throw new Error(`保存世界书失败 (${saved.status})`);
    }
    if (ctx.reloadWorldInfoEditor) {
      try { await ctx.reloadWorldInfoEditor(name); } catch (error) { console.warn('[BBI][AutoTagDebug] wi-sync:editor-refresh-failed', String(error)); }
    }
    toastr.success(`世界书「${name}」${matched} 个规则条目已同步为 ${min}~${max}`, '柏宝绘');
    return true;
  }).catch(error => { toastr.warning(String(error), '柏宝绘·世界书同步'); return false; });
  chain = task; return task;
}
