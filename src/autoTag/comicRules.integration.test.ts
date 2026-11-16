import { describe, expect, it } from 'vitest';
import { buildAutoTagMessages, captureAutoTagEnvironment } from './prompt';
import { prepareStreamBatch } from './streamBatch';
import { settings } from '@/state/settings';
import { normalizeComicRuleTabs, selectComicRuleTab, updateComicRuleText } from '@/state/comicRuleTabs';
import type { STContext } from '@/st/context';
import { COMIC_VISUAL_RULES } from '@/comic/rules';

const prose = '成年旅客小雪在车站查看地图，然后向同伴挥手。';
const ctx = { chat: [{ name: 'Char', is_user: false, is_system: false, mes: prose }], name1: 'User', name2: 'Char', chatMetadata: {} } as unknown as STContext;
const batch = prepareStreamBatch([{ id: 'first', input: { text: prose, intent: '查看地图', raw: '', prefix: '', sourceLine: 0 } }], [], true);

describe('shared visual rules and active natural-language rules across analysis modes', () => {
  it.each(['standard', 'simple', 'fast'] as const)('uses the shared defaults and only the selected rule group in %s', async mode => {
    for (const v2 of [false, true]) {
      const profile = { naiCharPrompts: true, nl: false, lockedSize: 'portrait' as const };
      const environment = captureAutoTagEnvironment(profile);
      environment.backend = 'nai';
      Object.assign(environment.nai, { model: 'nai-diffusion-5-full', comicMode: true, comicV2: v2,
        comicAnalysisMode: mode,
        ...normalizeComicRuleTabs({ comicExtraRules: '此作品专用一号规则：背景简洁。' }) });
      selectComicRuleTab(environment.nai, 2);
      updateComicRuleText(environment.nai, '此作品专用三号规则：保留蓝色围巾，突出友好的互动。');
      const build = () => buildAutoTagMessages(ctx, 0, { ...settings.autoTag, minImages: 1, maxImages: 1 }, null,
        batch.target, undefined, batch.instructions, profile, environment, 'fixed-markers');
      const text = (await build()).map(message => message.content).join('\n');
      expect(text.split(COMIC_VISUAL_RULES)).toHaveLength(2);
      expect(text).toContain('cosplay是临时穿着');
      expect(text).toContain('服装/皮肤版本');
      expect(text).toContain('结束cosplay明确写cosplay:null');
      expect(text).toContain('每张图中每位cosplay穿着者的首次入镜都必须');
      expect(text).toContain('程序已确认表用于照抄完整字段，不是少写许可');
      expect(text).not.toContain('未变可省略由程序继承');
      expect(text).not.toContain('当前衣着及已知cosplay对象/作品/服装版本单列outfit');
      expect(text).toContain('不无故叠加medium shot、full body');
      expect(text).toContain('此作品专用三号规则：保留蓝色围巾，突出友好的互动。');
      expect(text).not.toContain('此作品专用一号规则');
      expect(text).toContain('连续场景沿用光源');
      expect(text).toContain('衣物仍归谁、遮到哪里');
      expect(text).toContain('只用画面讲故事');
      expect(text).not.toMatch(/六项工程检查|Text:|speech bubble|chinese text/i);
      updateComicRuleText(environment.nai, '');
      expect((await build()).map(message => message.content).join('\n')).not.toContain('此作品专用');
    }
  });
});
