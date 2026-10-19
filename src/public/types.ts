import type { Orientation } from '@/backends/size';
import type { BackendId } from '@/state/settings';
import type { CharTagField } from '@/state/charTags';

/**
 * 柏宝绘公开接口的数据结构(DTO)。**第三方插件的契约面。**
 *
 * 纪律(与柏宝书 src/public/types.ts 同款,第三方作者学一套就够):
 * - apiVersion 独立于 pluginVersion:前者是**本文件这些结构**的版本,插件版本天天涨,
 *   它不涨。第三方按 apiVersion 判兼容,不该去解析 pluginVersion 的语义。
 * - 只增不改不删:加可选字段是安全的;改字段含义 / 删字段一律要升 apiVersion。
 *   因此本文件刻意**不暴露**内部类型的全部字段——暴露出去就再也收不回来了
 *   (例:CharTagEntry.history 有 50 条变更记录,第三方拿它没用,先不给)。
 * - 一律是**普通可克隆对象**:不含函数、不含 Vue reactive 代理、不含 class 实例。
 *   跨插件 bundle 边界 instanceof 一律失效,故错误也走 code 字段而非自定义 Error 子类。
 */

export const PUBLIC_API_VERSION = 1 as const;

export interface PublicCapabilities {
  /** globalThis.STBaiBaiImage 可用。 */
  globalApi: true;
  /** 能读角色库(getCharacters)。 */
  characterLibrary: true;
  /** 能调生图(generate)。 */
  generate: true;
  /** 生成的图能落盘进柏宝绘图库(generate 的 save 选项)。 */
  saveToGallery: true;
  /** ready/changed 事件可用。 */
  events: true;
}

/** 一个角色的外貌字段。键与柏宝绘设置页的「角色库」逐项对应。 */
export type PublicCharacterFields = Record<CharTagField, string>;

export interface PublicCharacter {
  /** 角色名。**逐字原样**,不音译不规范化(生图 tag 与正文靠它对齐)。 */
  name: string;
  /**
   * 可直接用于生图的完整 tag 串。
   * 由 fields 按固定顺序(同人身份→性别→头发→眼睛→肤色→体型→标志特征→着装)拼成;
   * 老条目只有整串 raw 时即为 raw 本身。**推荐直接用这个**,别自己拼 fields。
   */
  tag: string;
  /** 分字段的外貌(要自己挑着用时才需要)。 */
  fields: PublicCharacterFields;
  /** 自然语言外貌描述(可空)。 */
  nl: string;
  /**
   * 这条档案从哪来:
   * - 'manual' 用户手写 / 手动编辑过
   * - 'ai'     AI 在剧情里建的档或改过
   * - 'book'   从柏宝书的角色记忆同步来
   */
  source: 'book' | 'manual' | 'ai';
  /**
   * 作用域:
   * - 'global' 全局角色库(跨聊天,只由用户手动维护,AI 改不动)
   * - 'chat'   本聊天的档案(手动基线 + AI 在楼层里的变更重放而来)
   */
  scope: 'global' | 'chat';
  /** 建档时那句「为什么长这样」(多为空串)。 */
  desc: string;
}

export interface GetCharactersOptions {
  /**
   * 取「第 floor 楼之前」的角色库快照(ST 零基 mesid,不含该楼)。
   *
   * 为什么会需要它:角色档案随剧情演进(AI 在某楼给角色换了发色),要为**历史某一楼**
   * 出图就得用那一楼当时的档案,拿当前库会把后来的变更也画进去。
   * 省略 = 当前(全部楼层重放完)的库。
   */
  floor?: number;
}

export interface PublicCharacterList {
  apiVersion: typeof PUBLIC_API_VERSION;
  pluginVersion: string;
  /** 角色库每次变更递增;拿它做缓存失效判断。 */
  revision: number;
  /** 快照对应的楼层(省略 floor 时为 null = 当前)。 */
  floor: number | null;
  characters: PublicCharacter[];
}

