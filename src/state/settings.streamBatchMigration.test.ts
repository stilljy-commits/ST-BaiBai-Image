import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
beforeEach(()=>{vi.resetModules();vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});});
afterEach(()=>vi.unstubAllGlobals());
describe('stream batch size migration',()=>{
 it.each([[undefined,3],[null,3],['5',3],[0,1],[-5,1],[2.8,2],[5,5],[50,50],[999,50]])('normalizes persisted value %s to %s without changing concurrency',async(value,expected)=>{
  h.ctx={extensionSettings:{baibai_image:{autoTag:{streamAnalysisBatchSize:value,streamAnalysisConcurrency:2,minImages:5,maxImages:21}}},saveSettingsDebounced:vi.fn()};
  const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
  expect(settings.autoTag).toMatchObject({streamAnalysisBatchSize:expected,streamAnalysisConcurrency:2,minImages:5,maxImages:21});
 });
});
