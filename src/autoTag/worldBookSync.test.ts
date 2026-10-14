import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '@/state/settings';
import { rewriteCountLine, syncWorldBookRule } from './worldBookSync';

const fetchMock = vi.fn();
beforeEach(() => {
  settings.autoTag.streamWorldBook = '配图规则'; settings.autoTag.minImages = 2; settings.autoTag.maxImages = 4;
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  vi.stubGlobal('toastr', { success: vi.fn(), warning: vi.fn() });
  vi.stubGlobal('window', { SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({ 'Content-Type': 'application/json' }) }) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('worldbook count synchronization', () => {
  it('updates the recognized count sentence and preserves the rest of the rule', () => {
    const original = '【正文配图标记规则】\n原来的其它要求。\n本楼配图数量控制在 1 ～ 3 张之间。\n末尾要求。';
    expect(rewriteCountLine(original, 2, 5)).toBe(original.replace('1 ～ 3', '2 ～ 5'));
    expect(rewriteCountLine('本楼配图数量不超过 3 张。', 0, 2)).toBe('本楼配图数量不超过 2 张。');
  });
  it('posts a preserved worldbook with only its matching count line changed', async () => {
    const original = { entries: { a: { content: '【正文配图标记规则】\n本楼配图数量控制在 1~3 张之间。', enabled: true }, b: { content: '故事设定', enabled: false } }, meta: { author: 'fixture' } };
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => original }).mockResolvedValueOnce({ ok: true });
    expect(await syncWorldBookRule()).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.data.entries.b).toEqual({ content: '故事设定', enabled: false });
    expect(body.data.meta).toEqual({ author: 'fixture' });
    expect(body.data.entries.a.content).toContain('2~4');
  });
  it('does not write an unrelated book when the rule is missing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ entries: { a: { content: '无关条目' } } }) });
    expect(await syncWorldBookRule()).toBe(false); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('serializes rapid count changes so the last selected range wins', async () => {
    let releaseRead!: (value: unknown) => void;
    let book = { entries: { a: { content: '【正文配图标记规则】\n本楼配图数量控制在 1~3 张之间。' } } };
    fetchMock.mockImplementation(async (url: string, request: { body: string }) => {
      if (url.endsWith('/get')) return { ok: true, json: async () => { if (!releaseRead) await new Promise(resolve => { releaseRead = resolve; }); return structuredClone(book); } };
      book = JSON.parse(request.body).data; return { ok: true };
    });
    const first = syncWorldBookRule(); settings.autoTag.minImages = 3; settings.autoTag.maxImages = 5;
    const last = syncWorldBookRule(); for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce(); releaseRead(undefined);
    expect(await first).toBe(true); expect(await last).toBe(true);
    expect(book.entries.a.content).toContain('3~5');
  });
  it('matches the exact user rule without changing its density or other instructions', () => {
    const original='【正文配图标记规则(柏宝绘,写正文时必须执行)】\n密度要求:\n约每 300~600 字剧情一个标记\n本楼配图数量控制在 2~10 张之间(改数量时手动同步这行数字)\n标记意图不超过30字';
    expect(rewriteCountLine(original, 3, 8)).toBe(original.replace('2~10', '3~8'));
  });
  it.each(['2—10', '2 至 10', '２～１０', '**2~10**', '2\u200b~\u200b10'])('recognizes the range variant %s', range => {
    expect(rewriteCountLine(`本楼配图数量必须控制在：${range} 张之间`, 3, 8)).not.toContain(range);
    expect(rewriteCountLine(`本楼配图数量必须控制在：${range} 张之间`, 3, 8)).toContain('3');
  });
  it('updates valid rows instead of aborting on a same-title row without a count sentence', async () => {
    const data={ entries: { a: { content:'【正文配图标记规则】只讲格式',comment:'格式说明' }, b: { content:'【正文配图标记规则】\n本楼配图数量控制在 2~10 张之间' } } };
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>data}).mockResolvedValueOnce({ok:true});
    expect(await syncWorldBookRule()).toBe(true);
    const saved=JSON.parse(fetchMock.mock.calls[1][1].body).data;
    expect(saved.entries.a.content).toBe(data.entries.a.content); expect(saved.entries.b.content).toContain('2~4');
  });
  it('uses the host worldbook API to preserve live edits and refresh activation cache', async () => {
    const data={entries:{a:{content:'【正文配图标记规则】\n本楼配图数量控制在 2~10 张之间\n刚编辑的新要求'}}};
    const save=vi.fn(async()=>{}),reload=vi.fn();
    vi.stubGlobal('window',{SillyTavern:{getContext:()=>({getRequestHeaders:()=>({}),loadWorldInfo:async()=>data,saveWorldInfo:save,reloadWorldInfoEditor:reload})}});
    expect(await syncWorldBookRule()).toBe(true); expect(fetchMock).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('配图规则',{entries:{a:{content:data.entries.a.content.replace('2~10','2~4')}}},true);
    expect(data.entries.a.content).toContain('2~10'); expect(reload).toHaveBeenCalledWith('配图规则');
  });
});