export interface PublicBackendStatus {
  apiVersion: typeof PUBLIC_API_VERSION;
  pluginVersion: string;
  /** 用户当前选的出图后端。 */
  backend: BackendId;
  /** 后端是否已配齐、能出图。false 时 generate 会抛 code='not_configured'。 */
  configured: boolean;
  /** NAI 为模型名;ComfyUI 为当前工作流预设名。**不含服务地址与 API Key。** */
  model: string;
  /**
   * 当前后端是否支持 characters(多角色提示)。
   * NAI 4.5/V5 为 true;**ComfyUI 恒为 false**——传了会被静默丢弃,
   * 故要画多角色时请先看这里,别等出图完才发现。
   */
  supportsCharacters: boolean;
  /** configured=false 时的人话原因(可直接展示给用户);已就绪为空串。 */
  reason: string;
}

/** 多角色提示里的一位(NAI 4.5/V5 的 Character Prompt)。 */
export interface PublicCharacterPrompt {
  /** 角色名,仅用于标识,不进提示词。 */
  name: string;
  /** 该角色的 tag(通常取 PublicCharacter.tag)。 */
  tag: string;
  /** 该角色的自然语言描述(可空)。 */
  nl?: string;
  /** 该人物专属排除词;支持自定义 UC 的 NAI 型号生效。 */
  negative?: string;
}

export interface GenerateRequest {
  /** 正向 danbooru 短 tag。**必填且不能为空**(空串抛 code='invalid_args')。 */
  prompt: string;
  /** 自然语言描述(可空)。 */
  nl?: string;
  /**
   * 本画面的动态负面(可空)。
   * 只对 ComfyUI 生效(填进工作流的 %negative_prompt%);NAI 的负面取用户渠道配置。
   */
  negative?: string;
  /**
   * 多角色提示。需 supportsCharacters 为 true 才会生效,
   * 结果里的 charactersApplied 会明说这次到底用上了没有。
   */
  characters?: PublicCharacterPrompt[];
  /** 画幅方向;缺省 'portrait'。具体像素取用户在渠道页配的横竖尺寸。 */
  size?: Orientation;
  /** 指定种子(正整数)。省略 = 按用户设置决定(NAI 面板固定种子,否则随机)。 */
  seed?: number;
  /**
   * 落盘进柏宝绘图库,**默认 true**。
   *
   * true:图存进 user/images/柏宝绘_<character>/ 并写侧写 json,于是
   *       用户能在柏宝绘图库页里按角色分组看到它、连提示词一起。
   * false:只返回 dataUrl,不碰磁盘——适合「预览一下就丢」的用法。
   *
   * ⚠ 落盘**不写聊天记录**:图不会出现在任何楼层的正文里,也不占楼层卡片。
   *   图显示在哪里由你决定,这正是本接口存在的意义。
   */
  save?: boolean;
  /**
   * 落盘归到哪个角色名下(图库的分组名,即目录 柏宝绘_<character>)。
   * 省略 = 当前聊天的角色名。save=false 时无意义。
   */
  character?: string;
}

export interface GenerateOptions {
  /** 取消本次生成。取消时抛 code='aborted'。 */
  signal?: AbortSignal;
  /** 进度回调(可选)。任何一次回调抛错都只会被记进 console,不影响生成。 */
  onProgress?: (progress: PublicGenerateProgress) => void;
}

export interface PublicGenerateProgress {
  /**
   * - 'queued'     在柏宝绘的 NAI 并发闸门里排队(等别的请求让出槽位)
   * - 'generating' 请求已发出,后端正在画
   * - 'queued-remote' 在 ComfyUI **服务端**队列里(ahead 为前面还有几个)
   * - 'retrying'   被限流了,正在退避重试(attempt/max)
   * - 'saving'     图已拿到,正在落盘
   */
  phase: 'queued' | 'generating' | 'queued-remote' | 'retrying' | 'saving';
  /** phase='queued-remote' 时前面还有几个;未知为 null。 */
  ahead?: number | null;
  /** phase='retrying' 时的第几次/共几次。 */
  attempt?: number;
  max?: number;
}

