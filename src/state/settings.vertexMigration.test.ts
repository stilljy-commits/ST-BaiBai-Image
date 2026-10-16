import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const h=vi.hoisted(()=>({ctx:null as any}));
vi.mock('@/st/context',()=>({getContext:()=>h.ctx}));
beforeEach(()=>{vi.resetModules();vi.stubGlobal('window',{addEventListener:vi.fn(),dispatchEvent:vi.fn()});});
afterEach(()=>vi.unstubAllGlobals());
describe('Vertex channel storage compatibility',()=>{
 it.each(['full','express'] as const)('preserves %s routing and credential selectors through hydration',async(vertexAuthMode)=>{
  const ch={id:'vertex-test',name:'Vertex',provider:'vertexai',vertexAuthMode,vertexRegion:' global ',vertexSecretId:' saved-id ',url:'',key:'',model:'gemini-test'};
  h.ctx={extensionSettings:{baibai_image:{channels:[ch]}},saveSettingsDebounced:vi.fn()};
  const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
  expect(settings.channels[0]).toMatchObject({...ch,vertexRegion:'global',vertexSecretId:'saved-id'});
  expect(h.ctx.extensionSettings.baibai_api_channels.channels[0]).toMatchObject({provider:'vertexai',vertexAuthMode,vertexSecretId:'saved-id'});
 });
 it('does not add provider fields to legacy OpenAI channels',async()=>{
  h.ctx={extensionSettings:{baibai_image:{channels:[{id:'legacy',name:'old',url:'https://example.test/v1',model:'model'}]}},saveSettingsDebounced:vi.fn()};
  const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
  expect(settings.channels[0]).not.toHaveProperty('provider');expect(settings.channels[0].url).toBe('https://example.test/v1');
 });
 it('keeps Vertex routing when an older sibling plugin drops provider fields from the shared list',async()=>{
  const own={id:'vertex-test',name:'Vertex',provider:'vertexai',vertexAuthMode:'express',vertexRegion:'global',vertexSecretId:'saved',url:'',key:'',model:'gemini-test'};
  const shared={id:'vertex-test',name:'Renamed',url:'',key:'',model:'gemini-other'};
  h.ctx={extensionSettings:{baibai_image:{channels:[own]},baibai_api_channels:{schemaVersion:1,revision:2,channels:[shared]}},saveSettingsDebounced:vi.fn()};
  const {settings,hydrateSettings}=await import('./settings');await hydrateSettings();
  expect(settings.channels[0]).toMatchObject({...shared,provider:'vertexai',vertexAuthMode:'express',vertexSecretId:'saved'});
 });
});
