import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
beforeEach(()=>{vi.resetModules();vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});});
afterEach(()=>vi.unstubAllGlobals());
describe('live inline display migration',()=>{
 it.each([[undefined,false],[null,false],['true',false],[0,false],[false,false],[true,true]])('preserves an explicit boolean %s and otherwise defaults off',async(value,expected)=>{
  h.ctx={extensionSettings:{baibai_image:{autoTag:{streamInlinePreview:value,streamGen:true,streamPreview:true,streamAnalysisBatchSize:5,streamAnalysisConcurrency:2}}},saveSettingsDebounced:vi.fn()};
  const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
  expect(settings.autoTag).toMatchObject({streamInlinePreview:expected,streamGen:true,streamPreview:true,streamAnalysisBatchSize:5,streamAnalysisConcurrency:2});
 });
});
