import { describe, it, expect } from 'vitest';
import { imageDimensions, imageGeometryStyle } from './imageGeometry';
describe('image geometry during streaming', () => {
  it('reserves the exact NAI ratio rather than an approximate portrait ratio', () => {
    expect(imageGeometryStyle(imageDimensions({width:832,height:1216}),600)).toEqual({
      '--bbi-figure-max-h':'600px','--bbi-image-ratio':'832 / 1216','--bbi-placeholder-width':`${600*832/1216}px`,
    });
  });
  it('keeps landscape and uncapped images at their actual proportions', () => {
    expect(imageGeometryStyle(imageDimensions({width:1536,height:1024}),null)).toEqual({'--bbi-image-ratio':'1536 / 1024','--bbi-placeholder-width':'100%'});
  });
  it('ignores missing or invalid legacy metadata without discarding the image', () => {
    for (const value of [null,{}, {width:0,height:1216}, {width:NaN,height:1216}, {width:'832',height:1216}]) expect(imageDimensions(value)).toBeUndefined();
    expect(imageGeometryStyle(undefined,null)).toEqual({});
  });
});
