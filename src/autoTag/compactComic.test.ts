import {describe,it,expect} from 'vitest';
import {settings} from '@/state/settings';
import {emptyCharFields,type CharTagEntry} from '@/state/charTags';
import {prepareStreamBatch} from './streamBatch';
import {compileComicPage,completeComicPages,parseCompactComic,compactComicSpec,type CompactComicContext} from './compactComic';
const entry=(name='小雪',hair='long black hair'):CharTagEntry=>({name,fields:{...emptyCharFields(),sex:'1girl',hair,eyes:'blue eyes',outfit:'blue coat'},raw:'',nl:'',history:[],desc:'',source:'manual'});
const actor=(extra:Record<string,unknown>={})=>({name:'小雪',action:'holding a map, smiling',face:'front',omit:[],...extra});
const page=(extra:Record<string,unknown>={})=>({id:'M1',rating:'SFW',scene:'station, afternoon',profiles:[],changes:[],shots:[{camera:'medium shot',actors:[actor()]}],...extra});
function context():CompactComicContext{
 const batch=prepareStreamBatch([{id:'a',input:{raw:'',intent:'旅人',prefix:'',text:'小雪走进车站。\n她把头发剪短。\n诺拉走来，说：“出发吧。”',sourceLine:10}}],[],true);
 return {target:batch.target,markers:batch.markerTargets,entries:[entry()],locked:new Set(),nai:{...settings.nai,comicV2:true,comicText:false,comicPanelStyle:'universal',comicGutter:'boxed',comicExtraRules:''},size:'portrait',min:1,max:1};
}
describe('compact comic compilation',()=>{
 it('extracts complete direct pages across arbitrary cuts, escaped quotes and brace-containing strings',()=>{
  const a=page({scene:'station "A" {safe}'}),b=page({id:'M2'}),raw=JSON.stringify({pages:[a,b]});
  const close=raw.indexOf('},{"id":"M2"')+1;
  expect(completeComicPages(raw.slice(0,close))).toEqual([a]);expect(completeComicPages(raw)).toEqual([a,b]);
  for(let i=0;i<raw.length;i++)expect(completeComicPages(raw.slice(0,i)).length).toBeLessThanOrEqual(2);
 });
 it('expands fixed traits per panel without expanding repeated names inside actions',()=>{
  const c=context(),result=compileComicPage(page({shots:[{camera:'medium shot',actors:[actor()]},{camera:'close-up',actors:[actor({action:'小雪 looks at the map'})]}]}),c);
  expect(result.plan.images[0].characters).toHaveLength(2);
  expect(result.plan.images[0].tag).toContain('1girl');expect(result.plan.images[0].tag).not.toContain('2girls');
  expect(result.plan.images[0].characters[1].tag.match(/long black hair/g)).toHaveLength(1);
 });
 it('does not constrain general panel counts and enforces only classic four-panel style',()=>{
  const c=context();expect(compileComicPage(page(),c).plan.images[0].tag).toContain('1 panels');
  c.nai.comicPanelStyle='yonkoma';expect(()=>compileComicPage(page(),c)).toThrow('四格');
  expect(compileComicPage(page({shots:Array.from({length:4},()=>({camera:'medium shot',actors:[actor()]}))}),c).plan.images[0].tag).toContain('4 panels');
 });
 it('uses explicit clothes and visibility rather than restoring library defaults',()=>{
  const result=compileComicPage(page({shots:[{camera:'back view',actors:[actor({face:'back',outfit:'white sweater',action:'walking'})]}]}),context()).plan.images[0].characters[0].tag;
  expect(result).toContain('white sweater');expect(result).not.toContain('blue coat');expect(result).not.toContain('blue eyes');
 });
 it('allows a source-grounded current look while an earlier concurrent update is not yet in the library',()=>{
  const c=context(),result=compileComicPage(page({shots:[{camera:'medium',actors:[actor({look:{hair:'short black hair'}})]}]}),c);
  expect(result.plan.images[0].characters[0].tag).toContain('short black hair');expect(result.plan.changes).toEqual([]);expect(c.entries[0].fields.hair).toBe('long black hair');
  c.locked=new Set(['小雪']);expect(compileComicPage(page({shots:[{camera:'medium',actors:[actor({look:{hair:'short black hair'}})]}]}),c).plan.images[0].characters[0].tag).toContain('long black hair');
 });
 it('supports anonymous people without adding a named profile',()=>{
  const result=compileComicPage(page({shots:[{camera:'wide',actors:[actor({anonymous:true,name:'',fields:{sex:'boy'},action:'walking past the station'})]}]}),context());
  expect(result.plan.changes).toEqual([]);expect(result.plan.images[0].characters[0].tag).toContain('boy');
 });
 it('applies permanent changes only at and after the actor source position, including inside one page',()=>{
  const result=compileComicPage(page({changes:[{name:'小雪',field:'hair',value:'short black hair',position:'P2'}],shots:[
   {camera:'medium shot',actors:[actor({at:'P1'})]},{camera:'medium shot',actors:[actor({at:'P2'})]},
  ]}),context());
  expect(result.plan.images[0].characters[0].tag).toContain('long black hair');expect(result.plan.images[0].characters[1].tag).toContain('short black hair');
  expect(result.plan.changes[0].sourceLine).toBe(11);
 });
 it('keeps locked appearances immutable and never records changes for them',()=>{
  const c=context();c.locked=new Set(['小雪']);
  const result=compileComicPage(page({changes:[{name:'小雪',field:'hair',value:'pink hair',position:'P2'}]}),c);
  expect(result.plan.changes).toEqual([]);expect(result.plan.images[0].characters[0].tag).toContain('long black hair');
 });
 it('builds new profiles once with usable local nl and preserves original names',()=>{
  const result=compileComicPage(page({profiles:[{name:'诺拉',fields:{sex:'girl',hair:'silver hair',eyes:'green eyes'},position:'P3'}],shots:[{camera:'wide shot',actors:[actor({name:'诺拉',outfit:'yellow coat'})]}]}),context());
  expect(result.plan.changes[0]).toMatchObject({name:'诺拉',field:'new',sourceLine:12,nl:expect.stringContaining('silver hair')});
  expect(result.plan.images[0].characters[0].tag).toContain('yellow coat');
 });
 it.each([
  ['unknown marker',()=>page({id:'M99'})],
  ['unknown actor',()=>page({shots:[{camera:'wide',actors:[actor({name:'未知'})]}]})],
  ['duplicate actor',()=>page({shots:[{camera:'wide',actors:[actor(),actor()]}]})],
  ['missing action',()=>page({shots:[{camera:'wide',actors:[actor({action:''})]}]})],
  ['unknown field',()=>page({shots:[{camera:'wide',actors:[actor({omit:['height']})]}]})],
  ['invalid position',()=>page({changes:[{name:'小雪',field:'hair',value:'short hair',position:'P999'}]})],
  ['translated name',()=>page({profiles:[{name:'Nora',fields:{sex:'girl',hair:'silver hair',eyes:'green eyes'},position:'P3'}]})],
 ])('rejects %s before image generation',(_name,make)=>expect(()=>compileComicPage(make(),context())).toThrow());
 it('retains V1 sections and stable character ids while using the same per-panel plan',()=>{
  const c=context();c.nai.comicV2=false;const result=compileComicPage(page(),c).plan.images[0];
  expect(result.tag).toContain('@page\n');expect(result.tag).toContain('@panel P1\n');expect(result.tag).toContain('@character C1 小雪\n');expect(result.characters).toEqual([]);
 });
 it('orders pages by source before carrying wardrobe state and keeps the input snapshot immutable',()=>{
  const c=context();c.markers=undefined;c.min=2;c.max=2;
  const next=page({id:'P2',shots:[{camera:'medium',actors:[actor({outfit:'white sweater'})]}],state:{complete:true,facts:'衣服已换',outfits:{小雪:'white sweater'}}});
  const result=parseCompactComic(JSON.stringify({pages:[next,page({id:'P1'})]}),c);
  expect(result.images.map(i=>i.position)).toEqual(['P1','P2']);
  expect(result.images[0].characters[0].tag).toContain('blue coat');expect(result.images[1].characters[0].tag).toContain('white sweater');expect(c.entries[0].fields.outfit).toBe('blue coat');
 });
 it('includes only selected original dialogue when enabled',()=>{
  const c=context();c.nai.comicText=true;
  expect(compileComicPage(page({shots:[{camera:'medium',actors:[actor({dialogue:'出发吧。'})]}]}),c).plan.images[0].characters[0].tag).toContain('\nText: 出发吧。');
  expect(()=>compileComicPage(page({shots:[{camera:'medium',actors:[actor({dialogue:'新增台词'})]}]}),c)).toThrow('原句');
  c.nai.comicText=false;expect(compileComicPage(page({shots:[{camera:'medium',actors:[actor({dialogue:'新增台词'})]}]}),c).plan.images[0].characters[0].tag).not.toContain('Text:');
 });
 it('carries explicit clothes to a later page without requiring a complete continuity summary',()=>{
  const c=context();c.markers=undefined;c.min=2;c.max=2;
  const result=parseCompactComic(JSON.stringify({pages:[page({id:'P1',shots:[{camera:'medium shot',actors:[actor({outfit:'white sweater'})]}],state:{complete:false}}),page({id:'P2'})]}),c);
  expect(result.images[1].characters[0].tag).toContain('white sweater');
  expect(result.images[1].characters[0].tag).not.toContain('blue coat');
 });
 it('keeps the latest story-time wardrobe when the last panel is an earlier cutaway',()=>{
  const result=compileComicPage(page({shots:[{camera:'medium shot',actors:[actor({at:'P2',outfit:'white sweater'})]},{camera:'medium shot',actors:[actor({at:'P1',outfit:'blue coat'})]}]}),context());
  expect(result.wardrobe).toEqual({小雪:'white sweater'});
 });
 it('compiles minimal fandom identity and keeps explicit costume changes',()=>{
  const c=context();const fan=entry();fan.source='ai';fan.fields.fandom='known_character (work)';fan.fields.hair='';fan.fields.eyes='';c.entries=[fan];
  const result=compileComicPage(page({shots:[{camera:'medium shot',actors:[actor({outfit:'white sweater'})]}]}),c).plan.images[0].characters[0];
  expect(result.tag).toContain('known_character (work)');expect(result.tag).toContain('white sweater');expect(result.tag).not.toContain('blue coat');
 });
 it('places the main panel by the selected layout and reuses the exact same location for its actors',()=>{
  const result=compileComicPage(page({layout:'focus-top',main:2,shots:[{camera:'medium shot',actors:[actor()]},{camera:'medium shot',actors:[actor()]}]}),context()).plan.images[0];
  expect(result.tag).toContain('large main panel at the top');expect(result.characters[0].tag).toContain('large main panel at the top');
  expect(result.characters[1].tag).toContain('lower right');expect(result.tag).not.toContain('large main panel at the bottom');
 });
 it('keeps page-level exclusions distinct from the last actor in legacy sections',()=>{
  const c=context();c.nai.comicV2=false;c.nai.comicAntiPossession=true;
  const result=compileComicPage(page({negative:'unrelated scenery'}),c).plan.images[0];
  expect(result.tag.indexOf('@negative')).toBeLessThan(result.tag.indexOf('@panel'));
 });
 it('validates marker coverage and allows an empty freely selected floor only with lower bound zero',()=>{
  expect(()=>parseCompactComic(JSON.stringify({pages:[page(),page()]}),{...context(),max:2})).toThrow('重复');
  const c=context();c.markers=undefined;c.min=0;expect(parseCompactComic('{"pages":[]}',c)).toEqual({images:[],changes:[]});c.min=1;expect(()=>parseCompactComic('{"pages":[]}',c)).toThrow();
 });
 it('describes program expansion without emitting the old final-output contract',()=>{
  const spec=compactComicSpec(context());expect(spec).toContain('"pages"');expect(spec).toContain('不统一限定2～3格');expect(spec).not.toContain('images每项有position');
 });
});