export interface GenerateResult {
  apiVersion: typeof PUBLIC_API_VERSION;
  pluginVersion: string;
  /**
   * 图片的 data URL(形如 data:image/png;base64,…),可直接 <img src>。
   *
   * 刻意用 data URL 而不是 blob URL:blob 要配对 revokeObjectURL,
   * 忘了就泄漏、替你 revoke 又会让你的 <img> 突然变空白。data URL 没这些坑,
   * 代价是字符串比较大——用完别长期留在内存里。
   */
  dataUrl: string;
  /** 图片格式,如 'png' / 'jpg'。 */
  format: string;
  /**
   * 落盘后的 ST 静态路径(形如 /user/images/柏宝绘_小雪/bbi_….png),可直接 <img src>。
   * save=false 或落盘失败时为 null——**落盘失败不抛错**,图已经在 dataUrl 里了,
   * 不能因为存不进图库就让你连图都拿不到。
   */
  path: string | null;
  /** 本次实际使用的种子(随机时也给,想复现就把它填回 seed)。 */
  seed: number;
  /** 实际出图的后端。 */
  backend: BackendId;
  /**
   * characters 是否真的发给了后端。
   * 你传了 characters 但这里是 false = 被丢弃了(通常是用户在用 ComfyUI)。
   * 柏宝绘**刻意不降级把角色拼进 prompt**:那会画出多份躯干重叠的图。
   */
  charactersApplied: boolean;
}

/**
 * 出错时抛出的 Error 上挂的 code。**按 code 分支,别匹配 message 文案**
 * (message 是给人看的中文,会随版本改;也别用 instanceof,跨 bundle 一律失效)。
 */
export type PublicErrorCode =
  /** 用户取消(你传的 signal 触发了)。 */
  | 'aborted'
  /** 用户还没配好出图后端;reason 在 getBackendStatus() 里。 */
  | 'not_configured'
  /** 入参不合法(prompt 空、seed 不是数字之类)。 */
  | 'invalid_args'
  /** 被后端限流,且柏宝绘的自动退避重试已用尽。 */
  | 'rate_limited'
  /** 后端报错(网络不通、工作流有问题、API Key 失效……)。 */
  | 'backend_error';

/** 挂了 code 的 Error。用 `'code' in error` 判断,不要 instanceof。 */
export interface PublicError extends Error {
  code: PublicErrorCode;
}

export interface PublicChangeNotice {
  type: 'ready' | 'changed';
  apiVersion: typeof PUBLIC_API_VERSION;
  pluginVersion: string;
  revision: number;
  chatId: string | null;
  capabilities: PublicCapabilities;
}

export type PublicChangeListener = (notice: PublicChangeNotice) => void;

export interface STBaiBaiImageApi {
  /** 本接口数据结构的版本。第三方按它判兼容(当前恒为 1)。 */
  readonly apiVersion: typeof PUBLIC_API_VERSION;
  /** 柏宝绘插件版本(仅供展示/排查,别解析它做兼容判断)。 */
  readonly pluginVersion: string;
  readonly capabilities: PublicCapabilities;
  /** 取柏宝绘已记录的角色列表(含可直接出图的 tag)。返回深拷贝,改它不影响柏宝绘。 */
  getCharacters(options?: GetCharactersOptions): PublicCharacterList;
  /** 出图前先问问:后端配好了吗、支不支持多角色。 */
  getBackendStatus(): PublicBackendStatus;
  /** 调柏宝绘生图。图返回给你,显示在哪由你决定。 */
  generate(request: GenerateRequest, options?: GenerateOptions): Promise<GenerateResult>;
  /** 订阅角色库变更;返回取消订阅的函数。 */
  subscribe(listener: PublicChangeListener): () => void;
}
