/**
 * 流式出图的正文标记([img: 意图])——扫描、切段、替换的纯函数集。
 *
 * 标记由主模型按 markerInjection 注入的规则写在正文里,语法:
 *   [img: 中文画面意图短句]
 * 约束:单行、不含方括号、闭合 ] 才算完整——流式期间半截标记天然不匹配,
 * 这是「流式扫描不误派发」的成立前提(与 AOdraw 的 scanner 同一原则)。
 *
 * 本文件刻意不引任何 DOM / SillyTavern / 设置依赖,可在 node 下直接单测。
 */
import { MARKER_REGEX_SOURCE } from '@/autoTag/markerSyntax';
import { maskStreamStorySource } from '@/autoTag/clean';

export interface StreamMarker {
  /** 标记在全文中的起始下标。 */
  index: number;
  /** 标记原文,如 `[img: 深蹲特写,大叔揉臀]`。 */
  raw: string;
  /** 括号里的意图短句(已 trim)。 */
  intent: string;
  /** 标记结束位置(排他)。 */
  end: number;
}

const MARKER_REGEX = new RegExp(MARKER_REGEX_SOURCE, 'g');

/** 找出全文里所有完整标记,按出现顺序返回。 */
export function findMarkers(text: string, stripTags: string[] = []): StreamMarker[] {
  const source = String(text ?? '');
  if (!source) return [];
  return scanVisibleMarkers(source,maskStreamStorySource(source,stripTags));
}
function scanVisibleMarkers(source: string, visible: string): StreamMarker[] {
  const markers: StreamMarker[] = [];
  MARKER_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_REGEX.exec(visible)) !== null) {
    if (m[0].length === 0) {
      MARKER_REGEX.lastIndex++;
      continue;
    }
    if(source.slice(m.index,m.index+m[0].length)!==m[0])continue;
    markers.push({
      index: m.index,
      raw: m[0],
      intent: (m[1] ?? '').trim(),
      end: m.index + m[0].length,
    });
  }
  return markers;
}

/**
 * 流式累积全文扫描器:喂入累积文本,返回**这一次新出现**的完整标记。
 *
 * 为什么全量重扫也不会重复派发(与 AOdraw StreamScanner 同构):
 * 1. 正则要求闭合 ],半截标记不匹配;
 * 2. 流式文本前缀不可变,已见过的标记每轮都在同一 index 以同一原文重现,
 *    `seen` 按 `${index} ${raw}` 精确去重;
 * 3. 扫描全程同步(`[^\[\]\n]` 线性,无回溯),不卡 ST 的流式循环。
 *
 * 标记数会超过 maxImages 的场景由调用方在派发层做预算闸,
 * 扫描器本身只负责发现,不负责取舍。
 */
export class MarkerScanner {
  private readonly seen = new Set<string>();

  /** 喂入一次 STREAM_TOKEN_RECEIVED 给的累积全文(不是增量)。 */
  feed(cumulativeText: string, stripTags: string[] = []): StreamMarker[] {
    return this.take(findMarkers(cumulativeText,stripTags));
  }

  /** Reuse the segment scan from the same token event instead of masking the whole story again. */
  take(all: StreamMarker[]): StreamMarker[] {
    const fresh: StreamMarker[] = [];
    for (const marker of all) {
      const key = `${marker.index} ${marker.raw}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      fresh.push(marker);
    }
    return fresh;
  }

  /** 新一轮生成开始时调用。 */
  reset(): void {
    this.seen.clear();
  }
}

/** 剥掉全文里的标记(终局清理未派发标记 / 历史正文进分析上下文前的清洗)。 */
export function stripMarkers(text: string): string {
  const source = String(text ?? '');
  if (!source) return source;
  return source.replace(new RegExp(MARKER_REGEX_SOURCE, 'g'), '');
}

/**
 * 把第 i 个标记替换成 replacements[i];replacements[i] 为 null/undefined 时删除该标记。
 * 长度不齐时,多余的标记一律删除(不留裸文本)。
 */
export function replaceMarkers(text: string, replacements: Array<string | null | undefined>, stripTags: string[] = []): string {
  const markers = findMarkers(text,stripTags);
  if (!markers.length) return text;
  let out = '';
  let cursor = 0;
  markers.forEach((marker, i) => {
    out += text.slice(cursor, marker.index);
    const replacement = replacements[i];
    if (replacement) out += replacement;
    cursor = marker.end;
  });
  out += text.slice(cursor);
  return out;
}

/**
 * 切出每个标记的"目标正文段":上一个标记结束(或全文开头)到本标记开始之间的文本,
 * 外加标记本身。段与标记一一对应,顺序一致——主模型已经替我们把叙事节拍切好了。
 */
export function markerSegments(text: string, stripTags: string[] = []): Array<{ marker: StreamMarker; segment: string; sourceLine: number }> {
  const visible=maskStreamStorySource(text,stripTags);
  const markers = scanVisibleMarkers(text,visible);
  const out: Array<{ marker: StreamMarker; segment: string; sourceLine: number }> = [];
  let prevEnd = 0;
  for (const marker of markers) {
    const raw=visible.slice(prevEnd,marker.index),leading=raw.match(/^\s*/)?.[0].length??0;
    const sourceLine=(text.slice(0,prevEnd+leading).match(/\r\n|\r|\n/g)||[]).length;
    out.push({ marker, segment: raw.replace(/[^\S\r\n]+$/gm,'').trim(), sourceLine });
    prevEnd = marker.end;
  }
  return out;
}

/**
 * 第 index 个标记之前的正文前缀(账本源):流式期间主模型已写出的正文事实,
 * 分段分析靠它延续服装/在场/道具状态。截尾到 maxChars(保留靠后的部分,
 * 因为越靠近本标记的正文对画面状态影响越大)。
 */
export function prefixBefore(text: string, markerIndex: number, maxChars: number, stripTags: string[] = []): string {
  const visible=maskStreamStorySource(text,stripTags);
  const markers = scanVisibleMarkers(text,visible);
  const marker = markers[markerIndex];
  if (!marker) return '';
  const prefix = visible.slice(0, marker.index).replace(/[^\S\r\n]+$/gm,'').trimStart();
  if (prefix.length <= maxChars) return prefix;
  const cut = prefix.slice(prefix.length - maxChars);
  // 从第一个换行切起,避免半截句
  const nl = cut.indexOf('\n');
  return nl >= 0 ? cut.slice(nl + 1) : cut;
}

/** The target is already provided in full with position IDs; remove only its exact repeated suffix. */
export function contextWithoutRepeatedTarget(prefix: string, target: string): string {
  const body = target.trim(), before = prefix.trimEnd();
  if (!body || !before) return prefix;
  if (before.endsWith(body)) return before.slice(0, before.length - body.length).trimEnd();
  // A long target may occupy the entire retained prefix window. Its full text remains in target.
  if (body.endsWith(before.trimStart())) return '';
  return prefix; // Ambiguous overlap keeps the original facts rather than deleting any of them.
}
