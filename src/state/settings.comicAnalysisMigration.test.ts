import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h=vi.hoisted(()=>({context:null as Record<string,any>|null}));
vi.mock('@/st/context',()=>({getContext:()=>h.context}));

beforeEach(()=>{
  vi.resetModules();
  vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

describe('comic analysis mode settings migration',()=>{
  it('preserves valid per-model choices, ignores retired worldbook sync and defaults to follow',async()=>{
    h.context={extensionSettings:{baibai_image:{nai:{comicReasoningByModel:{a:'off',b:'low',bad:'max'}},autoTag:{streamWorldBook:'旧配图规则',minImages:3,maxImages:5}}},saveSettingsDebounced:vi.fn()};
    const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
    expect(settings.nai.comicReasoningByModel).toEqual({a:'off',b:'low'});expect(settings.autoTag).not.toHaveProperty('streamWorldBook');
    expect(settings.autoTag).toMatchObject({minImages:3,maxImages:5});
  });
  it.each([undefined,null,'invalid',true,{},'standard','simple','fast'])('preserves the selected mode or defaults safely for %j',async(mode)=>{
    const nai={comicAnalysisMode:mode,model:'nai-diffusion-5-full',comicMode:true,comicV2:false,comicText:false,comicPanelStyle:'yonkoma',steps:31};
    h.context={extensionSettings:{baibai_image:{nai}},saveSettingsDebounced:vi.fn()};
    const {settings,hydrateSettings}=await import('./settings');
    await hydrateSettings();
    const expected=mode==='fast'?'fast':mode==='simple'?'simple':'standard';
    expect(settings.nai).toMatchObject({...nai,comicAnalysisMode:expected});
    expect(h.context!.extensionSettings.baibai_image.nai.comicAnalysisMode).toBe(expected);
  });
});
