import {describe,it,expect} from 'vitest';
import {finalizeComicCharacters,ComicWardrobeLedger} from './characters';
import {finalizeComicPlan} from './plan';
import {comicCosplayPrefix,type ComicCostumes} from './costume';
import {parseComicSections,writeComicSections} from './sections';
import {parseImagePlan,type ImageCharacterPrompt} from '@/autoTag/protocol';
const cosplay={character:'Hero',work:'Example Work',costume:'Festival'};
const actor=(extra:Partial<ImageCharacterPrompt>={}):ImageCharacterPrompt=>({name:'甲',tag:'girl, black hair, medium shot',nl:'',panel:'This single panel fills the page.',...extra});
const page=(line:number,characters:ImageCharacterPrompt[])=>({position:'P'+(line+1),sourceLine:line,tag:'SFW, 2girls, comic, This single panel fills the page. Medium shot.',characters,nl:'',negative:'',size:'portrait' as const});
describe('independent temporary cosplay continuity',()=>{
 it('keeps source and costume version when a later page abbreviates the same clothes',()=>{
  const outfits:Record<string,string>={},costumes:ComicCostumes={};
  finalizeComicCharacters([actor({outfit:'white jacket, blue trousers',cosplay})],{outfits,costumes});
  const [next]=finalizeComicCharacters([actor({outfit:'white jacket'})],{outfits,costumes});
  expect(next.tag).toContain("Hero's Festival outfit from Example Work.");expect(outfits.甲).toContain('Hero');expect(costumes.甲).toContain('Festival');
 });
 it('inherits a labelled source from older stored outfit text without inventing one',()=>{
  const outfits={甲:"cosplay, She is wearing Hero's Festival costume from Example Work., white jacket"};
  expect(finalizeComicCharacters([actor({outfit:'white jacket'})],{outfits})[0].tag).toContain("Hero's Festival costume from Example Work");
  expect(comicCosplayPrefix('white jacket, blue trousers')).toBeUndefined();
 });
 it('does not drop a known work/version when repeated metadata gives only the same target name',()=>{
  const costumes:ComicCostumes={};
  finalizeComicCharacters([actor({outfit:'white jacket',cosplay})],{costumes});
  const [same]=finalizeComicCharacters([actor({outfit:'white jacket',cosplay:{character:'Hero'}})],{costumes});
  expect(same.tag).toContain("Hero's Festival outfit from Example Work.");
  const [different]=finalizeComicCharacters([actor({outfit:'blue jacket',cosplay:{character:'Hero',work:'Other Work'}})],{costumes});
  expect(different.tag).toContain("Hero's outfit from Other Work.");expect(different.tag).not.toContain('Festival');
 });
 it('keeps the wearer identity first and leaves dialogue verbatim',()=>{
  const costumes={甲:"cosplay, wearing Hero's outfit from Example Work."};
  const [result]=finalizeComicCharacters([actor({tag:'girl, original_identity (own work), white jacket\nText: 你好，先别动。'})],{costumes});
  expect(result.tag.indexOf('girl, original_identity (own work),')).toBeLessThan(result.tag.indexOf('cosplay'));expect(result.tag.endsWith('\nText: 你好，先别动。')).toBe(true);
  expect(result.tag.match(/wearing Hero/g)).toHaveLength(1);
 });
 it('does not let a later costume change leak into an earlier appearance in the same page',()=>{
  const costumes={甲:"cosplay, wearing Hero's outfit from Example Work."};
  const result=finalizeComicCharacters([actor({outfit:'white jacket'}),actor({outfit:'blue coat',cosplay:{character:'Other',work:'Second Work'}})],{costumes});
  expect(result[0].tag).toContain("Hero's outfit");expect(result[0].tag).not.toContain('Other');expect(result[1].tag).toContain("Other's outfit");expect(result[1].tag).not.toContain('Hero');
 });
 it('supports explicit ending, including a same-page crop, without reviving the old source',()=>{
  const costumes={甲:"cosplay, wearing Hero's outfit from Example Work."},outfits={甲:'white jacket'};
  const result=finalizeComicCharacters([actor({outfit:'white jacket'}),actor({outfit:'casual shirt',cosplay:null})],{costumes,outfits});
  expect(result[0].tag).toContain('Hero');expect(result[1].tag).not.toContain('Hero');expect(costumes.甲).toBeNull();
  expect(finalizeComicCharacters([actor()],{costumes,outfits})[0].tag).not.toContain('Hero');
 });
 it('a hidden outfit or head crop does not end cosplay and does not inject clothing into the crop',()=>{
  const costumes={甲:"cosplay, wearing Hero's outfit from Example Work."},outfits={甲:'white jacket'};
  expect(finalizeComicCharacters([actor({tag:'girl, face close-up\nText: 等一下。',clothingVisible:false,outfit:''})],{costumes,outfits})[0].tag).not.toContain('Hero');
  expect(costumes.甲).toContain('Hero');expect(finalizeComicCharacters([actor({outfit:'white jacket'})],{costumes,outfits})[0].tag).toContain('Hero');
 });
 it('does not attach another person costume to the neighbour',()=>{
  const result=finalizeComicCharacters([actor({outfit:'white jacket',cosplay}),actor({name:'乙',outfit:'blue coat'})]);
  expect(result[0].tag).toContain('Hero');expect(result[1].tag).not.toMatch(/Hero|cosplay|white jacket/);
 });
 it('keeps independent provenance even when out-of-order abbreviated wardrobe records exist',()=>{
  const ledger=new ComicWardrobeLedger();
  finalizeComicPlan({changes:[],images:[page(20,[actor({outfit:'white jacket'})])]},[],ledger);
  finalizeComicPlan({changes:[],images:[page(10,[actor({outfit:'white jacket',cosplay})])]},[],ledger);
  const later={changes:[],images:[page(30,[actor({outfit:'white jacket'})])]};finalizeComicPlan(later,[],ledger);
  expect(later.images[0].characters[0].tag).toContain('Hero');expect(ledger.costumesBefore(5)).toEqual({});
  finalizeComicPlan({changes:[],images:[page(40,[actor({outfit:'blue coat',cosplay:null})])]},[],ledger);
  expect(ledger.costumesBefore(41).甲).toBeNull();
 });
 it('accepts null in both protocols as an explicit end rather than invalid optional data',()=>{
  const result=parseImagePlan(JSON.stringify({images:[page(0,[actor({cosplay:null})])]}),[{id:'P1',text:'甲换回自己的衣服。',sourceLine:0}],1,1);
  expect(result.images[0].characters[0].cosplay).toBeNull();
  const text='<image>\n@page\nSFW, comic\n@panel P1\nThis single panel fills the page.\n@character C1 甲\ngirl, white shirt\n@cosplay\nnull\n</image>';
  const sections=parseComicSections(text)!;expect(sections.panels[0].characters[0].cosplay).toBeNull();expect(writeComicSections(sections)).toContain('@cosplay\nnull');
 });
});
