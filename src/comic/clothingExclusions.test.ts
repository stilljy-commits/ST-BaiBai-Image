import {describe,it,expect} from 'vitest';
import {finalizeComicCharacters} from './characters';
const pair=(a:string,b:string)=>finalizeComicCharacters([{name:'甲',tag:'girl, standing',outfit:a,nl:'',panel:'upper right panel'},{name:'乙',tag:'girl, standing',outfit:b,nl:'',panel:'upper right panel'}]);
describe('bounded per-person clothing exclusions',()=>{
 it('excludes a neighbour necktie or bowtie, never their shared shirt or an entire color',()=>{
  const result=pair('white shirt, red necktie','white shirt, blue bowtie');
  expect(result.map(c=>c.negative)).toEqual(['blue bowtie','red necktie']);
 });
 it('covers specific accessory color alternatives',()=>{
  expect(pair('white jacket, gold brooch','white jacket, silver brooch').map(c=>c.negative)).toEqual(['silver brooch','gold brooch']);
 });
 it('does not guess incompatible layering, skirts over trousers or a missing costume',()=>{
  for(const [a,b] of [['white shirt','black jacket'],['red skirt','blue trousers'],['','blue coat'],['gold brooch','silver hair ribbon']])expect(pair(a,b).every(c=>!c.negative)).toBe(true);
 });
 it('does not infer from prose or weights, and preserves explicit specialized exclusions',()=>{
  expect(pair('wearing a red coat and holding a map','blue coat').every(c=>!c.negative)).toBe(true);
  const [result]=finalizeComicCharacters([{name:'甲',tag:'girl, white collared shirt, red necktie',nl:'',negative:'white shirt, white, red, blue bowtie'}]);
  expect(result.negative).toBe('blue bowtie');
 });
 it('limits automatically inferred differences while retaining explicit exclusions',()=>{
  const [result]=pair('red coat, red skirt, red boots, red gloves, red hat, red brooch','blue coat, blue skirt, blue boots, blue gloves, blue hat, blue brooch');
  expect(result.negative!.split(', ')).toHaveLength(4);
 });
});
