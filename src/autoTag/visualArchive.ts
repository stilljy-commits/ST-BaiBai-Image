import { shallowRef } from 'vue';
import { cleanTargetText, maskStreamStorySource } from './clean';
import { getContext, isAiStoryMessage, type STMessage } from '@/st/context';
import { applyMessageText } from '@/st/messageEdit';

export const VISUAL_EXTRA = 'bbiVisualArchive';
export const VISUAL_LOOK_FIELDS = ['hair', 'eyes', 'skin', 'body', 'extra', 'makeup'] as const;
export type VisualLookField = typeof VISUAL_LOOK_FIELDS[number];
export type VisualFields = Partial<Record<VisualLookField | 'outfit', string | null>>;
export type VisualChanges = Record<string, VisualFields>;
export interface VisualPoint { end: number; hash: string; changes: VisualChanges; facts: string }
interface VisualBranch { basis: string; points: VisualPoint[]; manual?: { hash: string; end: number; changes: VisualChanges } }
interface VisualReceipt { v: 1; branches: Record<string, VisualBranch> }

const EMPTY_BASIS = 'start';
const EXTRA_TAGS = ['bbi_image', 'summary', 'action', 'UpdateVariable', 'JSONPatch', 'Analysis', 'statusplaceholder', 'CONTEXT_options', 'CONTEXT_conception', 'thought'];
export const visualArchiveRevision = shallowRef(0);
const prepared = new WeakMap<STMessage, { source: string; key: string; text: string; hash: string }>();

export function visualStory(text: string, stripTags: string[]): string {
  const tags = [...new Set([...stripTags, ...EXTRA_TAGS])];
  return cleanTargetText(maskStreamStorySource(text, tags), tags);
}

function signature(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}.${(hash >>> 0).toString(36)}`;
}

function preparedStory(message: STMessage, tags: string[], key: string) {
  const previous = prepared.get(message);
  if (previous?.source === message.mes && previous.key === key) return previous;
  const text = visualStory(message.mes, tags);
  const value = { source: message.mes, key, text, hash: signature(text) };
  prepared.set(message, value);
  return value;
}

function activeSwipe(message: STMessage): number | null {
  return Array.isArray(message.swipes) ? message.swipe_id ?? 0 : null;
}

function receipt(extra: STMessage['extra']): VisualReceipt | undefined {
  const value = extra?.[VISUAL_EXTRA] as VisualReceipt | undefined;
  return value?.v === 1 && value.branches && typeof value.branches === 'object' ? value : undefined;
}

function branchOf(message: STMessage): VisualBranch | undefined {
  const swipe = activeSwipe(message);
  return receipt(message.extra)?.branches[String(swipe ?? 0)] ??
    (swipe === null ? undefined : receipt(message.swipe_info?.[swipe]?.extra)?.branches[String(swipe)]);
}

export function mergeVisualChanges(...sources: (VisualChanges | undefined)[]): VisualChanges {
  const merged = Object.create(null) as VisualChanges;
  for (const source of sources) for (const [name, fields] of Object.entries(source ?? {})) {
    merged[name] = { ...merged[name], ...fields };
  }
  return merged;
}

export function visualPoint(source: string, changes: VisualChanges, facts: string): VisualPoint {
  return { end: source.length, hash: signature(source), changes, facts };
}

/** Replay checked paragraphs and preserve every unchecked gap since tracking began. */
export function readVisualArchive(chat: STMessage[], before: number, tags: string[], through?: number) {
  let basis = EMPTY_BASIS;
  let changes: VisualChanges = {};
  let facts = '';
  let pending: string[] = [];
  let legacy = '';
  let tracked = false;
  const currentPoints: VisualPoint[] = [];
  const sources: Record<string, number> = Object.create(null);
  const key = JSON.stringify([...new Set([...tags, ...EXTRA_TAGS])].sort());
  for (let floor = 0; floor < chat.length && (floor < before || floor === before && through !== undefined); floor++) {
    const message = chat[floor];
    if (!isAiStoryMessage(message)) continue;
    const { text, hash } = preparedStory(message, tags, key);
    if (!text) continue;
    const branch = branchOf(message);
    const limit = floor === before ? Math.min(text.length, through!) : text.length;
    const points = branch?.basis === basis && Array.isArray(branch.points) ? branch.points : [];
    const manual = branch?.manual;
    if (!tracked && (branch || receipt(message.extra) || message.swipe_info?.some(info => receipt(info.extra)))) {
      tracked = true;
      if (legacy) pending.push(legacy);
    }
    let end = 0;
    for (const point of points) {
      if (!point || !Number.isInteger(point.end) || point.end > limit) break;
      if (point.end <= end || point.hash !== signature(text.slice(0, point.end)) ||
          !point.changes || typeof point.changes !== 'object') break;
      changes = mergeVisualChanges(changes, point.changes);
      for (const name of Object.keys(point.changes)) sources[name] = floor;
      facts = point.facts || facts;
      end = point.end;
      if (floor === before) currentPoints.push(point);
    }
    if (manual && manual.end <= limit && manual.hash === signature(text.slice(0, manual.end))) {
      changes = mergeVisualChanges(changes, manual.changes);
      for (const name of Object.keys(manual.changes)) sources[name] = floor;
    }
    if (tracked) {
      if (end) pending = [];
      const tail = text.slice(end, limit).trim();
      if (tail) pending.push(tail);
    } else legacy = text.slice(0, limit);
    if (floor < before) basis = signature(`${basis}|${activeSwipe(message) ?? 0}|${hash}`);
  }
  return { basis, changes, facts, pending: tracked ? pending.join('\n\n') : legacy, sources, points: currentPoints };
}

export function visualArchiveNote(archive: { pending: string; facts: string }): string {
  return [archive.facts && `【已确认的前情】${archive.facts}`,
    archive.pending && `【尚未记录的较早正文，仅用于续接，无需为其选图】\n${archive.pending}`].filter(Boolean).join('\n');
}

/** Verify the final prose still owns the analyzed prefix before persisting. */
export async function saveVisualArchive(
  floor: number, chatId: string, message: STMessage, swipe: number | null, tags: string[], basis: string,
  points: VisualPoint[], manual?: VisualChanges,
): Promise<boolean> {
  const context = getContext();
  const live = context?.chat[floor];
  if (!context || !live) return false;
  const key = String(swipe ?? 0);
  const text = visualStory(live.mes, tags);
  if (!text || readVisualArchive(context.chat, floor, tags).basis !== basis) return false;
  if (points.some(point => point.end > text.length || point.hash !== signature(text.slice(0, point.end)))) return false;
  const existing = branchOf(live);
  const previous = existing?.basis === basis && Array.isArray(existing.points) ? existing.points
    .filter(point => point && point.end <= text.length && point.hash === signature(text.slice(0, point.end))) : [];
  const retained = (points.at(-1)?.end ?? 0) >= (previous.at(-1)?.end ?? 0) ? points : previous;
  const currentManual = manual ? { end: text.length, hash: signature(text), changes: mergeVisualChanges(existing?.manual?.changes, manual) } : existing?.manual;
  const next: VisualReceipt = { v: 1, branches: { ...(receipt(live.extra)?.branches ?? {}),
    [key]: { basis, points: retained, ...(currentManual ? { manual: currentManual } : {}) } } };
  // A streaming reanalysis can race with a later floor. Only the captured floor and swipe own this update.
  const result = await applyMessageText(floor, raw => visualStory(raw, tags) === text ? raw : null,
    chatId, swipe, message, { key: VISUAL_EXTRA, value: next });
  if (result === 'saved') visualArchiveRevision.value++;
  return result === 'saved';
}
