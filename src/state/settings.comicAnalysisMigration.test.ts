import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h=vi.hoisted(()=>({context:null as Record<string,any>|null}));
vi.mock('@/st/context',()=>({getContext:()=>h.context}));

beforeEach(()=>{
  vi.resetModules();
  vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

describe('comic analysis mode settings migration',()=>{
  it.each([true,false])('migrates legacy extra rules and keeps the engineering switch at %s',async(enabled)=>{
    const original='旧作品要求\n保留蓝色围巾。';
    h.context={extensionSettings:{baibai_image:{nai:{comicExtraRules:original,comicNsfwRules:enabled}}},saveSettingsDebounced:vi.fn()};
    const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
    expect(settings.nai.comicNsfwRules).toBe(enabled);
    expect(settings.nai.comicExtraRules).toBe(original);
    expect(settings.nai.comicExtraRuleTabs?.map(tab=>tab.rules)).toEqual([original,'','','','']);
    expect(settings.nai.activeComicExtraRuleTab).toBe(0);
    expect(h.context!.extensionSettings.baibai_image.nai.comicExtraRuleTabs).toEqual(settings.nai.comicExtraRuleTabs);
  });
  it('restores the selected saved group and preserves all other groups',async()=>{
    const tabs=Array.from({length:5},(_,i)=>({name:`作品${i+1}`,rules:`独立要求${i+1}`}));
    h.context={extensionSettings:{baibai_image:{nai:{comicExtraRules:'旧镜像',comicExtraRuleTabs:tabs,activeComicExtraRuleTab:3}}},saveSettingsDebounced:vi.fn()};
    const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
    expect(settings.nai.comicExtraRules).toBe('独立要求4');
    expect(settings.nai.activeComicExtraRuleTab).toBe(3);
    expect(settings.nai.comicExtraRuleTabs).toEqual(tabs);
  });
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
