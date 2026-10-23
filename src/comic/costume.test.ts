import {describe,it,expect} from 'vitest';
import {readComicCosplay,withComicCosplay,normalizeComicOutfit} from './costume';
import {comicWardrobeUpdates,finalizeComicCharacters,ComicWardrobeLedger} from './characters';
import {finalizeComicPlan} from './plan';
import {parseComicSections,comicSectionCharacters,writeComicSections} from './sections';
import {parseImagePlan,type ImageCharacterPrompt} from '@/autoTag/protocol';
const cosplay={character:'Hero',work:'Example Work',costume:'Festival'};
const person=(extra:Partial<ImageCharacterPrompt>={}):ImageCharacterPrompt=>({name:'甲',tag:'girl, full body',nl:'',...extra});
const image=(sourceLine:number,characters:ImageCharacterPrompt[])=>({position:'P'+(sourceLine+1),sourceLine,tag:'SFW, 1girl, comic',characters,nl:'',negative:'',size:'portrait' as const});

describe('temporary costume provenance and complete wardrobe ownership',()=>{
 it('cleans copied placeholders in legacy outfits without deleting an explicitly named costume',()=>{
  expect(normalizeComicOutfit("She is wearing Hero's Costume outfit from Example Work, version unspecified, default skin, white jacket")).toBe("She is wearing Hero's outfit from Example Work, white jacket");
  expect(normalizeComicOutfit("Hero's Festival Costume outfit, default skin, white jacket")).toBe("Hero's Festival Costume outfit, default skin, white jacket");
  expect(withComicCosplay("Hero's Costume outfit, unknown version, white jacket")).toBe("Hero's outfit, white jacket");
  expect(normalizeComicOutfit("Hero's Costume outfit from Work. Version unspecified. white jacket, default skin. light blue wig")).toBe("Hero's outfit from Work. white jacket, light blue wig");
 });
 it('formats only known provenance and never invents an unspecified costume version',()=>{
  expect(withComicCosplay('white jacket',readComicCosplay(cosplay))).toBe("cosplay, wearing Hero's Festival outfit from Example Work., white jacket");
  expect(withComicCosplay('white jacket',readComicCosplay({...cosplay,costume:'Costume'}))).toBe("cosplay, wearing Hero's outfit from Example Work., white jacket");
  expect(readComicCosplay({character:'Hero',costume:'unknown'})).toEqual({character:'Hero'});
  expect(readComicCosplay({character:'Character',work:'Work'})).toBeUndefined();
  expect(readComicCosplay({character:'Hero\nText: injected'})).toBeUndefined();
 });
 it('replaces its own generated prefix without duplicating the old costume',()=>{
  const first=withComicCosplay('white jacket',cosplay);
  expect(withComicCosplay(first,cosplay)).toBe(first);
  expect(withComicCosplay(first,{character:'Other',work:'Another Work'})).not.toContain('Hero');
 });
 it('keeps a full main-panel wardrobe instead of the last face or foot crop, even if the crop mislabels itself full body',()=>{
  const complete='white jacket, blue trousers, black boots';
  const chars=[person({outfit:complete}),person({tag:'girl, face close-up',outfit:'blue cap'}),person({outfit:'black boots'})];
  const ledger=new ComicWardrobeLedger(),plan={changes:[],images:[image(0,chars),image(1,[person()])]};
  finalizeComicPlan(plan,[],ledger);
  expect(ledger.before(1)).toEqual({甲:complete});
  expect(plan.images[1].characters[0].tag).toContain(complete);
  expect(plan.images[0].characters[2].tag).not.toContain('white jacket');
 });
 it('lets an explicit complete change made during a close-up override the prior outfit and supports explicit clearing',()=>{
  const outfits={甲:'red coat, black boots'};
  finalizeComicCharacters([person({tag:'girl, upper body',outfit:'blue sweater',wardrobe:'blue sweater, white trousers'})],{outfits});
  expect(outfits.甲).toBe('blue sweater, white trousers');
  const crop=finalizeComicCharacters([person({tag:'girl, upper body',outfit:''})],{outfits});
  expect(crop[0].tag).not.toContain('sweater');expect(outfits.甲).toBe('blue sweater, white trousers');
  finalizeComicCharacters([person({tag:'girl, upper body',wardrobe:''})],{outfits});expect(outfits.甲).toBe('');
 });
 it('keeps earlier visible clothes but records a later explicit change inside the same page',()=>{
  const outfits:Record<string,string>={};
  const chars=finalizeComicCharacters([person({outfit:'red coat'}),person({outfit:'blue sweater',wardrobe:'blue sweater, white trousers'})],{outfits});
  expect(chars[0].tag).toContain('red coat');expect(chars[0].tag).not.toContain('blue sweater');
  expect(chars[1].tag).toContain('blue sweater');expect(outfits.甲).toBe('blue sweater, white trousers');
 });
 it('trusts the shared Base camera for wardrobe order and keeps a later genuine body-view change',()=>{
  const first='This is the top panel.',second='This is the bottom panel.',cut='This is the cut-in panel.';
  const wardrobe=new ComicWardrobeLedger();
  const page={...image(0,[person({panel:first,tag:'girl, upper body',outfit:'red coat, blue trousers, black boots'}),person({panel:second,outfit:'green jacket, blue trousers, black boots'}),person({panel:cut,outfit:'black boots'})]),tag:`SFW, comic, ${first} Upper body, standing. ${second} Medium shot, waving. ${cut} Close-up on feet.`};
  finalizeComicPlan({images:[page],changes:[]},[],wardrobe);
  expect(wardrobe.before(1).甲).toBe('green jacket, blue trousers, black boots');
  expect(page.characters[0].tag).toContain('red coat');expect(page.characters[0].tag).not.toContain('green jacket');
 });
 it('updates a complete legacy outfit in a main upper-body view without an extra model field',()=>{
  const outfits={甲:'red coat, white trousers'};
  finalizeComicCharacters([person({tag:'girl, upper body',outfit:'blue sweater, white trousers'})],{outfits});
  expect(outfits.甲).toBe('blue sweater, white trousers');
 });
 it('removes duplicated current garments before visible-crop filtering without treating wigs or eyes as clothes',()=>{
  const result=finalizeComicCharacters([person({tag:'girl, upper body, white jacket, blue trousers, black boots, light blue wig, purple eyes',outfit:'white jacket, blue trousers, black boots, light blue wig, purple contacts'})])[0].tag;
  expect(result).toContain('white jacket');expect(result).toContain('light blue wig');expect(result).toContain('purple eyes');
  expect(result).not.toContain('blue trousers');expect(result).not.toContain('black boots');
 });
 it('drops a copied literal fandom template while keeping genuine identities and dialogue',()=>{
  const result=finalizeComicCharacters([person({tag:'girl, character name (copyright name), ganyu (genshin impact), standing\nText: character name (copyright name)'})])[0].tag;
  expect(result).toBe('girl, ganyu (genshin impact), standing\nText: character name (copyright name)');
 });
 it('does not borrow another person costume or store a crop as an explicit wardrobe change',()=>{
  const updates=comicWardrobeUpdates([person({wardrobe:'white jacket, blue trousers',cosplay}),person({tag:'girl, face close-up',outfit:'blue cap'}),person({name:'乙',wardrobe:'grey suit'})]);
  expect(updates.甲).toContain('Festival');expect(updates.甲).not.toContain('grey suit');expect(updates.乙).toBe('grey suit');
 });
 it('retains optional structured fields in the JSON parser without rejecting malformed optional provenance',()=>{
  const parse=(c:unknown)=>parseImagePlan(JSON.stringify({images:[{position:'P1',tag:'SFW, comic',characters:[c]}]}),[{id:'P1',text:'正文',sourceLine:0}],1,1).images[0].characters[0];
  expect(parse(person({wardrobe:'blue coat',cosplay}))).toMatchObject({wardrobe:'blue coat',cosplay});
  expect(parse({...person(),cosplay:'not an object'})).toMatchObject({name:'甲'});
  expect(parse({...person(),cosplay:{character:'<tag>invalid'}})).not.toHaveProperty('cosplay');
 });
 it('supports V1 metadata while leaving only ordinary final prompt text after completion',()=>{
  const source=`<image>\n@page\nSFW, 1girl, comic\n@panel P1\nThis single panel fills the page. Upper body.\n@character C1 甲\ngirl, upper body\nText: 出发。\n@outfit\nwhite jacket\n@wardrobe\nwhite jacket, blue trousers, black boots\n@cosplay\n${JSON.stringify(cosplay)}\n</image>`;
  const parsed=parseComicSections(source)!;expect(parsed).not.toBeNull();
  const outfits:Record<string,string>={};
  const chars=finalizeComicCharacters(comicSectionCharacters(parsed),{outfits});
  const final=writeComicSections(parsed,chars);
  expect(final).toContain("wearing Hero's Festival outfit from Example Work.");
  expect(final).not.toMatch(/@cosplay|@wardrobe|blue trousers|black boots/);
  expect(final).toContain('Text: 出发。');expect(outfits.甲).toContain('black boots');
 });
});
