import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '@/state/settings';
import { bindMarkerInjection, ensureMarkerInRequest, markerRuleText } from './markerInjection';

let handlers: Map<string, (...args: unknown[]) => unknown>;
const setPrompt = vi.fn();
function emit(event: string, ...args: unknown[]) { return handlers.get(event)?.(...args); }
beforeEach(() => {
  handlers = new Map(); setPrompt.mockClear();
  settings.enabled = true; Object.assign(settings.autoTag, { enabled: true, streamGen: true, minImages: 2, maxImages: 4 });
  const ctx = { setExtensionPrompt: setPrompt, eventSource: { on: (event: string, handler: (...args: unknown[]) => unknown) => handlers.set(event, handler) },
    eventTypes: { GENERATION_STARTED: 'start', GENERATION_ENDED: 'end', GENERATION_STOPPED: 'stop', CHAT_CHANGED: 'chat', GENERATE_AFTER_DATA: 'send' } };
  vi.stubGlobal('window', { SillyTavern: { getContext: () => ctx } });
  vi.stubGlobal('toastr', { info: vi.fn() });
  bindMarkerInjection();
});
afterEach(() => { emit('end'); vi.unstubAllGlobals(); });

describe('marker injection into actual story requests', () => {
  it.each(['prompt', 'messages'])('restores registration and adds missing rules to the actual %s payload', field => {
    emit('start', 'normal', {}, false);
    expect(setPrompt.mock.calls.at(-1)?.[1]).toContain('2~4');
    const messages = [{ role: 'user', content: '开始剧情' }, { role: 'assistant', content: '角色：' }];
    const request = { [field]: messages }; const existing = [...messages]; emit('send', request, false);
    expect(messages).toHaveLength(3); expect(messages[1]).toEqual({ role: 'system', content: markerRuleText(2, 4) });
    expect(messages[0]).toBe(existing[0]); expect(messages[2]).toBe(existing[1]);
  });
  it('does not add a duplicate when the worldbook or native path already supplied the rule', () => {
    emit('start', 'normal', {}, false);
    const request = { messages: [{ role: 'system', content: [{ type: 'text', text: markerRuleText(2, 4) }] }] };
    emit('send', request, false); emit('send', request, false); expect(request.messages).toHaveLength(1);
  });
  it.each(['quiet', 'impersonate'])('keeps %s requests free from story marker rules', type => {
    emit('start', type, {}, false); const request = { messages: [{ role: 'user', content: '生成tag或其它工具任务' }] };
    expect(ensureMarkerInRequest(request, false)).toBe(false); expect(request.messages).toHaveLength(1);
    expect(setPrompt.mock.calls.at(-1)?.[1]).toBe('');
  });
  it('does not use prompt-ready events emitted by generateRaw tag requests', () => {
    expect(handlers.has('chat_completion_prompt_ready')).toBe(false);
    emit('start', 'normal', {}, false); emit('end');
    const request = { messages: [] }; emit('send', request, false); expect(request.messages).toHaveLength(0);
  });
  it('skips disabled and dry-run requests, and keeps the original per-run count', () => {
    emit('start', 'normal', {}, false); settings.autoTag.minImages = 3; settings.autoTag.maxImages = 6;
    const request = { messages: [] as Array<{ role: string; content: string }> }; emit('send', request, false);
    expect(request.messages[0].content).toContain('2~4');
    const other = { messages: [] }; emit('send', other, true); settings.autoTag.streamGen = false; emit('send', other, false);
    expect(other.messages).toHaveLength(0);
  });
});
