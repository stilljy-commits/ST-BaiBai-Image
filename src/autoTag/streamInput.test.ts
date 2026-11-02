import { afterEach, describe, expect, it, vi } from 'vitest';
import { StreamInput, streamTextPiece, type StreamInputOwner } from './streamInput';
import { MarkerScanner } from './markers';
import { StreamRun } from './streamCore';

const inputs: StreamInput[] = [];
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
const deferred = <T>() => { let resolve!: (value: T) => void; return { promise: new Promise<T>(r => resolve = r), resolve }; };
const frame = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;
function source(contentType = 'text/event-stream') {
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start: c => stream = c }), { headers: { 'content-type': contentType } });
  return { response, push: (value: string) => stream.enqueue(new TextEncoder().encode(value)), bytes: (value: Uint8Array) => stream.enqueue(value), close: () => stream.close() };
}
function fixture(response?: Response, options: { byteLimit?: number; lifetimeMs?: number } = {}) {
  const valid = vi.fn(() => true), text = vi.fn(), done = vi.fn(), recover = vi.fn();
  const delegate = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response || new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }));
  const target = { fetch: delegate as typeof fetch, location: { href: 'http://tt.local/index.html' } };
  const diagnostic = vi.fn(), input = new StreamInput({ target, diagnostic, ...options }); inputs.push(input);
  input.install();
  const owner: StreamInputOwner = { chatId: 'chat-A', type: 'normal', valid, text, done, recover };
  input.begin(owner);
  const init: RequestInit = { method: 'POST', body: JSON.stringify({ type: 'normal', stream: true, chat_completion_source: 'vertexai', model: 'fixture-only' }) };
  return { input, owner, valid, text, done, recover, target, diagnostic, delegate, init,
    request: () => target.fetch('/api/backends/chat-completions/generate', init) };
}
afterEach(() => { for (const input of inputs.splice(0)) input.dispose(); vi.useRealTimers(); });

