import {describe,it,expect} from 'vitest';
import {comicFixedFields,finalizeComicCharacters,visibleComicOutfit,ComicWardrobeLedger} from './characters';
import {finalizeComicPlan} from './plan';
import {parseComicSections,comicSectionCharacters,writeComicSections} from './sections';
import {parseImageTagContent,serializeImageTag} from '@/st/imageTagRegex';
import type {CharTagEntry} from '@/state/charTags';
import type {ImageCharacterPrompt,ImagePlan} from '@/autoTag/protocol';
const entry=(name:string,outfit:string,source:CharTagEntry['source']='manual',fandom=''):CharTagEntry=>({name,fields:{fandom,sex:'girl',hair:'silver hair',eyes:'blue eyes',skin:'',body:'',extra:'',outfit},raw:'',nl:'',source,desc:'',history:[]});
const person=(name:string,extra:Partial<ImageCharacterPrompt>={}):ImageCharacterPrompt=>({name,tag:'girl, holding a map, medium shot',nl:'',...extra});
const image=(sourceLine:number,characters:ImageCharacterPrompt[])=>({position:'P'+(sourceLine+1),sourceLine,tag:'SFW, 2girls, comic, station',characters,nl:'',negative:'',size:'portrait' as const});
describe('shared comic appearance and clothing completion',()=>{
 it('keeps cosplay source and costume version temporary and owned by the wearer',()=>{
  const original=entry('甲','red coat','ai'),other=entry('乙','blue coat');
  const outfit="cosplay, She is wearing Hero's Festival costume from Example Work., white jacket, gold trim, blue leggings, white boots";
  const outfits:Record<string,string>={};
  const chars=finalizeComicCharacters([person('甲',{outfit,panel:'upper right panel'}),person('乙',{panel:'upper right panel'})],{entries:[original,other],outfits});
  expect(chars[0].tag).toContain("Hero's Festival costume from Example Work");
  expect(chars[0].tag).toContain('white jacket');expect(chars[0].tag).not.toContain('red coat');
  expect(chars[1].tag).toContain('blue coat');expect(chars[1].tag).not.toMatch(/cosplay|Festival|white jacket/);
  expect(outfits.甲).toBe(outfit);expect(original.fields.fandom).toBe('');
  expect(comicFixedFields(original).hair).toBe('silver hair');expect(original.fields.outfit).toBe('red coat');
 });
 it('does not restore casual library clothes when an existing tag already names a cosplay or leggings',()=>{
  for(const tag of ['girl, cosplay as Hero, medium shot','girl, sky-blue leggings, full body']){
   const result=finalizeComicCharacters([person('甲',{tag})],{entries:[entry('甲','red coat')]});
   expect(result[0].tag).toBe(tag);
  }
 });
 it('keeps the full wardrobe across an upper-body crop and a later full-body panel',()=>{
  const outfits:Record<string,string>={},outfit="cosplay, She is wearing Hero's Festival costume from Example Work., white jacket, gold trim, sky-blue leggings, white over-knee heeled boots";
  const cropped=finalizeComicCharacters([person('甲',{tag:'girl, silver hair, upper body\nText: 你好。',outfit})],{outfits});
  expect(cropped[0].tag).toContain('white jacket');expect(cropped[0].tag).toContain('Festival costume');
  expect(cropped[0].tag).not.toMatch(/leggings|boots/);expect(cropped[0].tag.endsWith('\nText: 你好。')).toBe(true);
  expect(outfits.甲).toBe(outfit);
  const next=finalizeComicCharacters([person('甲',{tag:'girl, full body'})],{outfits});
  expect(next[0].tag).toContain('sky-blue leggings');expect(next[0].tag).toContain('white over-knee heeled boots');
 });
 it('does not guess which clauses to delete from mixed sentences, named costumes or ambiguous framing',()=>{
  const sentence="She is wearing a white jacket and white boots from Hero's costume.";
  expect(visibleComicOutfit(sentence,'girl, upper body')).toBe(sentence);
  expect(visibleComicOutfit('Boots of Dawn costume, white jacket','girl, upper body')).toBe('Boots of Dawn costume, white jacket');
  expect(visibleComicOutfit('white boots','girl, medium shot')).toBe('white boots');
  expect(visibleComicOutfit('white boots','girl, upper body, full body')).toBe('white boots');
 });
 it('fills each missing visible outfit from its own profile and excludes only color-swapped same garments',()=>{
  const chars=finalizeComicCharacters([person('甲',{panel:'upper right panel'}),person('乙',{panel:'upper right panel'})],{entries:[entry('甲','red coat, white shirt'),entry('乙','blue coat, white shirt')]});
  expect(chars[0].tag).toContain('red coat');expect(chars[1].tag).toContain('blue coat');
  expect(chars[0].negative).toBe('blue coat');expect(chars[1].negative).toBe('red coat');
  expect(chars.every(c=>!c.negative?.includes('white shirt'))).toBe(true);
 });
 it('replaces a known default outfit with an explicit current outfit before the original dialogue',()=>{
  const chars=finalizeComicCharacters([person('甲',{tag:'girl, red coat, medium shot\nText: 出发吧，地图给你。',outfit:'blue sweater',panel:'This is the upper right panel.'})],{entries:[entry('甲','red coat')]});
  expect(chars[0].tag).toContain('blue sweater\nText: 出发吧，地图给你。');expect(chars[0].tag).not.toContain('red coat');
  expect(chars[0].tag.startsWith('This is the upper right panel.')).toBe(true);
  expect(chars[0]).not.toHaveProperty('outfit');expect(chars[0]).not.toHaveProperty('panel');
 });
 it('carries a changed outfit and an explicit empty outfit without restoring defaults',()=>{
  const plan:ImagePlan={changes:[],images:[image(0,[person('甲',{outfit:'blue sweater'})]),image(1,[person('甲')]),image(2,[person('甲',{outfit:''})]),image(3,[person('甲')])]};
  finalizeComicPlan(plan,[entry('甲','red coat')]);
  expect(plan.images[1].characters[0].tag).toContain('blue sweater');
  expect(plan.images[3].characters[0].tag).not.toMatch(/red coat|blue sweater/);
 });
 it('a crop does not erase the wardrobe for a later full view',()=>{
  const outfits={甲:'blue sweater'};
  const cropped=finalizeComicCharacters([person('甲',{tag:'girl, face close-up',clothingVisible:false})],{entries:[entry('甲','red coat')],outfits});
  expect(cropped[0].tag).not.toContain('sweater');expect(outfits.甲).toBe('blue sweater');
  expect(finalizeComicCharacters([person('甲')],{entries:[entry('甲','red coat')],outfits})[0].tag).toContain('blue sweater');
 });
 it('does not redesign automatically profiled fandom characters but preserves manual traits and explicit overrides',()=>{
  const canonical=entry('甲','invented uniform','ai','canonical_character (work)');
  expect(comicFixedFields(canonical)).toEqual({sex:'girl',fandom:'canonical_character (work)'});
  expect(finalizeComicCharacters([person('甲')],{entries:[canonical]})[0].tag).not.toContain('uniform');
  expect(finalizeComicCharacters([person('甲',{outfit:'white shirt'})],{entries:[canonical]})[0].tag).toContain('white shirt');
  canonical.history.push({field:'hair',floor:-1,from:'',to:'silver hair',reason:'manual',at:1});
  expect(comicFixedFields(canonical).hair).toBe('silver hair');expect(comicFixedFields(canonical,new Set(['eyes'])).eyes).toBe('blue eyes');
  expect(comicFixedFields(entry('甲','red coat','manual',canonical.fields.fandom)).outfit).toBe('red coat');
 });
 it('does not infer that different garment types are mutually exclusive',()=>{
  const chars=finalizeComicCharacters([person('甲',{outfit:'red coat'}),person('乙',{outfit:'blue uniform'})]);
  expect(chars.every(c=>!c.negative)).toBe(true);
 });
 it('keeps confirmed story changes on an automatic fandom profile',()=>{
  const changed=entry('甲','blue coat','ai','canonical_character (work)');
  changed.history.push({field:'hair',floor:2,from:'silver hair',to:'short hair',reason:'story',at:1},{field:'outfit',floor:2,from:'red coat',to:'blue coat',reason:'story',at:1});
  changed.fields.hair='short hair';
  expect(comicFixedFields(changed)).toMatchObject({hair:'short hair',outfit:'blue coat'});
  expect(finalizeComicCharacters([person('甲')],{entries:[changed]})[0].tag).toContain('blue coat');
 });
 it('does not infer exclusions between separate panel locations',()=>{
  const chars=finalizeComicCharacters([person('甲',{outfit:'red coat',panel:'upper right panel'}),person('乙',{outfit:'blue coat',panel:'lower left panel'})]);
  expect(chars.every(c=>!c.negative)).toBe(true);
  const unknown=finalizeComicCharacters([person('甲',{outfit:'red coat'}),person('乙',{outfit:'blue coat'})]);
  expect(unknown.every(c=>!c.negative)).toBe(true);
 });
 it('does not reapply an earlier permanent wardrobe over a later temporary change',()=>{
  const ledger=new ComicWardrobeLedger();
  const plan:ImagePlan={changes:[{name:'甲',field:'outfit',value:'white shirt',position:'P1',sourceLine:0,reason:''}],images:[image(1,[person('甲',{outfit:'blue sweater'})]),image(2,[person('甲')])]};
  finalizeComicPlan(plan,[entry('甲','red coat')],ledger);
  expect(plan.images[1].characters[0].tag).toContain('blue sweater');
  expect(plan.images[1].characters[0].tag).not.toContain('white shirt');
  expect(ledger.before(1)).toEqual({甲:'white shirt'});expect(ledger.before(3)).toEqual({甲:'blue sweater'});
 });
 it('removes self-conflicting negatives, shared garments and broad colors appearing on the same character',()=>{
  const chars=finalizeComicCharacters([person('甲',{tag:'girl, blue eyes, red coat, white shirt',negative:'blue, red coat, white shirt, blue uniform'})]);
  expect(chars[0].negative).toBe('blue uniform');
 });
 it('does not compare a character against their own appearances in other panels',()=>{
  const chars=finalizeComicCharacters([person('甲',{outfit:'red coat'}),person('甲',{outfit:'blue coat'})]);
  expect(chars.every(c=>!c.negative)).toBe(true);
 });
 it('keeps out-of-order analysis from restoring stale state or leaking future facts',()=>{
  const ledger=new ComicWardrobeLedger();ledger.accept(20,{乙:'blue coat'});ledger.accept(10,{甲:'red coat'});ledger.accept(30,{甲:''});
  expect(ledger.before(10)).toEqual({});expect(ledger.before(25)).toEqual({甲:'red coat',乙:'blue coat'});
  expect(ledger.before(31)).toEqual({甲:'',乙:'blue coat'});
  const earlier:ImagePlan={changes:[],images:[image(5,[person('甲')])]};finalizeComicPlan(earlier,[entry('甲','white shirt')],ledger);
  expect(earlier.images[0].characters[0].tag).toContain('white shirt');
 });
 it('keeps character negatives through chat storage roundtrips',()=>{
  const content={tag:'SFW, 2girls',characters:[person('甲',{negative:'blue coat'})],nl:'',negative:'',size:'portrait' as const};
  const result=parseImageTagContent(serializeImageTag(content));expect(result.characters).toEqual(content.characters);
 });
});
describe('legacy section protocol as structured character input',()=>{
 const source='<image>\n@page\nSFW, 2girls, comic, 2 panels\n@panel P1\nThis is the upper right panel. Medium shot.\n@character C1 甲\ngirl, holding a map\n@outfit\nred coat\n@negative\nblue coat\n@panel P2\nThis is the bottom main panel.\n@character C2 乙\ngirl, smiling\nText: 好的。\n@outfit\nblue coat\n@negative\nred coat\n</image>';
 it('preserves per-panel identities, outfit state, original dialogue and individual exclusions',()=>{
  const parsed=parseComicSections(source)!;expect(parsed).not.toBeNull();
  const chars=finalizeComicCharacters(comicSectionCharacters(parsed));
  expect(chars.map(c=>c.name)).toEqual(['甲','乙']);expect(chars[0].tag).toContain('upper right panel');expect(chars[1].tag).toContain('Text: 好的。');
  const roundtrip=parseComicSections(writeComicSections(parsed,chars))!;
  expect(roundtrip.panels[0].characters[0].negative).toBe('blue coat');
  expect(roundtrip.panels[1].characters[0].negative).toBe('red coat');
 });
 it('accepts old unnamed ids and refuses malformed content without throwing',()=>{
  expect(parseComicSections(source.replace('C1 甲','C1'))!.panels[0].characters[0].name).toBe('C1');
  expect(parseComicSections(source.replace('@page','@unknown'))).toBeNull();expect(parseComicSections('plain old prompt')).toBeNull();
  expect(parseComicSections(source.replace('@page','@position 0.2 0.5\n@page'))).toBeNull();
 });
});
