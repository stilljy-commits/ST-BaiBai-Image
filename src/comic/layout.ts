const positions=['upper right','upper left','middle right','middle left','lower right','lower left'];
/** AI chooses among a few layouts; the program supplies the same spatial phrase
 * to both page and actor descriptions. No coordinates or area arithmetic. */
export function comicPanelLocation(index:number,count:number,style:string,layout='auto',focus?:number):string {
  if(count===1)return 'This single panel fills the page.';
  if(style==='yonkoma')return `This is the ${['top','second','third','bottom'][index]??`${index+1}th`} equal rectangular panel in a vertical four-panel sequence.`;
  if(layout==='stacked'||(['slice','comedy','seinen'].includes(style)&&layout==='auto'))
    return `This is wide horizontal panel ${index+1}, ${index===0?'at the top':index===count-1?'at the bottom':`in row ${index+1}`} of the page.`;
  if(layout==='grid')return `This is panel ${index+1} in the ${positions[index]??`row ${Math.floor(index/2)+1}, ${index%2?'left':'right'} side`}, read right to left and top to bottom.`;
  if(layout==='focus-top'||layout==='focus-bottom'){
    const main=layout==='focus-top'?0:count-1,top=layout==='focus-top';
    if(index===main)return `This is the large main panel ${top?'at the top':'at the bottom'} of the page.`;
    const small=index<main?index:index-1;
    return `This is small panel ${index+1} in the ${top?'lower':'upper'} ${small%2?'left':'right'}${small>1?`, auxiliary row ${Math.floor(small/2)+1}`:''} of the page.`;
  }
  if(focus!==undefined)return `This is the ${index===focus?'large main':'smaller auxiliary'} panel ${index+1} in the ${positions[index]??`row ${Math.floor(index/2)+1}, ${index%2?'left':'right'} side`} of the page.`;
  // An absent layout means a natural sequence, not an invented final hero panel.
  return `This is panel ${index+1} in the ${positions[index]??`row ${Math.floor(index/2)+1}, ${index%2?'left':'right'} side`} of the page.`;
}
