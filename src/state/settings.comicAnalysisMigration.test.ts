import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h=vi.hoisted(()=>({context:null as Record<string,any>|null}));
vi.mock('@/st/context',()=>({getContext:()=>h.context}));

beforeEach(()=>{
  vi.resetModules();
  vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

describe('comic analysis mode settings migration',()=>{
  it.each([undefined,null,'invalid',true,{},'standard','simple'])('preserves the selected mode or defaults safely for %j',async(mode)=>{
    const nai={comicAnalysisMode:mode,model:'nai-diffusion-5-full',comicMode:true,comicV2:false,comicText:false,comicPanelStyle:'yonkoma',steps:31};
    h.context={extensionSettings:{baibai_image:{nai}},saveSettingsDebounced:vi.fn()};
    const {settings,hydrateSettings}=await import('./settings');
    await hydrateSettings();
    expect(settings.nai).toMatchObject({...nai,comicAnalysisMode:mode==='simple'?'simple':'standard'});
    expect(h.context!.extensionSettings.baibai_image.nai.comicAnalysisMode).toBe(mode==='simple'?'simple':'standard');
  });
});
