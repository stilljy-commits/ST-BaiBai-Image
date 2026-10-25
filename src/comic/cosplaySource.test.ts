import {describe,it,expect} from 'vitest';
import {finalizeComicCharacters} from './characters';
import {comicCosplayPrefix,comicCosplayContext,readComicCosplay} from './costume';
import type {ComicCostumes} from './costume';
import {parseComicSections,comicSectionCharacters} from './sections';
const person=(name:string,outfit:string,extra:Record<string,unknown>={})=>({name,tag:'girl, long black hair, standing, full body',nl:'',outfit,...extra});
describe('real-world abbreviated cosplay source compatibility',()=>{
 it('recognizes the reported shorthand without guessing a game or skin',()=>{
  for(const phrase of ['ganyu costume','alsace cosplay','new jersey bunny cosplay']){
   expect(comicCosplayPrefix(phrase)).toContain(phrase);
   const [result]=finalizeComicCharacters([person('原创角色',phrase)]);
   expect(result.tag).toContain(phrase);expect(result.tag).not.toMatch(/Genshin|Azur|Exhilarating/);
  }
  for(const phrase of ['bunny costume','maid costume','traditional chinese costume','victorian costume','festival costume'])expect(comicCosplayPrefix(phrase+', white jacket')).toBeUndefined();
 });
 it('fills reported ganyu costume from a previously confirmed source, preserving the wearer and dialogue',()=>{
  const costumes:ComicCostumes={林小染:"cosplay, wearing Ganyu's outfit from Genshin Impact."};
  const [result]=finalizeComicCharacters([person('林小染','ganyu costume, black bodysuit, detached sleeves',{tag:'girl, long black hair, standing\nText: 请帮我系好。'})],{costumes});
  expect(result.tag).toContain("Ganyu's outfit from Genshin Impact.");expect(result.tag).not.toContain('ganyu costume');
  expect(result.tag).toContain('long black hair');expect(result.tag.endsWith('\nText: 请帮我系好。')).toBe(true);
 });
 it('keeps a confirmed work and version through a weaker legacy source and each reported suffix',()=>{
  for(const [target,phrase]of [['New Jersey','new jersey bunny cosplay'],['Alsace','alsace cosplay'],['Ganyu','cosplay as Ganyu'],['Ganyu',"cosplay, wearing Ganyu's outfit."]]){
   const costumes:ComicCostumes={甲:`cosplay, wearing ${target}'s Named Skin outfit from Known Work.`};
   const [result]=finalizeComicCharacters([person('甲',phrase+', white jacket')],{costumes});
   expect(result.tag).toContain(`${target}'s Named Skin outfit from Known Work.`);
  }
 });
 it('does not restore the previous target when the shorthand explicitly names someone else',()=>{
  const costumes:ComicCostumes={甲:"cosplay, wearing Ganyu's outfit from Genshin Impact."};
  const [result]=finalizeComicCharacters([person('甲','alsace cosplay, white jacket')],{costumes});
  expect(result.tag).toContain('alsace cosplay');expect(result.tag).not.toMatch(/Ganyu|Genshin/);
 });
 it('uses explicit new work information instead of borrowing an old costume version across works',()=>{
  const costumes:ComicCostumes={甲:"cosplay, wearing Hero's Old Skin outfit from First Work."};
  const [result]=finalizeComicCharacters([person('甲','cosplay as Hero (Second Work), white jacket')],{costumes});
  expect(result.tag).toContain('Second Work');expect(result.tag).not.toMatch(/First Work|Old Skin/);
 });
 it('accepts a source-qualified legacy string, but never generic clothing or malformed metadata',()=>{
  expect(readComicCosplay('Ganyu (Genshin Impact)')).toEqual({character:'Ganyu',work:'Genshin Impact'});
  expect(readComicCosplay('not an object')).toBeUndefined();expect(readComicCosplay('white jacket')).toBeUndefined();
  expect(readComicCosplay('ganyu costume')).toBeUndefined();
  const page='<image>\n@page\nSFW, comic\n@panel P1\nThis single panel fills the page.\n@character C1 原创角色\ngirl, long black hair, standing\n@outfit\nwhite jacket\n@cosplay\nGanyu (Genshin Impact)\n</image>';
  const [result]=finalizeComicCharacters(comicSectionCharacters(parseComicSections(page)!));
  expect(result.tag).toContain("Ganyu's outfit from Genshin Impact.");
 });
 it('tells the model exactly which wearers have a confirmed complete source',()=>{
  const note=comicCosplayContext({甲:"cosplay, wearing Ganyu's outfit from Genshin Impact.",乙:'cosplay, alsace cosplay',丙:null});
  expect(note).toContain('Genshin Impact');expect(note).not.toContain('alsace');
  expect(note).toContain('未列出的');expect(comicCosplayContext({})).toContain('{}');
 });
});
