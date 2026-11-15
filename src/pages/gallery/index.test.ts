import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as Vue from 'vue';
import { createRenderer, nextTick, ssrContextKey } from 'vue';
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import Gallery from './index.vue';
import { listUserImageFolders, listUserImages, probeUserImage } from '@/st/images';
import { deleteImageFileOnly } from '@/floor/storage';
import { isImageMissing, resetMissingImages } from '@/floor/missingImages';
import { openLightbox } from '@/floor/lightbox';
import { confirmDialog } from '@/components/confirm';

declare const toastr: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

vi.mock('@/components/Icon.vue', () => ({ default: () => null }));
vi.mock('@/components/confirm', () => ({ confirmDialog: vi.fn() }));
vi.mock('@/floor/lightbox', () => ({ openLightbox: vi.fn() }));
vi.mock('@/floor/storage', () => ({
  readStore: vi.fn(),
  sidecarPathFor: vi.fn(),
  deleteImageFileOnly: vi.fn(),
}));
vi.mock('@/st/context', () => ({ getContext: () => ({ chat: [], name2: 'Alpha' }) }));
vi.mock('@/st/images', () => ({
  ARTIST_PREVIEW_FOLDER: 'artist-previews',
  listUserImageFolders: vi.fn(),
  listUserImages: vi.fn(),
  probeUserImage: vi.fn(),
}));
vi.mock('vue', async importOriginal => {
  const vue = await importOriginal<typeof import('vue')>();
  // Keep Vue's real rendering and events; CSS transitions and native input listeners need a browser.
  return { ...vue, Transition: vue.BaseTransition, vModelText: {} };
});

// Vitest's Node pipeline supplies SSR output; compile the same template for client-side node checks.
const { descriptor } = parse(readFileSync(new URL('./index.vue', import.meta.url), 'utf8'));
const template = compileTemplate({
  source: descriptor.template!.content,
  filename: 'index.vue',
  id: 'gallery-test',
  compilerOptions: {
    mode: 'function',
    bindingMetadata: compileScript(descriptor, { id: 'gallery-test' }).bindings,
  },
});
if (template.errors.length) throw new Error(template.errors.join('\n'));
const ClientGallery = { ...Gallery, render: new Function('Vue', template.code)(Vue) };

interface TestNode {
  type: string;
  text: string;
  props: Record<string, unknown>;
  children: TestNode[];
  parent: TestNode | null;
}

function node(type: string, text = ''): TestNode {
  return { type, text, props: {}, children: [], parent: null };
}

function remove(child: TestNode): void {
  if (!child.parent) return;
  child.parent.children.splice(child.parent.children.indexOf(child), 1);
  child.parent = null;
}

function insert(child: TestNode, parent: TestNode, anchor?: TestNode | null): void {
  remove(child);
  parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, child);
  child.parent = parent;
}

// A small in-memory host lets the existing Node test suite count actual Vue-rendered nodes.
const renderer = createRenderer<TestNode, TestNode>({
  createElement: type => node(type),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (target, text) => { target.text = text; },
  setElementText: (target, text) => { target.text = text; target.children = []; },
  patchProp: (target, key, _previous, value) => { target.props[key] = value; },
  parentNode: target => target.parent,
  nextSibling: target => {
    const siblings = target.parent?.children ?? [];
    return siblings[siblings.indexOf(target) + 1] ?? null;
  },
  insert,
  remove,
  insertStaticContent: (content, parent, anchor) => {
    const target = node('#static', content);
    insert(target, parent, anchor);
    return [target, target];
  },
});

function find(root: TestNode, selector: string): TestNode[] {
  const matches = selector.startsWith('.')
    ? String(root.props.class ?? '').split(' ').includes(selector.slice(1))
    : root.type === selector;
  return [...(matches ? [root] : []), ...root.children.flatMap(child => find(child, selector))];
}

