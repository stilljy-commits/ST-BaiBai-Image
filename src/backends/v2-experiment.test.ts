import { describe, expect, it } from 'vitest';
import { parseImagePlan } from '@/autoTag/protocol';
import { parseImageTagContent, serializeImageTag } from '@/st/imageTagRegex';
import { buildNaiParameters, fullPositivePrompt } from '@/backends/nai';
import type { NaiSettings } from '@/state/settings';

/**
 * 实验:漫画页 V2 全链路 dry-run。
 * 输入 = 用户提供的真实 1.3.1 预设提示词结构(Base 行 + 逐人物条目),
 * 走 柏宝绘 的完整发送链:LLM JSON → parseImagePlan → serializeImageTag(落正文)
 * → parseImageTagContent(出图时读回)→ fullPositivePrompt/buildNaiParameters(发 NAI)。
 * 校验最终 v4_prompt 与 1.3.1 的结构逐字段等价。
 */

const segments = [
  { id: 'P1', sourceLine: 0, text: 'x' },
  { id: 'P2', sourceLine: 2, text: 'x' },
];

const nai: NaiSettings = {
  url: 'https://image.novelai.net',
  naturalLanguage: true,
  orientationLock: 'auto',
  qualityTags: '',
  negativePrompt: '',
  comicMode: true,
  comicV2: true,
  comicText: true,
  comicPanelStyle: 'eromanga',
  comicGutter: 'bleed',
  comicLighting: true,
  comicAntiPossession: false,
  comicNsfwRules: false,
  comicExtraRules: '',
  resolution: '832×1216',
  portraitSize: '1024×1536',
  landscapeSize: '1536×1024',
  key: 'test',
  endpoints: [{ id: 'nep_official', name: 'NovelAI 官方', url: 'https://image.novelai.net', key: 'test' }],
  activeEndpointId: 'nep_official',
  model: 'nai-diffusion-5-full',
  undesiredContent: '',
  sampler: 'k_euler',
  steps: 28,
  scale: 5,
  cfgRescale: 0,
  noiseSchedule: 'karras',
  seed: 42,
  varietyBoost: true,
  normalizeRefStrength: true,
  concurrency: 1,
  vibes: [],
  artistPresets: [],
  activeArtistId: '',
};

// ── 1.3.1 预设的真实输出(用户提供的生图提示词,逐字) ──
const REAL_BASE =
  'R-15, 1girl, comic, 3 panels, tight layout, white border, dynamic blue and warm orange rim lighting, glossy reflections, sweat drops, text, chinese text, This is the medium panel in the upper right of the page, the small cut-in panel is at the top left corner, the large main panel fills the bottom half of the page';

const REAL_CHARS = [
  {
    name: '樱岛麻衣',
    tag: 'girl, sakurajima mai (rascal does not dream of bunny girl senpai), long black hair, blue eyes, upper body, embarrassed, blush, sweat, speech bubble\nText: 呼……哈……心率……一百六十五……',
    nl: '',
  },
  {
    name: '樱岛麻衣',
    tag: 'girl, sakurajima mai (rascal does not dream of bunny girl senpai), neck and chest view, gigantic breasts',
    nl: '',
  },
  {
    name: '樱岛麻衣',
    tag: 'girl, sakurajima mai (rascal does not dream of bunny girl senpai), full body, stationary bike, sportswear, dynamic pose, speed lines\nText: 还能再提速……！',
    nl: '',
  },
];

