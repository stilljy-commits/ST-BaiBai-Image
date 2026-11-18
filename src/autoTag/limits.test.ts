import {expect,it} from 'vitest';
import {normalizeImageLimits} from './limits';
it('keeps header and settings image limits consistent while preserving the edited value',()=>{
  const limits={minImages:3,maxImages:5};
  limits.minImages=7;normalizeImageLimits(limits,'minImages');expect(limits).toEqual({minImages:7,maxImages:7});
  limits.maxImages=2;normalizeImageLimits(limits,'maxImages');expect(limits).toEqual({minImages:2,maxImages:2});
  limits.minImages=-2;limits.maxImages=0;normalizeImageLimits(limits);expect(limits).toEqual({minImages:0,maxImages:1});
});