describe('generation-owned independent response input', () => {
  it('collects ten scenes and flushes 3,3,3,1 without any host event, DOM, frame, scroll or second request', async () => {
    const src = source(), f = fixture(src.response), scanner = new MarkerScanner(), batches: number[][] = [];
    const run = new StreamRun<string, never>('input-test', 20, 2, false, {
      analyze: async job => { batches.push([job.ordinal]); return job.input.intent; },
      analyzeBatch: async jobs => { batches.push(jobs.map(job => job.ordinal)); return jobs.map(job => job.input.intent); },
      generate: async () => { throw new Error('No provider requests'); }, commit: async () => false, changed: () => {}, release: () => {},
    }, 3);
    f.owner.text = text => { for (const marker of scanner.feed(text)) run.add({ raw: marker.raw, intent: marker.intent, text, prefix: '', sourceLine: 0 }); };
    f.owner.done = () => run.finishInput();
    const original = await f.request();
    let expected = '';
    for (let i = 0; i < 10; i++) { const text = `女主查看房间${i}。\n[img: 查看房间${i}]\n`; expected += frame(text); src.push(frame(text)); }
    expected += 'data: [DONE]\n\n'; src.push('data: [DONE]\n\n'); src.close();
    await vi.waitFor(() => expect(run.jobs).toHaveLength(10)); await run.analysisSettled();
    expect(batches.map(batch => batch.length)).toEqual([3, 3, 3, 1]);
    expect(original).toBe(src.response); expect(await original.text()).toBe(expected);
    expect(f.delegate).toHaveBeenCalledTimes(1); expect(f.delegate).toHaveBeenCalledWith('/api/backends/chat-completions/generate', f.init);
  });

  it('suppresses duplicate host text and waits for the observation EOF to flush the last group', async () => {
    const src = source(), f = fixture(src.response); await f.request();
    f.input.hostText('host text that must not change marker positions'); f.input.hostDone();
    expect(f.text).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled();
    src.push(frame('女主进门。\n[img: 进门]')); src.close();
    await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    f.input.hostText('女主进门。\n[img: 进门]'); f.input.hostDone();
    expect(f.text).toHaveBeenCalledTimes(1); expect(f.done).toHaveBeenCalledOnce();
    await src.response.text();
  });

  it('decodes UTF-8 split inside a Chinese character and CRLF event framing', async () => {
    const src = source(), f = fixture(src.response); await f.request();
    const bytes = new TextEncoder().encode(frame('女主开门。').replaceAll('\n', '\r\n'));
    for (const byte of bytes) src.bytes(Uint8Array.of(byte)); src.close();
    await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce()); expect(f.text).toHaveBeenLastCalledWith('女主开门。'); await src.response.text();
  });

  it('handles native Gemini parts using the host separator and excludes thoughts', async () => {
    const data = { candidates: [{ content: { parts: [{ thought: true, text: '[img: 思考示例]' }, { text: '女主' }, { text: '开门。' }] } }] };
    const f = fixture(new Response(`data: ${JSON.stringify(data)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const original = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenLastCalledWith('女主\n\n开门。'); await original.text();
  });

  it.each([
    { type: 'content_block_delta', delta: { type: 'text_delta', text: '女主开门。' } },
    { type: 'response.output_text.delta', delta: '女主开门。' },
  ])('handles supported native text events without model-name assumptions: $type', async data => {
    const f = fixture(new Response(`data: ${JSON.stringify(data)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }));
    const original = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenLastCalledWith('女主开门。'); await original.text();
  });

  it('starts from a complete non-streaming main JSON response before the floor is displayed', async () => {
    const f = fixture(new Response(JSON.stringify({ choices: [{ message: { content: '女主开门。\n[img: 开门]' } }] }), { headers: { 'content-type': 'application/json' } }));
    const original = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenCalledWith('女主开门。\n[img: 开门]'); expect((await original.json()).choices).toHaveLength(1);
  });

  it('captures regenerate requests and preserves event fallback for an unknown future generation type', async () => {
    const f = fixture(new Response(frame('重新生成的正文'), { headers: { 'content-type': 'text/event-stream' } }));
    f.input.begin({ ...f.owner, type: 'regenerate' }); f.init.body = JSON.stringify({ type: 'regenerate', stream: true });
    const response = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenCalledWith('重新生成的正文'); await response.text();
    f.text.mockClear(); f.input.begin({ ...f.owner, type: 'future-generation-kind' }); f.input.hostText('后备正文');
    expect(f.text).toHaveBeenCalledWith('后备正文');
  });

  it.each([
    ['quiet', '/api/backends/chat-completions/generate', { type: 'quiet' }],
    ['another generation kind', '/api/backends/chat-completions/generate', { type: 'continue' }],
    ['unowned deputy', '/api/backends/chat-completions/generate', { model: 'deputy' }],
    ['another origin', 'https://other.example/api/backends/chat-completions/generate', { type: 'normal' }],
    ['another endpoint', '/api/backends/chat-completions/status', { type: 'normal' }],
    ['native images', '/api/backends/chat-completions/generate', { type: 'normal', request_images: true }],
    ['multiple swipes', '/api/backends/chat-completions/generate', { type: 'normal', n: 2 }],
  ])('leaves %s requests on the unchanged host path', async (_name, url, body) => {
    const f = fixture(); const original = await f.target.fetch(url as string, { method: 'POST', body: JSON.stringify(body) });
    await original.text(); await flush(); expect(f.text).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled();
    f.input.hostText('正常的酒馆正文'); expect(f.text).toHaveBeenCalledWith('正常的酒馆正文');
  });

  it('falls back to buffered notifications when the response shape is unsupported', async () => {
    const src = source(), f = fixture(src.response); await f.request(); f.input.hostText('女主开门。');
    src.push('data: {"unknown":"format"}\n\n'); src.close();
    await vi.waitFor(() => expect(f.diagnostic).toHaveBeenCalledWith('stream:input-fallback', expect.anything()));
    expect(f.text).toHaveBeenCalledWith('女主开门。'); f.input.hostDone(); expect(f.done).toHaveBeenCalledOnce(); await src.response.text();
  });

  it('recovers a host-end signal that arrived before unsupported observation finished', async () => {
    const src = source(), f = fixture(src.response); await f.request(); f.input.hostText('女主开门。'); f.input.hostDone();
    src.push('data: {"unknown":"format"}\n\n'); src.close();
    await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce()); await src.response.text();
  });

  it('limits observation bytes without truncating the original response', async () => {
    const raw = frame('女主开门。'.repeat(100)), f = fixture(new Response(raw, { headers: { 'content-type': 'text/event-stream' } }), { byteLimit: 64 });
    const original = await f.request(); f.input.hostText('酒馆后备正文');
    await vi.waitFor(() => expect(f.diagnostic).toHaveBeenCalledWith('stream:input-fallback', expect.anything()));
    expect(await original.text()).toBe(raw); expect(f.text).toHaveBeenLastCalledWith('酒馆后备正文');
  });

  it('cancels an old observation on chat change while preserving the original response', async () => {
    const src = source(), f = fixture(src.response); const original = await f.request();
    f.valid.mockReturnValue(false); f.input.recover(); src.push(frame('旧聊天正文')); src.close();
    expect(await original.text()).toContain('旧聊天正文'); await flush(); expect(f.text).not.toHaveBeenCalled(); expect(f.done).not.toHaveBeenCalled();
  });

  it('does not attach a late old response to a replacement generation', async () => {
    const first = deferred<Response>(), f = fixture(); f.delegate.mockImplementationOnce(() => first.promise);
    const waiting = f.request(); const second = { ...f.owner, text: vi.fn(), done: vi.fn() }; f.input.begin(second);
    first.resolve(new Response(frame('旧正文'), { headers: { 'content-type': 'text/event-stream' } }));
    await (await waiting).text(); await flush(); expect(second.text).not.toHaveBeenCalled(); expect(f.text).not.toHaveBeenCalled();
  });

  it('preserves the original fetch signal and rejection', async () => {
    const f = fixture(), controller = new AbortController(), error = new DOMException('Cancelled', 'AbortError'); f.init.signal = controller.signal;
    f.delegate.mockRejectedValueOnce(error); await expect(f.request()).rejects.toBe(error);
    expect(f.delegate.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it('recovery runs without a frame or scroll and all timers stop on dispose', async () => {
    vi.useFakeTimers(); const f = fixture(); await vi.advanceTimersByTimeAsync(3000); expect(f.recover).toHaveBeenCalledTimes(3);
    f.input.dispose(); await vi.advanceTimersByTimeAsync(3000); expect(f.recover).toHaveBeenCalledTimes(3); expect(f.target.fetch).toBe(f.delegate);
  });

  it('does not remove a newer extension fetch wrapper during cleanup', () => {
    const f = fixture(), wrapper = f.target.fetch, newer: typeof fetch = (input, init) => wrapper(input, init); f.target.fetch = newer;
    f.input.dispose(); expect(f.target.fetch).toBe(newer);
  });

  it('reattaches around another extension wrapper without observing the same response twice', async () => {
    const f = fixture(new Response(frame('女主开门。'), { headers: { 'content-type': 'text/event-stream' } }));
    const previous = f.target.fetch; f.target.fetch = (input, init) => previous(input, init); f.input.install();
    const response = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenCalledTimes(1); expect(f.delegate).toHaveBeenCalledTimes(1);
    expect(f.diagnostic.mock.calls.some(([event]) => event === 'stream:input-fallback')).toBe(false); await response.text();
  });

  it('reattaches when the host completely replaces fetch between generations', async () => {
    const f = fixture(), replacement = vi.fn(async () => new Response(frame('另一轮正文'), { headers: { 'content-type': 'text/event-stream' } }));
    f.target.fetch = replacement as typeof fetch; f.input.begin(f.owner);
    const response = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenCalledWith('另一轮正文'); expect(replacement).toHaveBeenCalledOnce(); expect(f.delegate).not.toHaveBeenCalled(); await response.text();
  });

  it('does not double-claim a response through an asynchronously deferred older wrapper', async () => {
    const f = fixture(new Response(frame('异步请求包装后的正文'), { headers: { 'content-type': 'text/event-stream' } }));
    const previous = f.target.fetch; f.target.fetch = async (input, init) => { await Promise.resolve(); return previous(input, init); }; f.input.install();
    const response = await f.request(); await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
    expect(f.text).toHaveBeenCalledTimes(1); expect(f.delegate).toHaveBeenCalledTimes(1);
    expect(f.diagnostic.mock.calls.some(([event]) => event === 'stream:input-fallback')).toBe(false); await response.text();
  });

  it('callback and diagnostic failures never corrupt the main response', async () => {
    const f = fixture(new Response(frame('女主开门。'), { headers: { 'content-type': 'text/event-stream' } }));
    f.owner.text = () => { throw new Error('display failure'); }; f.diagnostic.mockImplementation(() => { throw new Error('logging failure'); });
    const original = await f.request(); expect(await original.text()).toBe(frame('女主开门。'));
    await vi.waitFor(() => expect(f.done).toHaveBeenCalledOnce());
  });
});

describe('story-only response extraction', () => {
  it.each([
    { choices: [{ index: 1, delta: { content: '[img: another swipe]' } }] },
    { choices: [{ delta: { reasoning_content: '[img: thinking]', tool_calls: [{ function: { arguments: '[img: tool]' } }] } }] },
    { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '[img: thinking]' } },
    { type: 'response.reasoning_summary_text.delta', delta: '[img: thinking]' },
    { candidates: [{ content: { parts: [{ thought: true, text: '[img: thinking]' }, { inlineData: { data: 'irrelevant' } }] } }] },
  ])('ignores non-story data %#', data => expect(streamTextPiece(data)).toBe(''));
});
