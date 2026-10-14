import type { NaiSettings, BackendId } from '@/state/settings';

/** Persist only prompt interpretation, never connections or API keys. */
export interface RenderProfile {
  mode: 'illustration' | 'comic-v1' | 'comic-v2';
  text: boolean;
}

export function captureRenderProfile(nai: NaiSettings, backend: BackendId = 'nai'): RenderProfile {
  return {
    mode: backend === 'nai' && nai.comicMode && nai.model.includes('nai-diffusion-5')
      ? (nai.comicV2 ? 'comic-v2' : 'comic-v1') : 'illustration',
    text: nai.comicText !== false,
  };
}

export function parseRenderProfile(value: unknown): RenderProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  if (!['illustration', 'comic-v1', 'comic-v2'].includes(String(o.mode))) return undefined;
  return { mode: o.mode as RenderProfile['mode'], text: o.text !== false };
}

export function inferRenderProfile(tag: string): RenderProfile {
  return {
    mode: /^\s*<image>|^\s*@page\b/i.test(tag) ? 'comic-v1'
      : /\bcomic(?:\s+page)?\b/i.test(tag) && /\b\d+\s+panels\b/i.test(tag) ? 'comic-v2' : 'illustration',
    text: /(?:\bText:|\b(?:chinese|japanese|english) text\b)/i.test(tag),
  };
}

export function applyRenderProfile(nai: NaiSettings, profile: RenderProfile): NaiSettings {
  return { ...nai, comicMode: profile.mode !== 'illustration', comicV2: profile.mode === 'comic-v2', comicText: profile.text };
}
