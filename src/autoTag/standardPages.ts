/** Read only a final-plan root with a complete changes prefix. Thoughts, draft
 * objects in commentary, partial strings and nested braces never dispatch work. */
export interface StandardPagePrefix { changes: unknown[]; images: unknown[]; }
function endValue(text:string,start:number):number {
  const stack:string[]=[];let quoted=false,escaped=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){quoted=true;continue;}
    if(c==='{'||c==='[')stack.push(c==='{'?'}':']');
    else if(c==='}'||c===']'){if(stack.pop()!==c)return -1;if(!stack.length)return i+1;}
  }
  return -1;
}
export function standardPagePrefix(raw:string):StandardPagePrefix|null {
  let text=raw.trimStart();
  while(/^<think(?:ing)?>/i.test(text)){
    const end=/<\/think(?:ing)?>/i.exec(text);if(!end)return null;text=text.slice(end.index+end[0].length).trimStart();
  }
  text=text.replace(/^```(?:json)?\s*/i,'');
  if(text[0]!=='{')return null;
  let at=1,changes:unknown[]|undefined;const keys=new Set<string>();
  const spaces=()=>{while(/\s/.test(text[at]??'')&&at<text.length)at++;};
  for(;;){
    spaces();const key=/^"(changes|images)"\s*:\s*/.exec(text.slice(at));if(!key||keys.has(key[1]))return null;
    keys.add(key[1]);at+=key[0].length;if(text[at]!=='[')return null;
    if(key[1]==='changes'){
      const end=endValue(text,at);if(end<0)return null;
      try{changes=JSON.parse(text.slice(at,end));}catch{return null;}
      at=end;spaces();if(text[at++]!==',')return null;continue;
    }
    if(!changes)return null;
    const images:unknown[]=[];at++;
    for(;;){
      spaces();if(text[at]===']')return {changes,images};
      if(text[at]!=='{')return {changes,images};
      const end=endValue(text,at);if(end<0)return {changes,images};
      try{images.push(JSON.parse(text.slice(at,end)));}catch{return null;}
      at=end;spaces();if(text[at]===']')return {changes,images};
      if(text[at++]!==',')return {changes,images};
    }
  }
}