/** \u6587\u672c\u5185\u5bb9\uff08\u542b\u5168\u90e8\u540e\u4ee3\uff09\u3002\u63d2\u503c\u4f1a\u5404\u81ea\u6210\u4e00\u4e2a #text \u8282\u70b9\uff0c\u9010\u5c42\u62fc\u8d77\u6765\u624d\u770b\u5f97\u5230\u6574\u53e5\u3002 */
function text(target: TestNode): string {
  return target.text + target.children.map(text).join('');
}

/** \u6392\u7a7a\u5fae\u4efb\u52a1 + \u4e00\u4e2a\u5b8f\u4efb\u52a1\uff1a\u7ec4\u4ef6\u91cc await \u8fc7\u7f51\u7edc\u7684\u90a3\u4e9b\u5206\u652f\u8981\u7b49\u5b83\u624d\u843d\u5230 DOM \u4e0a\u3002 */
async function flush(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
  await nextTick();
}

async function click(target: TestNode): Promise<void> {
  (target.props.onClick as () => void)();
  await nextTick();
}

async function change(target: TestNode): Promise<void> {
  (target.props.onChange as () => void)();
  await nextTick();
}

const prefix = '\u67cf\u5b9d\u7ed8_';
const alpha = `${prefix}Alpha`;
const beta = `${prefix}Beta`;
const expandedKey = 'bbi.ui.galleryExpanded.v1';
/** 删除调用要的是归一化 key（解码、无前导斜杠），与组件 image.key、markImagesMissing 同一口径；<img> 用的编码 src 是另一回事（见 imageSrc）。 */
const keyOf = (folder: string, file: string) => `user/images/${folder}/${file}`;
let stored: Map<string, string>;
let app: ReturnType<typeof renderer.createApp> | undefined;

async function mount(): Promise<TestNode> {
  app?.unmount();
  const root = node('root');
  app = renderer.createApp(ClientGallery);
  app.provide(ssrContextKey, {});
  app.mount(root);
  await flush();
  return root;
}

beforeEach(() => {
  stored = new Map();
  resetMissingImages();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
  vi.stubGlobal('toastr', { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() });
  vi.mocked(listUserImageFolders).mockResolvedValue([alpha, beta]);
  vi.mocked(listUserImages).mockImplementation(async folder =>
    Array.from({ length: folder === alpha ? 53 : 5 }, (_, i) => `image-${i}.png`),
  );
  // 默认每张 1 KB:体积相关断言用得上,其余用例无副作用
  vi.mocked(probeUserImage).mockResolvedValue({ exists: true, size: 1024 });
  vi.mocked(deleteImageFileOnly).mockResolvedValue(undefined);
  vi.mocked(confirmDialog).mockResolvedValue(true);
});

