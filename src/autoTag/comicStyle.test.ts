import { describe, expect, it } from 'vitest';
import { autoTagProfile, buildAutoTagMessages, captureAutoTagEnvironment } from './prompt';
import {
  COMIC_PANEL_STYLES, COMIC_GUTTER_MODES, resolveComicPanelStyle, resolveComicGutterMode,
  DEFAULT_NAI_COMIC_SPEC, DEFAULT_NAI_COMIC_V2_SPEC, DEFAULT_NAI_COMIC_THINKING, DEFAULT_NAI_COMIC_V2_THINKING,
  DEFAULT_NAI_COMIC_UNIVERSAL_GRAMMAR,
  settings,
} from '@/state/settings';
import type { STContext } from '@/st/context';

const context = { chat: [{ name: '角色', is_user: false, is_system: false, mes: '两人在车站相遇，归还失物。' }],
  name1: '读者', name2: '角色', chatMetadata: {} } as unknown as STContext;
function environment(comicV2: boolean, style: string, gutter = 'boxed') {
  const env = captureAutoTagEnvironment({ nl: false, naiCharPrompts: true, lockedSize: 'portrait' });
  env.backend = 'nai';
  Object.assign(env.nai, { model: 'nai-diffusion-5-full', comicMode: true, comicV2, comicPanelStyle: style, comicGutter: gutter });
  return env;
}
async function messages(env: ReturnType<typeof environment>) {
  return buildAutoTagMessages(context, 0, { ...settings.autoTag }, null, undefined, '角色固定外貌', undefined, env.profile, env);
}

describe('comic style selection reaches actual tag requests', () => {
  it.each(COMIC_PANEL_STYLES.flatMap(style => [false, true].map(comicV2 => ({ style, comicV2 }))))(
    'sends only $style.id and the selected gutter in comic V2=$comicV2', async ({ style, comicV2 }) => {
      const result = await messages(environment(comicV2, style.id));
      const spec = result.find(message => message.content.includes('━━━ 五、分镜风格与画面执行 ━━━'))!.content;
      expect(spec.split(DEFAULT_NAI_COMIC_UNIVERSAL_GRAMMAR)).toHaveLength(2);
      if (style.rule) expect(spec).toContain(style.rule);
      else expect(spec).not.toContain('附加分镜风格:');
      expect(spec).toContain(resolveComicGutterMode('boxed').rule);
      for (const other of COMIC_PANEL_STYLES.filter(item => item.rule && item.id !== style.id)) expect(spec).not.toContain(other.rule);
      expect(spec).toContain(comicV2 ? DEFAULT_NAI_COMIC_V2_SPEC : DEFAULT_NAI_COMIC_SPEC);
    },
  );
  it.each(COMIC_GUTTER_MODES)('sends the selected $id gutter without another gutter rule', async gutter => {
    const result = await messages(environment(true, 'universal', gutter.id));
    const spec = result.find(message => message.content.includes('━━━ 五、分镜风格与画面执行 ━━━'))!.content;
    expect(spec).toContain(gutter.rule);
    for (const other of COMIC_GUTTER_MODES.filter(item => item.id !== gutter.id)) expect(spec).not.toContain(other.rule);
  });
  it('uses a new selection in the next capture while preserving an in-progress stream snapshot', async () => {
    const oldNai = { ...settings.nai }, oldBackend = settings.defaultBackend;
    try {
      settings.defaultBackend = 'nai'; Object.assign(settings.nai, { model: 'nai-diffusion-5-full', comicMode: true, comicV2: true, comicPanelStyle: 'universal' });
      const frozen = captureAutoTagEnvironment(autoTagProfile()); settings.nai.comicPanelStyle = 'yonkoma';
      const ongoing = await messages(frozen), next = await messages(captureAutoTagEnvironment());
      expect(ongoing.some(message => message.content.includes(DEFAULT_NAI_COMIC_UNIVERSAL_GRAMMAR))).toBe(true);
      expect(ongoing.some(message => message.content.includes(resolveComicPanelStyle('yonkoma').rule))).toBe(false);
      expect(next.some(message => message.content.includes(resolveComicPanelStyle('yonkoma').rule))).toBe(true);
      expect(next.some(message => message.content.includes(DEFAULT_NAI_COMIC_UNIVERSAL_GRAMMAR))).toBe(true);
    } finally { Object.assign(settings.nai, oldNai); settings.defaultBackend = oldBackend; }
  });
  it('keeps seven optional styles and preserves the legacy universal selection without selecting another style', () => {
    expect(COMIC_PANEL_STYLES.filter(style => style.rule)).toHaveLength(7);
    const universal = resolveComicPanelStyle('universal');
    expect(universal.id).toBe('universal');
    expect(universal.label).toContain('仅通用规则');
    expect(universal.rule).toBe('');
    expect(resolveComicPanelStyle(undefined).id).toBe('eromanga');
    expect(resolveComicPanelStyle('invalid').id).toBe('eromanga');
  });
  it('preserves balanced-style exceptions in both the writing spec and final checks', () => {
    for (const text of [DEFAULT_NAI_COMIC_SPEC, DEFAULT_NAI_COMIC_V2_SPEC, DEFAULT_NAI_COMIC_THINKING, DEFAULT_NAI_COMIC_V2_THINKING]) {
      expect(text).toContain('经典四格'); expect(text).toContain('均衡四格'); expect(text).toContain('喜剧日常');
      expect(text).toContain('仅通用规则按事件自然分配主次');
    }
    expect(resolveComicPanelStyle('yonkoma').rule).toContain('严格四格');
    expect(resolveComicPanelStyle('slice').rule).toContain('避免倾斜格和重叠格');
    expect(resolveComicPanelStyle('comedy').rule).toContain('画格方正规整');
  });
  it('does not apply comic styles when comic mode is disabled or the model is outside V5', async () => {
    for (const change of [{ comicMode: false }, { model: 'nai-diffusion-4-5-full' }]) {
      const env = environment(true, 'shounen'); Object.assign(env.nai, change);
      expect((await messages(env)).some(message => message.content.includes(resolveComicPanelStyle('shounen').rule))).toBe(false);
    }
  });
});
