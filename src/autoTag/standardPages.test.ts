import {describe,it,expect} from 'vitest';
import {standardPagePrefix} from './standardPages';
describe('native plan progressive prefix',()=>{
 it('waits for complete changes and only yields complete direct image objects',()=>{
  expect(standardPagePrefix('{"changes":[{"name":"甲"}')).toBeNull();
  const raw='{"changes":[],"images":[{"position":"M1","tag":"braces { } and quote \\\""},{"position":"M2","tag":"unfinished';
  expect(standardPagePrefix(raw)).toEqual({changes:[],images:[{position:'M1',tag:'braces { } and quote "'}]});
 });
 it('does not expose a draft in an unclosed thought block or free commentary',()=>{
  const raw='{"changes":[],"images":[{"position":"M1"}';
  expect(standardPagePrefix('<thinking>'+raw)).toBeNull();
  expect(standardPagePrefix('Draft: '+raw)).toBeNull();
  expect(standardPagePrefix('<thinking>draft</thinking>\n```json\n'+raw)).toEqual({changes:[],images:[{position:'M1'}]});
 });
 it('falls back to whole-plan handling for images-first replies and duplicate root prefixes',()=>{
  expect(standardPagePrefix('{"images":[{}],"changes":[]}')).toBeNull();
  expect(standardPagePrefix('{"changes":[],"changes":[],"images":[{}]}')).toBeNull();
 });
 it('ignores partial or mismatched nested objects without manufacturing a page',()=>{
  expect(standardPagePrefix('{"changes":[],"images":[{"tag":"a","characters":[{"tag":"b"}')).toEqual({changes:[],images:[]});
  expect(standardPagePrefix('{"changes":[],"images":[{"tag":"a"]')).toEqual({changes:[],images:[]});
 });
});