afterEach(() => {
  app?.unmount();
  app = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('gallery on-demand rendering', () => {
  it('starts folded without image nodes, including when old collapsed preferences exist', async () => {
    stored.set('bbi.ui.galleryCollapsed.v1', JSON.stringify([beta]));
    const root = await mount();
    expect(find(root, '.gal-fold-trigger').map(head => head.props['aria-expanded'])).toEqual([false, false]);
    expect(find(root, 'img')).toHaveLength(0);
    // 折叠容器本身常驻(高度过渡要有 0fr 起点),但没展开过的组不渲染任何内容
    expect(find(root, '.gal-fold-wrap')).toHaveLength(2);
    expect(find(root, '.gal-fold-body')).toHaveLength(0);
  });

  it('adds at most 24 images per click, handles the remainder and keeps folded groups loaded', async () => {
    const root = await mount();
    const [alphaHead, betaHead] = find(root, '.gal-fold-trigger');
    await click(alphaHead);
    expect(find(root, 'img')).toHaveLength(24);
    expect(find(root, 'img').every(image => image.props.loading === 'lazy')).toBe(true);
    await click(find(root, '.gal-more')[0]);
    expect(find(root, 'img')).toHaveLength(48);
    expect(find(root, '.gal-more')[0].children.some(child => child.text.includes('5'))).toBe(true);
    await click(find(root, '.gal-more')[0]);
    expect(find(root, 'img')).toHaveLength(53);
    expect(find(root, '.gal-more')).toHaveLength(0);

    // 收起只把高度归零,<img> 必须留在 DOM 里:重挂一次就是一张图一个网络往返
    // (/user/images 不带 maxAge,Firefox 更是 no-store),公网连 ST 时会白屏一拍。
    await click(alphaHead);
    expect(find(root, '.gal-fold-wrap')[0].props.class).toContain('is-collapsed');
    expect(find(root, 'img')).toHaveLength(53);
    await click(alphaHead);
    expect(find(root, '.gal-fold-wrap')[0].props.class).not.toContain('is-collapsed');
    expect(find(root, 'img')).toHaveLength(53);
    await click(betaHead);
    expect(find(root, 'img')).toHaveLength(58);
    expect(find(root, '.gal-more')).toHaveLength(0);
  });

  it('remembers manual expansion but resets batch sizes on remount and folds new groups', async () => {
    let root = await mount();
    await click(find(root, '.gal-fold-trigger')[0]);
    await click(find(root, '.gal-more')[0]);
    expect(JSON.parse(stored.get(expandedKey)!)).toEqual([alpha]);

    vi.mocked(listUserImageFolders).mockResolvedValue([alpha, beta, `${prefix}Gamma`]);
    root = await mount();
    expect(find(root, 'img')).toHaveLength(24);
    expect(find(root, '.gal-fold-trigger').map(head => head.props['aria-expanded'])).toEqual([true, false, false]);
    await click(find(root, '.gal-fold-trigger')[0]);
    expect(JSON.parse(stored.get(expandedKey)!)).toEqual([]);
    root = await mount();
    expect(find(root, 'img')).toHaveLength(0);
  });

  it.each(['invalid json', '{}', 'null', '[123, null]'])(
    'falls back to folded groups for unusable preferences: %s',
    async raw => {
      stored.set(expandedKey, raw);
      expect(find(await mount(), 'img')).toHaveLength(0);
    },
  );

  it('still toggles and loads batches when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Storage disabled'); },
      setItem: () => { throw new Error('Storage disabled'); },
    });
    const root = await mount();
    expect(find(root, 'img')).toHaveLength(0);
    await click(find(root, '.gal-fold-trigger')[0]);
    await click(find(root, '.gal-more')[0]);
    expect(find(root, 'img')).toHaveLength(48);
  });

  it('does not open groups just because they match a search', async () => {
    const root = await mount();
    (find(root, 'input')[0].props['onUpdate:modelValue'] as (query: string) => void)('Beta');
    await nextTick();
    expect(find(root, '.gal-fold-trigger')).toHaveLength(1);
    expect(find(root, 'img')).toHaveLength(0);
    await click(find(root, '.gal-fold-trigger')[0]);
    expect(find(root, 'img')).toHaveLength(5);
  });
});

