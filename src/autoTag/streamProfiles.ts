import type { CharChange, ImagePlan } from '@/autoTag/protocol';

function fields(change: CharChange): Record<string, string> | null {
  try { const value = JSON.parse(change.value); return value && typeof value === 'object' ? value : null; } catch { return null; }
}
/** The first successful introduction wins; later parallel requests reuse that appearance. */
export function mergeStreamProfiles(plan: ImagePlan, established: Map<string, CharChange>): ImagePlan {
  for (let i = 0; i < plan.changes.length; i++) {
    const change = plan.changes[i]; if (change.field !== 'new') continue;
    const previous = established.get(change.name);
    if (!previous) { established.set(change.name, { ...change }); continue; }
    const oldFields = fields(change), newFields = fields(previous);
    if (oldFields && newFields) for (const image of plan.images) for (const character of image.characters) {
      if (character.name !== change.name) continue;
      for (const key of ['fandom', 'sex', 'hair', 'eyes', 'face', 'body']) {
        const old = oldFields[key], value = newFields[key]; if (!old || !value || old === value) continue;
        const normalize = (text: string) => key === 'sex' ? text.replace(/\b1(girl|boy|other)\b/g,'$1') : text;
        character.tag = character.tag.replaceAll(normalize(old), normalize(value));
      }
    }
    plan.changes[i] = { ...change, value: previous.value, nl: previous.nl };
  }
  return plan;
}
