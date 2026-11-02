/** Read the existing main response independently of the host's display loop.
 * No request/body/header is changed, and the original Response is returned.
 * An owner chooses exactly one input path; display events remain the fallback.
 */
export interface StreamInputOwner {
  chatId: string;
  type: string;
  valid: () => boolean;
  text: (text: string) => void;
  done: () => void;
  hostDone?: () => void;
  recover: () => void;
}
interface InputRun {
  owner: StreamInputOwner;
  route: 'events' | 'response' | 'fallback';
  lastEvent: string;
  lastResponse: string;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  claimed: boolean;
  finished: boolean;
  hostFinished: boolean;
  started: number;
  timer?: ReturnType<typeof setTimeout>;
}
interface InputOptions {
  target: { fetch: typeof fetch; location?: { href: string } };
  diagnostic?: (event: string, detail: Record<string, unknown>) => void;
  byteLimit?: number;
  lifetimeMs?: number;
}
const MAIN_PATH = '/api/backends/chat-completions/generate';
const TYPES = new Set(['normal', 'swipe', 'continue', 'regenerate']);

/** Known host response shapes, using the same text joining as TT's decoder.
 * Thinking, tools, secondary choices and images never become story input.
 * A response with no supported story content falls back to host notifications.
 */
export function streamTextPiece(data: any): string {
  if (data?.error) throw new Error('main-response-error');
  if (Array.isArray(data?.choices)) {
    const choice = data.choices.find((item: any) => item && (item.index === undefined || item.index === 0));
    const value = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.filter(p => p?.type === 'text' && typeof p.text === 'string').map(p => p.text).join('');
    return '';
  }
  const parts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.filter(p => !p?.thought && typeof p?.text === 'string').map(p => p.text).join('\n\n');
  if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta') return typeof data.delta.text === 'string' ? data.delta.text : '';
  if (data?.type === 'response.output_text.delta' && typeof data.delta === 'string') return data.delta;
  // Non-streaming Claude Messages response.
  if (data?.type === 'message' && Array.isArray(data.content)) return data.content.filter((p: any) => p?.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('');
  return '';
}

export class StreamInput {
  private run?: InputRun;
  private original?: typeof fetch;
  private wrapper?: typeof fetch;
  private disposed = false;
  constructor(private options: InputOptions) {}

  install(): void {
    if (this.disposed) return;
    const target = this.options.target;
    if (typeof target.fetch !== 'function' || target.fetch === this.wrapper) return;
    const original = target.fetch;
    this.original = original;
    const wrapper: typeof fetch = async (input, init) => {
      // Older wrappers can remain inside another extension's async delegate
      // chain. Only our newest wrapper may claim the response.
      const run = this.wrapper === wrapper ? this.requestOwner(input, init) : undefined;
      if (run) { run.route = 'response'; run.claimed = true; }
      let response: Response;
      try { response = await original.call(target, input, init); }
      catch (error) { if (run) this.fallback(run, 'main-request-failed'); throw error; }
      if (run && this.alive(run)) {
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || (!contentType.includes('text/event-stream') && !contentType.includes('json'))) this.fallback(run, 'unsupported-response');
        else try {
          const copy = response.clone();
          void this.observe(run, copy, contentType.includes('text/event-stream'));
        } catch { this.fallback(run, 'response-unavailable'); }
      }
      return response;
    };
    try { target.fetch = wrapper; this.wrapper = wrapper; }
    catch { this.log('stream:input-fallback', { reason: 'fetch-not-writable' }); }
  }

  begin(owner: StreamInputOwner): void {
    this.stop();
    if (this.disposed || !owner.valid()) return;
    this.install();
    const run: InputRun = { owner, route: 'events', lastEvent: '', lastResponse: '', claimed: false, finished: false, hostFinished: false, started: Date.now() };
    this.run = run;
    const tick = () => {
      if (!this.alive(run) || Date.now() - run.started > (this.options.lifetimeMs ?? 30 * 60_000)) { if (this.run === run) this.stop(); return; }
      this.recover();
      if (this.run === run) run.timer = setTimeout(tick, 1000);
    };
    run.timer = setTimeout(tick, 1000);
  }

  /** Called by the existing STREAM_TOKEN_RECEIVED listener. */
  hostText(text: string): void {
    const run = this.run;
    if (!run || !this.alive(run)) return;
    run.lastEvent = text;
    if (run.route === 'events' || run.route === 'fallback' && (!run.lastResponse || text.startsWith(run.lastResponse))) this.text(run, text);
  }

  /** GENERATION_ENDED is also a terminal-input signal, independently of rendering. */
  hostDone(): void {
    const run = this.run;
    if (!run || !this.alive(run)) return;
    run.hostFinished = true;
    try { run.owner.hostDone?.(); } catch { this.log('stream:input-callback-error', { phase: 'host-done' }); }
    // A response observer may still be decoding buffered chunks. It finishes
    // its own input; flushing its batch here could split the last group twice.
    if (run.route !== 'response') this.finish(run);
    this.recover();
  }

  recover(): void {
    const run = this.run;
    if (!run) return;
    if (!this.alive(run)) { this.stop(); return; }
    try { run.owner.recover(); } catch { this.log('stream:input-recovery-error', {}); }
  }

  stop(): void {
    const run = this.run;
    this.run = undefined;
    if (!run) return;
    clearTimeout(run.timer);
    // tee cancellation can wait for the host branch; never await it here.
    if (run.reader) void run.reader.cancel().catch(() => {});
  }

  dispose(): void {
    this.stop(); this.disposed = true;
    if (this.wrapper && this.options.target.fetch === this.wrapper && this.original) this.options.target.fetch = this.original;
  }

  private alive(run: InputRun): boolean { return !this.disposed && this.run === run && run.owner.valid(); }

  private requestOwner(input: RequestInfo | URL, init?: RequestInit): InputRun | undefined {
    const run = this.run;
    if (!run || !this.alive(run) || typeof init?.body !== 'string') return;
    try {
      const base = this.options.target.location?.href;
      if (!base) return;
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, base);
      if (url.origin !== new URL(base).origin || url.pathname !== MAIN_PATH || String(init.method || 'GET').toUpperCase() !== 'POST') return;
      const body = JSON.parse(init.body);
      if (!TYPES.has(body.type) || body.type !== run.owner.type || body.request_images || Number(body.n || 1) > 1) return;
      if (run.claimed) { this.fallback(run, 'multiple-main-responses'); return; }
      return run;
    } catch { return; }
  }

  private fallback(run: InputRun, reason: string): void {
    if (!this.alive(run)) return;
    run.route = 'fallback';
    if (run.reader) void run.reader.cancel().catch(() => {});
    this.log('stream:input-fallback', { reason, chars: run.lastResponse.length });
    if (run.lastEvent && (!run.lastResponse || run.lastEvent.startsWith(run.lastResponse))) this.text(run, run.lastEvent);
    if (run.hostFinished) this.finish(run);
  }

  private finish(run: InputRun): void {
    if (!this.alive(run) || run.finished) return;
    run.finished = true;
    try { run.owner.done(); } catch { this.log('stream:input-callback-error', { phase: 'done' }); }
    this.log('stream:input-complete', { source: run.route, chars: (run.lastResponse || run.lastEvent).length });
    this.recover();
  }

  private async observe(run: InputRun, response: Response, sse: boolean): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) { this.fallback(run, 'response-without-body'); return; }
    run.reader = reader;
    const decoder = new TextDecoder();
    let bytes = 0, buffer = '', dataLines: string[] = [], ended = false;
    const accept = (data: any) => {
      const text = streamTextPiece(data);
      if (!text || !this.alive(run)) return;
      run.lastResponse += text;
      if (run.lastResponse.length === text.length) this.log('stream:input-first-text', { source: 'response' });
      this.text(run, run.lastResponse);
    };
    const event = () => {
      const data = dataLines.join('\n').trim(); dataLines = [];
      if (!data) return;
      if (data === '[DONE]') { ended = true; return; }
      accept(JSON.parse(data));
    };
    const line = (value: string) => {
      if (!value) event();
      else if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
    };
    try {
      this.log('stream:input-attached', { source: 'response' });
      while (this.alive(run) && run.route === 'response' && !ended) {
        const part = await reader.read();
        if (!this.alive(run) || run.route !== 'response') return;
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > (this.options.byteLimit ?? 8 * 1024 * 1024)) throw new Error('response-size-limit');
        buffer += decoder.decode(part.value, { stream: true });
        if (sse) {
          let end: number;
          while (!ended && (end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
        }
      }
      if (!this.alive(run) || run.route !== 'response') return;
      buffer += decoder.decode();
      if (sse) { if (buffer.trim()) line(buffer.replace(/\r$/, '')); if (!ended && dataLines.length) event(); }
      else accept(JSON.parse(buffer));
      if (!run.lastResponse) this.fallback(run, 'no-supported-story-text');
      else this.finish(run);
    } catch { this.fallback(run, 'response-observation-failed'); }
    finally {
      if (run.reader === reader) run.reader = undefined;
      // Never cancel the original response or wait for its display consumer.
      void reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch { /* A pending read will finish on cancel. */ }
    }
  }

  private log(event: string, detail: Record<string, unknown>): void {
    try { this.options.diagnostic?.(event, { at: Date.now(), ...detail }); } catch { /* Diagnostics cannot control requests. */ }
  }

  private text(run: InputRun, text: string): void {
    try { run.owner.text(text); } catch { this.log('stream:input-callback-error', { phase: 'text' }); }
  }
}