// 体积统计暂时禁用:作者不满意「逐张 HEAD 读 Content-Length」的方案(见 index.vue 的 load())。
// 以下用例原样保留,恢复 measureSizes 调用时去掉 .skip 即可。
describe.skip('gallery size readout', () => {
  it('sums measured bytes per group and in total, sizing every image including unrendered ones', async () => {
    const root = await mount();
    // 58 张全都量过(懒加载只是渲染策略,体积统计必须覆盖整组,否则角标随下拉往上跳)
    expect(vi.mocked(probeUserImage)).toHaveBeenCalledTimes(58);
    expect(find(root, '.gal-size').map(text)).toEqual(['53 KB', '5.0 KB']);
    expect(text(find(root, '.gal-count')[0])).toContain('58 KB');
    // 量全了就不带「≥」,也不再显示「还在量」的加号
    expect(find(root, '.gal-size').some(span => text(span).includes('≥'))).toBe(false);
    expect(find(root, '.gal-measuring')).toHaveLength(0);
  });

  it('marks partial sums with ≥ and never counts an unmeasurable file as zero', async () => {
    // 探不到大小的那些(HEAD 失败 / 缺 Content-Length)一律不计入,而不是当 0 字节累加:
    // 谎报 0 会让「量不到」看起来像「量到了,就是空的」。
    vi.mocked(probeUserImage).mockImplementation(async src =>
      src.includes(encodeURIComponent(alpha))
        ? (src.endsWith('image-0.png') ? { exists: true, size: 2048 } : null)
        : { exists: true, size: null },
    );
    const root = await mount();
    // Alpha 只量出一张 → 带 ≥;Beta 一张都没量出来 → 整个角标不显示(而非 0 B)
    expect(find(root, '.gal-size').map(text)).toEqual(['≥ 2.0 KB']);
    expect(text(find(root, '.gal-count')[0])).toContain('2.0 KB');
  });

  it('skips already-measured images when reloading', async () => {
    const root = await mount();
    expect(vi.mocked(probeUserImage)).toHaveBeenCalledTimes(58);
    vi.mocked(listUserImages).mockImplementation(async folder =>
      Array.from({ length: folder === alpha ? 54 : 5 }, (_, i) => `image-${i}.png`),
    );
    await click(find(root, '.gal-icon-btn')[0]);
    await flush();
    // 只有新增的那一张要量
    expect(vi.mocked(probeUserImage)).toHaveBeenCalledTimes(59);
    expect(find(root, '.gal-size').map(text)).toEqual(['54 KB', '5.0 KB']);
  });
});

describe('gallery size readout disabled', () => {
  it('issues no HEAD probes and renders no size UI', async () => {
    const root = await mount();
    // 进页零体积探测;刷新也不该冒出来——请求数随图库线性增长正是暂时停用它的原因
    expect(vi.mocked(probeUserImage)).not.toHaveBeenCalled();
    await click(find(root, '.gal-icon-btn')[0]);
    await flush();
    expect(vi.mocked(probeUserImage)).not.toHaveBeenCalled();
    // 分组角标、总计体积、测量中的「+」一律不出现
    expect(find(root, '.gal-size')).toHaveLength(0);
    expect(find(root, '.gal-measuring')).toHaveLength(0);
    expect(text(find(root, '.gal-count')[0])).not.toContain('KB');
  });
});

