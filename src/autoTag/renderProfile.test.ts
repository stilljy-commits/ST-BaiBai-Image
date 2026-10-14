import { it, expect } from 'vitest';
import { applyRenderProfile, captureRenderProfile, inferRenderProfile } from './renderProfile';
import { settings } from '@/state/settings';
import { parseImageTagContent, serializeImageTag } from '@/st/imageTagRegex';
import { historyEntries, appendEntry, type BbiImageEntry } from '@/floor/storage';
it('round trips stable identity and rendering mode without exposing them as prompts',()=>{
  const tag=serializeImageTag({tag:'1girl, comic, 2 panels',nl:'',negative:'',characters:[],size:'portrait',slotId:'run_1',renderProfile:{mode:'comic-v2',text:false}});
  expect(parseImageTagContent(tag)).toMatchObject({slotId:'run_1',tag:'1girl, comic, 2 panels',renderProfile:{mode:'comic-v2',text:false}});
});
it('preserves illustration rendering despite global comic settings and rejects 4.5 comic',()=>{
  const nai={...settings.nai,comicMode:true,comicV2:true,model:'nai-diffusion-4-5-full' as const};
  expect(captureRenderProfile(nai).mode).toBe('illustration');
  expect(captureRenderProfile({...nai,model:'nai-diffusion-5-full'},'comfyui').mode).toBe('illustration');
  expect(applyRenderProfile(nai,{mode:'illustration',text:true}).comicMode).toBe(false);
  expect(inferRenderProfile('1girl, classroom').mode).toBe('illustration');
});
it('finds a stable image after a preceding supplemental slot shifts its DOM sequence',()=>{
  const entry:BbiImageEntry={generationId:'g',path:'test.png',prompt:'tag',seed:1,status:'ready',createdAt:1,slotSeq:1,slotId:'run_1'};
  const store=appendEntry({},0,'hash',entry);
  expect(historyEntries(store,0,'hash',2,'run_1')).toEqual([entry]);
  expect(historyEntries(store,0,'hash',1)).toEqual([]);
});
