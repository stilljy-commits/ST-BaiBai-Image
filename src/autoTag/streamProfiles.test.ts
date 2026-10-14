import { it, expect } from 'vitest';
import { mergeStreamProfiles } from './streamProfiles';
import type { CharChange, ImagePlan } from './protocol';
const change=(hair:string):CharChange=>({name:'小雪',field:'new',value:JSON.stringify({hair,eyes:'blue eyes',sex:'1girl'}),reason:'首次出场',position:'P1',sourceLine:0});
it('reuses the first appearance in parallel character prompts without changing actions or later permanent updates',()=>{
  const established=new Map([['小雪',change('long black hair')]]);
  const plan:ImagePlan={changes:[change('long blonde hair'),{...change('long blonde hair'),field:'hair',value:'short black hair',sourceLine:5}],
    images:[{position:'P1',sourceLine:0,tag:'1girl, comic, 2 panels',nl:'',negative:'',size:'portrait',characters:[{name:'小雪',tag:'girl, long blonde hair, blue eyes, holding a key',nl:''}]}]};
  const merged=mergeStreamProfiles(plan,established);
  expect(merged.images[0].characters[0].tag).toContain('long black hair');expect(merged.images[0].characters[0].tag).toContain('holding a key');
  expect(merged.changes[1].value).toBe('short black hair');
});