describe('gallery multi-select delete', () => {
  /** 进入选择态并展开 Alpha。 */
  async function selectMode(): Promise<TestNode> {
    const root = await mount();
    await click(find(root, '.gal-select-toggle')[0]);
    await click(find(root, '.gal-fold-trigger')[0]);
    return root;
  }

  it('keeps thumbnails opening the lightbox until selection mode is on', async () => {
    const root = await mount();
    await click(find(root, '.gal-fold-trigger')[0]);
    expect(find(root, '.gal-check')).toHaveLength(0);
    await click(find(root, '.gal-thumb')[0]);
    await flush();
    expect(vi.mocked(openLightbox)).toHaveBeenCalledTimes(1);

    await click(find(root, '.gal-select-toggle')[0]);
    await click(find(root, '.gal-thumb')[0]);
    await flush();
    // 选择态下点图只勾选,不再放大
    expect(vi.mocked(openLightbox)).toHaveBeenCalledTimes(1);
    expect(find(root, '.gal-thumb')[0].props.class).toContain('is-selected');
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('1');
  });

  it('deletes the picked images and their sidecars, then drops them in place', async () => {
    const root = await selectMode();
    await click(find(root, '.gal-thumb')[0]);
    await click(find(root, '.gal-thumb')[2]);
    // 先把 Alpha 翻到第二批:删除后不能把用户翻出来的批次重置回 24 张
    await click(find(root, '.gal-more')[0]);
    expect(find(root, 'img')).toHaveLength(48);

    await click(find(root, '.bbi-btn-danger')[0]);
    await flush();

    expect(vi.mocked(confirmDialog)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deleteImageFileOnly).mock.calls.map(call => call[0])).toEqual([
      keyOf(alpha, 'image-0.png'),
      keyOf(alpha, 'image-2.png'),
    ]);
    // 就地摘除:53 → 51,且没有重新拉目录(重新 load 会把展开态和批次全重置)
    expect(vi.mocked(listUserImages)).toHaveBeenCalledTimes(2);
    expect(find(root, '.gal-badge').map(text)).toEqual(['51', '5']);
    // 已显示张数(48)不变,后面的图往前补位——删两张不该让用户重新往下翻
    expect(find(root, 'img')).toHaveLength(48);
    expect(text(find(root, '.gal-count')[0])).toContain('56 张');
    // 体积显示已暂时禁用(见 load()):删除后就地渲染的列表里也不该出现任何体积角标
    expect(find(root, '.gal-size')).toHaveLength(0);
    // 楼层卡片据此立刻降级,不必等它自己 404
    expect(isImageMissing(`user/images/${alpha}/image-0.png`)).toBe(true);
    expect(isImageMissing(`user/images/${alpha}/image-1.png`)).toBe(false);
    // 选中项清空后自动退出选择态
    expect(find(root, '.gal-actionbar')).toHaveLength(0);
  });

  it('selects the whole group from the header checkbox, not just the rendered batch', async () => {
    const root = await selectMode();
    expect(find(root, 'img')).toHaveLength(24);
    await change(find(root, '.gal-group-check')[0].children[0]);
    // 懒加载只渲染了 24 张,但「全选这个角色」指的是这个角色的全部 53 张
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('53');

    await click(find(root, '.bbi-btn-danger')[0]);
    await flush();
    expect(vi.mocked(deleteImageFileOnly)).toHaveBeenCalledTimes(53);
    // 删空的分组整组消失
    expect(find(root, '.gal-fold-trigger')).toHaveLength(1);
    expect(text(find(root, '.gal-count')[0])).toContain('1 位角色');
  });

  it('keeps the files when the confirmation is declined', async () => {
    vi.mocked(confirmDialog).mockResolvedValue(false);
    const root = await selectMode();
    await click(find(root, '.gal-thumb')[0]);
    await click(find(root, '.bbi-btn-danger')[0]);
    await flush();
    expect(vi.mocked(deleteImageFileOnly)).not.toHaveBeenCalled();
    // 取消不该顺手把选中项清掉:用户多半是想再核对一遍
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('1');
    expect(find(root, '.gal-badge').map(text)).toEqual(['53', '5']);
  });

  it('keeps failed deletions selected and reports them instead of pretending they went', async () => {
    vi.mocked(deleteImageFileOnly).mockImplementation(async path => {
      if (path.endsWith('image-1.png')) throw new Error('EBUSY');
    });
    const root = await selectMode();
    await click(find(root, '.gal-thumb')[0]);
    await click(find(root, '.gal-thumb')[1]);
    await click(find(root, '.bbi-btn-danger')[0]);
    await flush();

    // 成功的摘掉、失败的留在列表里且仍勾着,用户可以直接重试
    expect(find(root, '.gal-badge').map(text)).toEqual(['52', '5']);
    expect(isImageMissing(`user/images/${alpha}/image-0.png`)).toBe(true);
    expect(isImageMissing(`user/images/${alpha}/image-1.png`)).toBe(false);
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('1');
    expect(toastr.error).toHaveBeenCalled();
    expect(toastr.success).not.toHaveBeenCalled();
  });

  it('drops the selection when leaving selection mode', async () => {
    const root = await selectMode();
    await click(find(root, '.gal-thumb')[0]);
    await click(find(root, '.gal-select-toggle')[0]);
    await click(find(root, '.gal-select-toggle')[0]);
    // 留着上次的选中项,下次进来会对着一批不记得为何选中的图按删除
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('0');
    expect(find(root, '.gal-thumb')[0].props.class).not.toContain('is-selected');
  });

  it('puts the action bar right below the toolbar, not after the (possibly very long) list', async () => {
    // 呼出它的「选择」钮在工具条里。操作条若摆在列表末尾,角色多时按下去屏幕上什么都不动,
    // 像没生效;吸顶则一按就看见。这条锁的是顺序——CSS 的 sticky 单测看不见,但 DOM 顺序看得见。
    const root = await mount();
    await click(find(root, '.gal-select-toggle')[0]);
    const page = find(root, '.bbi-page')[0];
    const order = page.children.map(child => String(child.props.class ?? ''));
    expect(order.findIndex(cls => cls.includes('gal-actionbar')))
      .toBeLessThan(order.findIndex(cls => cls.includes('gal-groups')));
  });

  it('uses the shared .bbi-checkbox so themes restyling it (pastel redraws the tick) apply here too', async () => {
    const root = await selectMode();
    const box = find(root, '.gal-group-check')[0].children[0];
    expect(String(box.props.class ?? '')).toContain('bbi-checkbox');
  });
});

