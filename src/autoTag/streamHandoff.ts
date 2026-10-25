import {findMarkers} from './markers';

/** Raw-source projection, ignoring whitespace and narrative image markers only.
 * No fuzzy story matching, HTML rewriting, or guessing a deleted scene. */
function project(text:string,stripTags:string[]){
  const markers=findMarkers(text,stripTags),points:Array<{at:number;raw:string;ordinal:number}>=[],ends:number[]=[];
  let body='',index=0;
  for(let i=0;i<text.length;i++){
    const marker=markers[index];
    if(marker?.index===i){points.push({at:body.length,raw:marker.raw,ordinal:index++});i=marker.end-1;continue;}
    if(!/\s/.test(text[i])){body+=text[i];ends.push(i+1);}
  }
  return {body,points,ends};
}

/** Final cleanup can remove img markers without changing the story. Recover
 * only already accepted source markers, at their exact original text boundary.
 * Rewritten prose, unknown ownership, a short/empty story, or a replacement
 * marker at that boundary are never overridden. */
export function restoreStreamMarkers(finalText:string,streamText:string,ordinals:ReadonlySet<number>,stripTags:string[]=[],continuing=false):string|null{
  if(!streamText||!ordinals.size)return null;
  const source=project(streamText,stripTags),target=project(finalText,stripTags);
  if(source.body.length<16)return null;
  const offset=continuing?target.body.length-source.body.length:0;
  if(offset<0||target.body.slice(offset)!==source.body)return null;
  const occupied=new Set(target.points.map(point=>point.at));
  const missing=source.points.filter(point=>ordinals.has(point.ordinal)&&!occupied.has(point.at+offset));
  if(!missing.length)return null;
  let next=finalText;
  for(const point of [...missing].reverse()){
    const at=point.at+offset,index=at?target.ends[at-1]:0;
    next=next.slice(0,index)+'\n'+point.raw+'\n'+next.slice(index);
  }
  return next;
}
