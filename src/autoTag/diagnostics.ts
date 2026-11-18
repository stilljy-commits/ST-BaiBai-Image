import { PLUGIN_VERSION } from '@/version';

const events: Array<{ at: number; event: string; detail: Record<string, string | number | boolean> }> = [];
const fields = new Set(['source','reason','phase','chars','at','prepareMs','apiMs','queueMs','attempt','ok','hidden','processorFinished','hasProcessor','claimed','route']);

/** Only timing and state, never request options, credentials, names or story text. */
export function recordStreamDiagnostic(event: string, value: unknown): void {
  if (!event.startsWith('stream:') && event !== 'GENERATION_STARTED' && event !== 'GENERATION_ENDED') return;
  const detail: Record<string, string | number | boolean> = {};
  if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (fields.has(key) && (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) detail[key] = typeof item === 'string' ? item.slice(0,160) : item;
  }
  events.push({ at: Date.now(), event, detail });
  if (events.length > 200) events.splice(0, events.length - 200);
}

export function streamDiagnosticReport(): string {
  return JSON.stringify({ version: PLUGIN_VERSION, platform: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown', events }, null, 2);
}
