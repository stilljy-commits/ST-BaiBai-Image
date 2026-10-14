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
    expect(rewriteCountLine(original, 2, 5)).toBe(original.replace('1 ～ 3', '2~5'));
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
});