describe('漫画页 V2 全链路实验(1.3.1 真实数据 dry-run)', () => {
  it('LLM JSON → 最终 v4_prompt,与 1.3.1 结构逐字段等价', () => {
    // ① 副 API 返回的 JSON(模拟 LLM 按 V2 规范输出)
    const llmJson = JSON.stringify({
      images: [
        { position: 'P2', tag: REAL_BASE, nl: '', characters: REAL_CHARS, negative: '', size: 'portrait' },
      ],
      changes: [],
    });

    // ② 协议解析(含 characters Text: 行换行保留)
    const plan = parseImagePlan(llmJson, segments, 0, 1);
    const image = plan.images[0];
    expect(image.tag).toBe(REAL_BASE);
    expect(image.characters).toHaveLength(3);
    expect(image.characters[0].tag).toContain('\nText: 呼……哈……心率……一百六十五……');

    // ③ 序列化落正文 → ④ 出图时读回(往返无损)
    const serialized = serializeImageTag({
      tag: image.tag,
      nl: image.nl,
      negative: image.negative,
      characters: image.characters,
      size: image.size,
    });
    const readBack = parseImageTagContent(serialized);
    expect(readBack.tag).toBe(REAL_BASE);
    expect(readBack.characters).toEqual(REAL_CHARS);

    // ⑤ 装配最终 NAI payload
    const input = fullPositivePrompt(nai, readBack.tag, readBack.nl);
    const params = buildNaiParameters(nai, {
      prompt: readBack.tag,
      nl: readBack.nl,
      characters: readBack.characters,
      size: readBack.size,
      seed: 42,
    });
    const v4 = params.v4_prompt as {
      caption: {
        base_caption: string;
        char_captions: Array<{ char_caption: string; centers: Array<{ x: number; y: number }> }>;
      };
      use_coords: boolean;
      use_order: boolean;
    };


    // 逐字段断言:Base 行 + 官方质量词(no text 已滤),三条 char_captions、fandom tag 保留、Text 行逐字保留
    expect(input).toBe(`${REAL_BASE}, very aesthetic, masterpiece`);
    expect(v4.caption.base_caption).toBe(`${REAL_BASE}, very aesthetic, masterpiece`);
    expect(v4.caption.char_captions).toHaveLength(3);
    expect(v4.caption.char_captions[0].char_caption).toBe(
      'girl, sakurajima mai (rascal does not dream of bunny girl senpai), long black hair, blue eyes, upper body, embarrassed, blush, sweat, speech bubble\nText: 呼……哈……心率……一百六十五……',
    );
    expect(v4.caption.char_captions[1].char_caption).toBe(
      'girl, sakurajima mai (rascal does not dream of bunny girl senpai), neck and chest view, gigantic breasts',
    );
    expect(v4.caption.char_captions[2].char_caption).toBe(
      'girl, sakurajima mai (rascal does not dream of bunny girl senpai), full body, stationary bike, sportswear, dynamic pose, speed lines\nText: 还能再提速……！',
    );
    // 官方 payload 口径
    expect(v4.use_coords).toBe(false);
    expect(v4.use_order).toBe(true);
    expect(v4.caption.char_captions[0].centers).toEqual([{ x: 0.5, y: 0.5 }]);
  });

  it('关闭对白上画:Base 行文字词与条目 Text/气泡全剥,画面词完整保留', () => {
    const off: NaiSettings = { ...nai, comicText: false };
    const input = fullPositivePrompt(off, REAL_BASE);
    expect(input).toBe(
      'R-15, 1girl, comic, 3 panels, tight layout, white border, dynamic blue and warm orange rim lighting, glossy reflections, sweat drops, This is the medium panel in the upper right of the page, the small cut-in panel is at the top left corner, the large main panel fills the bottom half of the page, very aesthetic, masterpiece, no text',
    );
    const params = buildNaiParameters(off, {
      prompt: REAL_BASE,
      characters: REAL_CHARS,
      size: 'portrait',
    });
    const v4 = params.v4_prompt as { caption: { char_captions: Array<{ char_caption: string }> } };
    expect(v4.caption.char_captions[0].char_caption).toBe(
      'girl, sakurajima mai (rascal does not dream of bunny girl senpai), long black hair, blue eyes, upper body, embarrassed, blush, sweat',
    );
    expect(v4.caption.char_captions[2].char_caption).not.toContain('Text:');
  });
});