describe('gallery directory export', () => {
  const original = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

  async function selectAlpha(): Promise<TestNode> {
    const root = await mount();
    await click(find(root, '.gal-select-toggle')[0]);
    await change(find(root, '.gal-group-check')[0].children[0]);
    return root;
  }

  function mockDirectory(writeFailure = '') {
    const files = new Map<string, Uint8Array>();
    const getFileHandle = vi.fn(async (name: string, options?: { create: boolean }) => {
      if (options?.create && !files.has(name)) files.set(name, new Uint8Array());
      if (!files.has(name)) throw new DOMException('Missing file', 'NotFoundError');
      return {
        getFile: async () => ({ size: files.get(name)!.length }),
        createWritable: async () => {
          let pending: Uint8Array;
          return {
            write: async (blob: Blob) => {
              if (name === writeFailure) throw new DOMException('Disk full', 'QuotaExceededError');
              pending = new Uint8Array(await blob.arrayBuffer());
            },
            close: async () => { files.set(name, pending); },
            abort: vi.fn().mockResolvedValue(undefined),
          };
        },
      };
    });
    const pick = vi.fn().mockResolvedValue({
      name: '导出目录',
      getFileHandle,
      removeEntry: async (name: string) => { files.delete(name); },
    });
    vi.stubGlobal('window', { showDirectoryPicker: pick });
    return { files, pick };
  }

  function imageResponse(): Response {
    return new Response(original, { headers: { 'Content-Type': 'image/png' } });
  }

  it('copies the whole selected group even when all thumbnails are folded, and keeps existing files', async () => {
    const { files, pick } = mockDirectory();
    files.set('bbi_Alpha_0.png', Uint8Array.of(42));
    const fetchImage = vi.fn(async () => imageResponse());
    vi.stubGlobal('fetch', fetchImage);
    const root = await selectAlpha();
    expect(find(root, 'img')).toHaveLength(0);
    await click(find(root, '.gal-export')[0]);
    await flush();

    expect(pick).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(fetchImage).toHaveBeenCalledTimes(53);
    const alphaPath = `/user/images/${encodeURIComponent(alpha)}/image-52.png`;
    expect(fetchImage).toHaveBeenLastCalledWith(alphaPath, expect.objectContaining({ mode: 'same-origin' }));
    expect(files.size).toBe(54);
    expect(files.get('bbi_Alpha_0.png')).toEqual(Uint8Array.of(42));
    expect(files.get('bbi_Alpha_0 (2).png')).toEqual(original);
    expect([...files.values()].slice(1).every(bytes => bytes.join() === original.join())).toBe(true);
    expect(vi.mocked(deleteImageFileOnly)).not.toHaveBeenCalled();
    expect(text(find(root, '.gal-export-status')[0])).toContain('已导出 53 张到「导出目录」');
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('53');
  });

  it('keeps the selection and does not fetch any images if the folder picker is cancelled', async () => {
    const { pick } = mockDirectory();
    pick.mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    const fetchImage = vi.fn();
    vi.stubGlobal('fetch', fetchImage);
    const root = await selectAlpha();
    await click(find(root, '.gal-export')[0]);
    await flush();

    expect(fetchImage).not.toHaveBeenCalled();
    expect(text(find(root, '.gal-export-status')[0])).toContain('没有选到导出目录');
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('53');
  });

  it('lets the user recover from a directory picker that never opens, ignoring its late result', async () => {
    vi.mocked(listUserImages).mockResolvedValue(['one.png']);
    const { files, pick } = mockDirectory();
    const directory = await pick();
    let resolveFirst: (value: unknown) => void = () => {};
    pick.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const fetchImage = vi.fn(async () => imageResponse());
    vi.stubGlobal('fetch', fetchImage);
    const root = await selectAlpha();
    await click(find(root, '.gal-export')[0]);

    expect(text(find(root, '.gal-export-status')[0])).toContain('等待系统打开目录选择窗口');
    expect(text(find(root, '.gal-stop-export')[0])).toBe('结束等待');
    await click(find(root, '.gal-stop-export')[0]);
    expect(find(root, '.gal-export')[0].props.disabled).toBe(false);
    expect(text(find(root, '.gal-actionbar-count')[0])).toContain('1');
    expect(text(find(root, '.gal-export-status')[0])).toContain('已结束等待');

    await click(find(root, '.gal-export')[0]);
    resolveFirst(directory);
    await flush();
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect([...files]).toEqual([['one.png', original]]);
    expect(text(find(root, '.gal-export-status')[0])).toContain('已导出 1 张');
  });

  it('reports individual read and write failures, and keeps successful exports', async () => {
    vi.mocked(listUserImages).mockResolvedValue(['working.png', 'missing.png', 'write-failure.png']);
    const { files } = mockDirectory('bbi_Alpha_failure.png');
    vi.stubGlobal('fetch', vi.fn(async (src: string) => src.endsWith('/missing.png')
      ? new Response('Not found', { status: 404 })
      : imageResponse()));
    const root = await selectAlpha();
    await click(find(root, '.gal-export')[0]);
    await flush();

    expect([...files]).toEqual([['working.png', original]]);
    expect(text(find(root, '.gal-export-status')[0])).toContain('已导出 1 张到「导出目录」，2 张失败');
  });

  it('stops pending work and leaves already exported originals in the directory', async () => {
    vi.mocked(listUserImages).mockResolvedValue(['done.png', 'in-flight.png', 'queued.png']);
    const { files } = mockDirectory();
    const fetchImage = vi.fn(async (src: string, { signal }: { signal: AbortSignal }) => {
      if (src.endsWith('/done.png')) return imageResponse();
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetchImage);
    const root = await selectAlpha();
    await click(find(root, '.gal-export')[0]);
    await flush();
    expect(text(find(root, '.gal-export-status')[0])).toContain('正在导出 1/3 张');
    await click(find(root, '.gal-stop-export')[0]);
    await flush();

    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect([...files]).toEqual([['done.png', original]]);
    expect(text(find(root, '.gal-export-status')[0])).toContain('已停止导出，已导出 1 张到「导出目录」，2 张未完成');
  });

  it('explains when the client cannot choose a writable directory', async () => {
    const root = await selectAlpha();
    expect(find(root, '.gal-export')[0].props.disabled).toBe(true);
    expect(text(find(root, '.gal-export-status')[0])).toContain('当前客户端无法选择导出目录');
  });
});
