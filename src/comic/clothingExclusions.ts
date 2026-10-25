const colorWords=/\b(?:red|blue|green|yellow|white|black|brown|purple|pink|orange|grey|gray|silver|golden|gold|navy|beige)\b/g;
const key=(v:string)=>v.toLowerCase().replace(/\s+/g,' ').trim();
const parts=(value:string)=>value.split(/\nText:/i)[0].split(/[,;\n]/).map(key).filter(Boolean);
const hue=(v:string)=>v==='gray'?'grey':v==='golden'?'gold':v;
function garment(value:string){
  // Only standalone visual tags: no sentences, weights, negations or compound outfits.
  if(/[.:#!()[\]{}]/.test(value)||/\b(?:and|without|no|not|holding)\b/.test(value))return;
  const match=value.match(/\b(coat|jacket|blazer|shirt|blouse|sweater|dress|skirt|pants|trousers|boots|shoes|gloves|hat|cap|necktie|bowtie|bow tie|brooch|hair ribbon|hair bow)$/);
  if(!match)return;
  const kind=match[1],colors=[...value.matchAll(colorWords)].map(m=>hue(m[0]));
  return {kind,colors,shape:key(value.replace(colorWords,' '))};
}
/** Local, bounded exclusions. Different layers and skirt-over-trousers remain valid. */
export function conflictingClothing(own:string,other:string):string[]{
  const mine=parts(own).map(garment).filter(v=>!!v);
  return parts(other).filter(candidate=>{
    const next=garment(candidate);if(!next)return false;
    return mine.some(current=>current.shape===next.shape&&current.colors.length>0&&next.colors.length>0&&
      !current.colors.some(c=>next.colors.includes(c))||
      /^(?:necktie|bowtie|bow tie)$/.test(current.kind)&&/^(?:necktie|bowtie|bow tie)$/.test(next.kind)&&
      (current.kind==='necktie')!==(next.kind==='necktie'));
  });
}
export function conflictsWithOwnClothing(negative:string,positive:string):boolean{
  const candidate=garment(key(negative));if(!candidate)return false;
  return parts(positive).some(value=>{
    const own=garment(value);
    return own?.kind===candidate.kind&&(!candidate.colors.length||candidate.colors.every(c=>own.colors.includes(c)));
  });
}
export const isBareColor=(value:string)=>{const v=key(value);return [...v.matchAll(colorWords)].some(m=>m[0]===v);};
