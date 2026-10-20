import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '@/state/settings';
import { bindMarkerInjection, ensureMarkerInRequest, markerRuleText, markerCountRuleText } from './markerInjection';
import { STREAM_SCENE_SUBJECT_RULE } from './sceneRules';

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
  it('keeps legacy worldbook text while overriding its density and adding current subject constraints exactly once',()=>{
    emit('start','normal',{},false);
    const legacy='【正文配图标记规则(柏宝绘,写正文时必须执行)】\n约每300~600字一个标记\n本楼配图数量控制在2~10张之间\n[img: 中文意图]';
    const book={role:'system',content:legacy},prefill={role:'assistant',content:'开场'};
    const request={prompt:[book,{role:'user',content:'继续'},prefill]};
    emit('send',request,false);emit('send',request,false);
    expect(request.prompt).toHaveLength(4);expect(request.prompt[0]).toBe(book);expect(book.content).toBe(legacy);
    expect(request.prompt[2]).toEqual({role:'system',content:markerCountRuleText(2,4)});expect(request.prompt[3]).toBe(prefill);
    expect(request.prompt[2].content).toContain('按真实视觉事件和剧情节奏选择位置');
    expect(request.prompt[2].content).toContain('按字数均匀插图要求以本条为准');
    expect(request.prompt[2].content).toContain(STREAM_SCENE_SUBJECT_RULE);
    expect(request.prompt[2].content).not.toMatch(/(?:300|400)\s*[~～-]\s*600/);
  });
  it('treats equal bounds as an exact count and never asks a zero-minimum floor to invent events',()=>{
    expect(markerCountRuleText(10,10)).toContain('必须恰好 10 个标记');
    expect(markerCountRuleText(0,4)).toContain('没有值得绘制的事件可以不放标记');
    expect(markerCountRuleText(3,10)).toContain('不要求接近上限 10');
  });
  it.each(['prompt', 'messages'])('restores registration and adds missing rules to the actual %s payload', field => {
    emit('start', 'normal', {}, false);
    expect(setPrompt.mock.calls.at(-1)?.[1]).toContain('2~4');
    const messages = [{ role: 'user', content: '开始剧情' }, { role: 'assistant', content: '角色：' }];
    const request = { [field]: messages }; const existing = [...messages]; emit('send', request, false);
    expect(messages).toHaveLength(3); expect(messages[1]).toEqual({ role: 'system', content: markerRuleText(2, 4) });
    expect(messages[0]).toBe(existing[0]); expect(messages[2]).toBe(existing[1]);
    expect(messages[1].content).toContain(STREAM_SCENE_SUBJECT_RULE);
    expect(messages[1].content).not.toMatch(/(?:300|400)\s*[~～-]\s*600/);
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
