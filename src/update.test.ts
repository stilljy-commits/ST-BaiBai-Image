import { describe, expect, it, vi } from 'vitest';
import { checkForUpdate, isNewer, normalizeReleaseNotes, updateState } from './update';

describe('isNewer', () => {
  it('compares numeric version segments', () => {
    expect(isNewer('0.1.3', '0.1.2')).toBe(true);
    expect(isNewer('0.1', '0.1.0')).toBe(false);
    expect(isNewer('1.0.0', '1.0.1')).toBe(false);
  });
});

it('accepts plain release note lines and tolerates older manifests without them',()=>{
  expect(normalizeReleaseNotes(undefined)).toEqual([]);
  expect(normalizeReleaseNotes([' 修复保存 ',null,{text:'not text'},''])).toEqual(['修复保存']);
  expect(normalizeReleaseNotes(Array(30).fill('x'))).toHaveLength(20);
});

it('associates fetched notes with the advertised version and clears stale notes for older manifests',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({version:'9.0.0',release_notes:['修复造型保存']})))
    .mockResolvedValueOnce(new Response(JSON.stringify({version:'9.0.1'})));
  vi.stubGlobal('fetch',fetch);
  try {
    await checkForUpdate(true);expect(updateState).toMatchObject({latest:'9.0.0',available:true,latestNotes:['修复造型保存']});
    await checkForUpdate(true);expect(updateState.latestNotes).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});
