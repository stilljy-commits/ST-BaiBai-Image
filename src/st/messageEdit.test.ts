import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyMessageText, sameImageSlotLayout } from '@/st/messageEdit';
import { serializeImageTag } from '@/st/imageTagRegex';
const tag = (value: Partial<Parameters<typeof serializeImageTag>[0]>) => serializeImageTag({tag:'',nl:'',negative:'',characters:[],size:'portrait',...value});

function installContext(context: Record<string, unknown>): void {
  vi.stubGlobal('window', {
    SillyTavern: { getContext: () => context },
  });
  vi.stubGlobal('document', { querySelector: vi.fn(() => null) });
}

afterEach(() => vi.unstubAllGlobals());

describe('safe message editing', () => {
  it('does not save or rerender an unchanged message when an image finishes', async () => {
    const message = { mes: '正文', extra: {}, name: 'Char', is_user: false, is_system: false };
    const saveChat = vi.fn(), emit = vi.fn(), updateMessageBlock = vi.fn();
    installContext({chat:[message],getCurrentChatId:()=> 'A',saveChat,eventSource:{emit},eventTypes:{MESSAGE_EDITED:'edit'},updateMessageBlock});
    await expect(applyMessageText(0,text=>text,'A',null,message)).resolves.toBe('saved');
    expect(saveChat).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled(); expect(updateMessageBlock).not.toHaveBeenCalled();
  });
  it('saves metadata without emitting events that replace the message DOM', async () => {
    const message = { mes: '正文', extra: {}, name: 'Char', is_user: false, is_system: false };
    const saveChat = vi.fn(), emit = vi.fn(), updateMessageBlock = vi.fn();
    installContext({chat:[message],getCurrentChatId:()=> 'A',saveChat,eventSource:{emit},eventTypes:{MESSAGE_EDITED:'edit'},updateMessageBlock});
    await applyMessageText(0,text=>text,'A',null,message,{key:'chars',value:{ops:['appearance']}});
    expect(saveChat).toHaveBeenCalledOnce(); expect(emit).not.toHaveBeenCalled(); expect(updateMessageBlock).not.toHaveBeenCalled();
    await applyMessageText(0,text=>text,'A',null,message,{key:'chars',value:{ops:['appearance']}});
    expect(saveChat).toHaveBeenCalledOnce();
  });
  it('patches late tags in the same slot and leaves the reader DOM and editor intact', async () => {
    const oldTag = tag({tag:'',slotId:'slot-a',pending:'门口',size:'portrait'});
    const newTag = tag({tag:'doorway',slotId:'slot-a',size:'portrait'});
    const message = {mes:'正文\n'+oldTag,extra:{},name:'Char',is_user:false,is_system:false};
    const editor = {value:message.mes}, cancel = {click:vi.fn()};
    const element = {querySelector:vi.fn((selector:string)=>selector==='#curEditTextarea'?editor:cancel)};
    const saveChat = vi.fn(), emit = vi.fn(), updateMessageBlock = vi.fn();
    installContext({chat:[message],getCurrentChatId:()=> 'A',saveChat,eventSource:{emit},eventTypes:{MESSAGE_EDITED:'edit'},updateMessageBlock});
    vi.stubGlobal('document',{querySelector:()=>element});
    await applyMessageText(0,text=>text.replace(oldTag,newTag),'A',null,message,undefined,{refresh:'image-slots'});
    expect(message.mes).toContain(newTag); expect(editor.value).toBe(message.mes);
    expect(cancel.click).not.toHaveBeenCalled(); expect(emit).not.toHaveBeenCalled(); expect(updateMessageBlock).not.toHaveBeenCalled();
  });
  it('does not classify changed prose, inserted slots or reordered slots as a card update', () => {
    const a=tag({tag:'a',slotId:'a'}), b=tag({tag:'b',slotId:'b'});
    expect(sameImageSlotLayout('正文'+a,'改写正文'+a)).toBe(false);
    expect(sameImageSlotLayout('正文'+a,'正文'+a+b)).toBe(false);
    expect(sameImageSlotLayout('正文'+a+b,'正文'+b+a)).toBe(false);
    expect(sameImageSlotLayout('正文'+a,'正文'+tag({tag:'new',slotId:'a'}))).toBe(true);
  });
  it('does not refresh or touch another chat editor after asynchronous saving', async () => {
    let chatId='A';const message={mes:'old',name:'Char',is_user:false,is_system:false};
    const emit=vi.fn(), updateMessageBlock=vi.fn();
    installContext({chat:[message],getCurrentChatId:()=>chatId,saveChat:async()=>{chatId='B';},eventSource:{emit},eventTypes:{MESSAGE_EDITED:'edit'},updateMessageBlock});
    await expect(applyMessageText(0,()=> 'new','A',null,message)).resolves.toBe('chat-changed');
    expect(emit).not.toHaveBeenCalled();expect(updateMessageBlock).not.toHaveBeenCalled();
  });
  it('updates mes and the active swipe, then emits edit/update events', async () => {
    const message = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '原文',
      swipes: ['旧页', '原文'],
      swipe_id: 1,
    };
    const emit = vi.fn(async () => undefined);
    const saveChat = vi.fn(async () => undefined);
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat,
      eventSource: { emit },
      eventTypes: { MESSAGE_EDITED: 'edited', MESSAGE_UPDATED: 'updated' },
    });

    await expect(
      applyMessageText(0, text => `${text}\n<bbi_image>scene</bbi_image>`, 'chat-a', 1),
    ).resolves.toBe('saved');
    expect(message.mes).toContain('<bbi_image>scene</bbi_image>');
    expect(message.swipes[1]).toBe(message.mes);
    expect(saveChat).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenNthCalledWith(1, 'edited', 0);
    expect(emit).toHaveBeenNthCalledWith(2, 'updated', 0);
  });

  it('builds on the current text so another plugin\'s edit survives the write', async () => {
    const message = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '别的插件刚改过的正文',
      swipes: ['别的插件刚改过的正文'],
      swipe_id: 0,
    };
    const saveChat = vi.fn(async () => undefined);
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat,
      eventSource: {},
      eventTypes: {},
    });

    const buildNext = vi.fn((text: string) => `${text}\n<bbi_image>scene</bbi_image>`);
    await expect(applyMessageText(0, buildNext, 'chat-a', 0)).resolves.toBe('saved');
    // 基底是落盘那一刻的正文,不是请求开始时的快照
    expect(buildNext).toHaveBeenCalledWith('别的插件刚改过的正文');
    expect(message.mes).toBe('别的插件刚改过的正文\n<bbi_image>scene</bbi_image>');
    expect(saveChat).toHaveBeenCalledOnce();
  });

  it('abandons the write when buildNext returns null', async () => {
    const message = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '整篇换掉的正文',
      swipes: ['整篇换掉的正文'],
      swipe_id: 0,
    };
    const saveChat = vi.fn(async () => undefined);
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat,
      eventSource: {},
      eventTypes: {},
    });

    await expect(applyMessageText(0, () => null, 'chat-a', 0)).resolves.toBe('build-failed');
    expect(message.mes).toBe('整篇换掉的正文');
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('does not write into another swipe with identical text', async () => {
    const message = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '相同正文',
      swipes: ['相同正文', '相同正文'],
      swipe_id: 1,
    };
    const saveChat = vi.fn(async () => undefined);
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat,
      eventSource: {},
      eventTypes: {},
    });

    await expect(
      applyMessageText(0, () => '新正文', 'chat-a', 0),
    ).resolves.toBe('swipe-changed');
    expect(saveChat).not.toHaveBeenCalled();
  });

  it('accepts a replaced message object with the same identity', async () => {
    const original = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '原文',
      swipes: ['原文'],
      swipe_id: 0,
      send_date: '2026-08-27 10:00:00',
      extra: {},
    };
    // 别的插件整体换壳(chat[i] = {...chat[i], mes}):同一条消息,不该判成楼层变化
    const replacement = { ...original, mes: '别的插件改写后的正文', extra: {} };
    const context = {
      chat: [replacement],
      getCurrentChatId: () => 'chat-a',
      saveChat: vi.fn(async () => undefined),
      eventSource: {},
      eventTypes: {},
    };
    installContext(context);

    await expect(
      applyMessageText(0, text => `${text}!`, 'chat-a', 0, original),
    ).resolves.toBe('saved');
    expect(replacement.mes).toBe('别的插件改写后的正文!');
    expect(context.saveChat).toHaveBeenCalledOnce();
  });

  it('rejects a different message in the slot (floor deleted, index shifted)', async () => {
    const original = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '原文',
      swipes: ['原文'],
      swipe_id: 0,
      send_date: '2026-08-27 10:00:00',
      extra: {},
    };
    const other = { ...original, send_date: '2026-08-27 11:22:33', extra: {} };
    const context = {
      chat: [other],
      getCurrentChatId: () => 'chat-a',
      saveChat: vi.fn(async () => undefined),
      eventSource: {},
      eventTypes: {},
    };
    installContext(context);

    await expect(
      applyMessageText(
        0,
        () => '新正文',
        'chat-a',
        0,
        original,
        { key: 'bbiCharChanges', value: { v: 1, swipe: 0, ops: [] } },
      ),
    ).resolves.toBe('floor-changed');
    expect(other.mes).toBe('原文');
    expect(other.extra).toEqual({});
    expect(context.saveChat).not.toHaveBeenCalled();
  });

  it('rolls back message extra when saving fails', async () => {
    const message = {
      name: 'Char',
      is_user: false,
      is_system: false,
      mes: '原文',
      swipes: ['原文'],
      swipe_id: 0,
      extra: { keep: true },
    };
    installContext({
      chat: [message],
      getCurrentChatId: () => 'chat-a',
      saveChat: vi.fn(async () => {
        throw new Error('save failed');
      }),
      eventSource: {},
      eventTypes: {},
    });

    await expect(
      applyMessageText(
        0,
        () => '新正文',
        'chat-a',
        0,
        message,
        { key: 'bbiCharChanges', value: { v: 1, swipe: 0, ops: [] } },
      ),
    ).rejects.toThrow('save failed');
    expect(message.mes).toBe('原文');
    expect(message.extra).toEqual({ keep: true });
  });
});
