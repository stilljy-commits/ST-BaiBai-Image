import { describe, expect, it } from 'vitest';
import { buildAutoTagMessages, captureAutoTagEnvironment } from './prompt';
import { prepareStreamBatch } from './streamBatch';
import { compactComicSpec } from './compactComic';
import { DEFAULT_COMIC_ENGINEERING_RULES, DEFAULT_COMIC_NSFW_RULES, settings } from '@/state/settings';
import { normalizeComicRuleTabs, selectComicRuleTab, updateComicRuleText } from '@/state/comicRuleTabs';
import type { STContext } from '@/st/context';

const prose = '成年旅客小雪在车站查看地图，然后向同伴挥手。';
const ctx = { chat: [{ name: 'Char', is_user: false, is_system: false, mes: prose }], name1: 'User', name2: 'Char', chatMetadata: {} } as unknown as STContext;
const batch = prepareStreamBatch([{ id: 'first', input: { text: prose, intent: '查看地图', raw: '', prefix: '', sourceLine: 0 } }], [], true);

describe('comic engineering switch and active natural-language rules across all analysis modes', () => {
  it.each(['standard', 'simple', 'fast'] as const)('uses only the selected rule group in %s, V1/V2, engineering on/off', async mode => {
    for (const v2 of [false, true]) for (const enabled of [false, true]) {
      const profile = { naiCharPrompts: true, nl: false, lockedSize: 'portrait' as const };
      const environment = captureAutoTagEnvironment(profile);
      environment.backend = 'nai';
      Object.assign(environment.nai, { model: 'nai-diffusion-5-full', comicMode: true, comicV2: v2,
        comicAnalysisMode: mode, comicText: false, comicNsfwRules: enabled,
        ...normalizeComicRuleTabs({ comicExtraRules: '此作品专用一号规则：背景简洁。' }) });
      selectComicRuleTab(environment.nai, 2);
      updateComicRuleText(environment.nai, '此作品专用三号规则：保留蓝色围巾，突出友好的互动。');
      const build = () => buildAutoTagMessages(ctx, 0, { ...settings.autoTag, minImages: 1, maxImages: 1 }, null,
        batch.target, undefined, batch.instructions, profile, environment, 'fixed-markers',
        compactComicSpec({ nai: environment.nai, target: batch.target, markers: batch.markerTargets, entries: [], locked: new Set(), size: 'portrait', min: 1, max: 1 }));
      const text = (await build()).map(message => message.content).join('\n');
      expect(text).toContain('此作品专用三号规则：保留蓝色围巾，突出友好的互动。');
      expect(text).not.toContain('此作品专用一号规则');
      expect(text.includes(DEFAULT_COMIC_ENGINEERING_RULES)).toBe(enabled);
      expect(text.includes(DEFAULT_COMIC_NSFW_RULES)).toBe(enabled);
      if (enabled) {
        expect(text.split(DEFAULT_COMIC_ENGINEERING_RULES)).toHaveLength(2);
        expect(text).toContain('通用部分适用于 SFW 与 NSFW 的所有页面');
      }
      updateComicRuleText(environment.nai, '');
      expect((await build()).map(message => message.content).join('\n')).not.toContain('此作品专用');
    }
  });
});
