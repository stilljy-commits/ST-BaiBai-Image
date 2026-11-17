import { shallowRef } from 'vue';
import { cleanTargetText, maskStreamStorySource } from './clean';
import { getContext, isAiStoryMessage, type STMessage } from '@/st/context';
import { applyMessageText } from '@/st/messageEdit';

export const VISUAL_EXTRA = 'bbiVisualArchive';
export const VISUAL_LOOK_FIELDS = ['hair', 'eyes', 'skin', 'body', 'extra', 'makeup'] as const;
export type VisualLookField = typeof VISUAL_LOOK_FIELDS[number];
export type VisualFields = Partial<Record<VisualLookField | 'outfit', string | null>>;
export type VisualChanges = Record<string, VisualFields>;
export const VISUAL_FIELDS = ['outfit', ...VISUAL_LOOK_FIELDS] as const;
export interface VisualState { facts: string; changes: VisualChanges; complete?: false }

export function resolveVisualValue(field: keyof VisualFields, current?: VisualFields, fixed?: VisualFields): string {
  return current?.[field] ?? fixed?.[field] ?? '';
}

/** Archive metadata is optional. Incomplete metadata must never invalidate an image. */
export function parseVisualState(value: unknown): VisualState | undefined {
  if (!value || typeof value !== 'object') return;
  const state = value as Record<string, unknown>;
  if (!state.changes || typeof state.changes !== 'object' || Array.isArray(state.changes)) return;
  const changes = Object.create(null) as VisualChanges;
  let valid = true;
  for (const [name, look] of Object.entries(state.changes)) {
    if (!name || !look || typeof look !== 'object' || Array.isArray(look)) { valid = false; continue; }
    const fields: VisualFields = {};
    for (const [key, value] of Object.entries(look)) {
      if (!VISUAL_FIELDS.some(field => field === key) || (value !== null && typeof value !== 'string')) { valid = false; continue; }
      fields[key as keyof VisualFields] = value === null ? null : value.trim();
    }
    if (Object.keys(fields).length) changes[name] = fields;
  }
  const facts = typeof state.facts === 'string' ? state.facts.trim() : '';
  if (valid && state.complete === true && facts) return { facts, changes };
  if (Object.keys(changes).length) return { facts: '', changes, complete: false };
}

export function archivedOutfits(changes?: VisualChanges): Record<string, string> {
  return Object.fromEntries(Object.entries(changes ?? {}).flatMap(([name, fields]) =>
    typeof fields.outfit === 'string' ? [[name, fields.outfit]] : []));
}
export interface VisualPoint extends VisualState { end: number; hash: string }
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

export function visualPoint(source: string, changes: VisualChanges, facts: string, complete = true): VisualPoint {
  return { end: source.length, hash: signature(source), changes, facts, ...(complete ? {} : { complete: false }) };
}

/** A sparse image list can still update looks without consuming unchecked prose. */
export function visualPointsForImages(
  source: string, tags: string[], images: readonly { sourceLine: number; visualState?: VisualState }[], covered = true,
): VisualPoint[] {
  const lines = source.split(/\r\n|\r|\n/);
  const points = new Map<number, VisualPoint>();
  for (const image of [...images].sort((a, b) => a.sourceLine - b.sourceLine)) {
    const state = image.visualState;
    covered &&= !!state && state.complete !== false;
    if (!state) continue;
    const prefix = visualStory(lines.slice(0, image.sourceLine + 1).join('\n'), tags);
    if (!prefix) continue;
    const previous = points.get(prefix.length);
    points.set(prefix.length, visualPoint(prefix, mergeVisualChanges(previous?.changes, state.changes), state.facts, covered));
  }
  return [...points.values()];
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
    let end = 0, coveredEnd = 0;
    for (const point of points) {
      if (!point || !Number.isInteger(point.end) || point.end > limit) break;
      if (point.end <= end || point.hash !== signature(text.slice(0, point.end)) ||
          !point.changes || typeof point.changes !== 'object') break;
      changes = mergeVisualChanges(changes, point.changes);
      for (const name of Object.keys(point.changes)) sources[name] = floor;
      if (point.complete !== false) {
        facts = point.facts || facts;
        coveredEnd = point.end;
      }
      end = point.end;
      if (floor === before) currentPoints.push(point);
    }
    if (manual && manual.end <= limit && manual.hash === signature(text.slice(0, manual.end))) {
      changes = mergeVisualChanges(changes, manual.changes);
      for (const name of Object.keys(manual.changes)) sources[name] = floor;
    }
    if (tracked) {
      if (coveredEnd) pending = [];
      const tail = text.slice(coveredEnd, limit).trim();
      if (tail) pending.push(tail);
    } else legacy = text.slice(0, limit);
    if (floor < before) basis = signature(`${basis}|${activeSwipe(message) ?? 0}|${hash}`);
  }
  return { basis, changes, facts, pending: tracked ? pending.join('\n\n') : legacy, sources, points: currentPoints };
}

export function visualArchiveNote(archive: { pending: string; facts: string; changes: VisualChanges }): string {
  return [archive.facts && `【已确认的前情】${archive.facts}`,
    Object.keys(archive.changes).length && `【当前造型】${JSON.stringify(archive.changes)}。本段正文明确的造型变化优先，其次沿用当前造型，最后用固定档案。null 表示恢复对应固定值。`,
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
  const retained = new Map(previous.map(point => [point.end, point]));
  for (const point of points) {
    const prior = retained.get(point.end);
    retained.set(point.end, prior && point.complete === false
      ? { ...prior, changes: mergeVisualChanges(prior.changes, point.changes) }
      : point);
  }
  const currentManual = manual ? { end: text.length, hash: signature(text), changes: mergeVisualChanges(existing?.manual?.changes, manual) } : existing?.manual;
  const next: VisualReceipt = { v: 1, branches: { ...(receipt(live.extra)?.branches ?? {}),
    [key]: { basis, points: [...retained.values()].sort((a, b) => a.end - b.end), ...(currentManual ? { manual: currentManual } : {}) } } };
  // A streaming reanalysis can race with a later floor. Only the captured floor and swipe own this update.
  const result = await applyMessageText(floor, raw => visualStory(raw, tags) === text ? raw : null,
    chatId, swipe, message, { key: VISUAL_EXTRA, value: next });
  if (result === 'saved') visualArchiveRevision.value++;
  return result === 'saved';
}
