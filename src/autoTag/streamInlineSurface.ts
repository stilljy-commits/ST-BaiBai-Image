/** Display surfaces owned by one message. Tavern Helper keeps a hidden
 * .mes_text source and mounts its visible streaming projection beside it. */
export function inlineDisplayRoots(root: HTMLElement): HTMLElement[] {
  const siblings=root.parentElement ? [...root.parentElement.children] : [root];
  return siblings.filter((element):element is HTMLElement=>element===root||element.matches('.TH-streaming,.mes_streaming'));
}

const ignored='code,pre,script,style,textarea,summary,.stthink-root,.mes_reasoning,[data-bbi-live-preview]';
const observedAttributes=['open','hidden','aria-hidden','style','class','src','srcdoc'];
export const inlineObserverOptions:MutationObserverInit={childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:observedAttributes};
const readingInputs=['wheel','touchstart','pointerdown','keydown'] as const;
export function inlineReadingInput(target:EventTarget,listener:EventListener,enabled:boolean):void{
  for(const event of readingInputs)if(enabled)target.addEventListener(event,listener,{capture:true,passive:true});else target.removeEventListener(event,listener,{capture:true});
}

/** Includes ancestors outside the selected surface and the embedding frame.
 * Our hidden marker remains readable so host redraws can reuse the same image. */
export function inlineElementReadable(element:Element|null,cache=new Map<Element,boolean>()):boolean {
  if(!element)return true;
  const cached=cache.get(element);if(cached!==undefined)return cached;
  const marker=element.hasAttribute('data-bbi-live-marker');
  const style=marker?null:element.ownerDocument.defaultView?.getComputedStyle(element);
  let visible=!element.matches(ignored)&&(!element.matches('details')||element.hasAttribute('open'))&&
    (marker||(!element.hasAttribute('hidden')&&element.getAttribute('aria-hidden')!=='true'&&style?.display!=='none'&&style?.visibility!=='hidden'));
  if(visible&&element.parentElement)visible=inlineElementReadable(element.parentElement,cache);
  else if(visible){
    try {const frame=element.ownerDocument.defaultView?.frameElement;if(frame)visible=inlineElementReadable(frame,cache);}catch{return false;}
  }
  cache.set(element,visible);return visible;
}

function frameDocument(frame:HTMLIFrameElement):Document|null {
  // Access only documents already allowed by the browser's same-origin policy.
  // Never fetch frame sources, change sandboxing, or inject bridge scripts.
  try{return frame.contentDocument;}catch{return null;}
}

export function inlineFrames(roots:HTMLElement[]):Map<HTMLIFrameElement,Document|null>{
  const result=new Map<HTMLIFrameElement,Document|null>(),seen=new Set<Document>();
  const visit=(root:HTMLElement,depth:number)=>{
    if(depth>4)return;
    for(const element of root.querySelectorAll<HTMLIFrameElement>('iframe')){
      if(result.has(element)||element.closest(ignored))continue;
      const doc=frameDocument(element);result.set(element,doc);
      if(doc?.documentElement&&!seen.has(doc)){seen.add(doc);visit(doc.documentElement,depth+1);}
    }
  };
  roots.forEach(root=>visit(root,0));return result;
}

export interface InlineTextRun {node:Text;start:number;end:number;}
/** Walk in rendered order, including same-origin story frames. Code blocks,
 * hidden source copies and closed thought viewers never become scene anchors. */
export function inlineTextRuns(roots:HTMLElement[]):{text:string;runs:InlineTextRun[]}{
  let text='';const runs:InlineTextRun[]=[],visibility=new Map<Element,boolean>(),seen=new Set<Document>();
  const visit=(root:HTMLElement,depth:number)=>{
    if(depth>4||!inlineElementReadable(root,visibility))return;
    const walker=root.ownerDocument.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT,{
      acceptNode(node){return inlineElementReadable(node.nodeType===Node.ELEMENT_NODE?node as Element:node.parentElement,visibility)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;},
    });
    for(let node=walker.nextNode();node;node=walker.nextNode()){
      if(node.nodeType===Node.TEXT_NODE){
        const value=node.textContent??'';runs.push({node:node as Text,start:text.length,end:text.length+value.length});text+=value;
      }else if((node as Element).tagName==='IFRAME'){
        const doc=frameDocument(node as HTMLIFrameElement);
        if(doc?.documentElement&&!seen.has(doc)){seen.add(doc);text+='\n';visit(doc.documentElement,depth+1);text+='\n';}
      }
    }
  };
  roots.forEach(root=>visit(root,0));return {text,runs};
}

/** Observe frame loads as well as their inner DOM. Parent MutationObservers do
 * not see frame document changes. Every watcher is released on navigation,
 * projection replacement, cancellation or final handoff. No polling is used. */
export class InlineFrameObservers {
  private frames=new Map<HTMLIFrameElement,{document:Document|null;observer:MutationObserver|null;load:()=>void}>();
  constructor(private changed:()=>void,private reading:EventListener=()=>{}){}
  sync(roots:HTMLElement[]):HTMLElement[]{
    const current=inlineFrames(roots);
    for(const[frame,watch]of this.frames)if(!current.has(frame)){this.release(watch);frame.removeEventListener('load',watch.load);this.frames.delete(frame);}
    for(const[frame,doc]of current){
      let watch=this.frames.get(frame);
      if(!watch){watch={document:null,observer:null,load:()=>this.changed()};this.frames.set(frame,watch);frame.addEventListener('load',watch.load);}
      if(watch.document!==doc){
        this.release(watch);watch.document=doc;watch.observer=null;
        if(doc){watch.observer=new MutationObserver(()=>this.changed());watch.observer.observe(doc,inlineObserverOptions);inlineReadingInput(doc,this.reading,true);}
      }
    }
    return [...roots,...[...current.values()].flatMap(doc=>doc?.documentElement?[doc.documentElement]:[])];
  }
  /** Auto-sized helper frames adjust their outer height one animation frame
   * after inner images resize. Keep bottom following through that delay. */
  resizing():boolean{
    for(const[frame,watch]of this.frames){
      const doc=watch.document,body=doc?.body;if(!body||!inlineElementReadable(frame))continue;
      const view=doc.defaultView;
      if((view?.getComputedStyle(body).overflowY==='hidden'||view?.getComputedStyle(doc.documentElement).overflowY==='hidden')&&Math.abs(body.scrollHeight-frame.clientHeight)>2)return true;
    }
    return false;
  }
  private release(watch:{document:Document|null;observer:MutationObserver|null}){watch.observer?.disconnect();if(watch.document)inlineReadingInput(watch.document,this.reading,false);}
  drain(){for(const watch of this.frames.values())watch.observer?.takeRecords();}
  clear(){for(const[frame,watch]of this.frames){this.release(watch);frame.removeEventListener('load',watch.load);}this.frames.clear();}
}

/** Translate frame-local positions into chat viewport coordinates. Tavern
 * Helper auto-sizes its frames, so the reader continues scrolling the chat. */
export function inlineRect(node:HTMLElement,document:Document):{top:number;bottom:number;height:number}|null{
  let rect=node.getBoundingClientRect(),top=rect.top,bottom=rect.bottom,doc=node.ownerDocument;
  for(let depth=0;doc!==document&&depth<5;depth++){
    let frame:Element|null;try{frame=doc.defaultView?.frameElement??null;}catch{return null;}
    if(!frame)return null;
    const host=frame as HTMLElement,outer=host.getBoundingClientRect(),scale=host.offsetHeight?outer.height/host.offsetHeight:1;
    top=outer.top+(host.clientTop+top)*scale;bottom=outer.top+(host.clientTop+bottom)*scale;doc=host.ownerDocument;
  }
  return doc===document?{top,bottom,height:bottom-top}:null;
}

export function* inlineReadingBlocks(chat:HTMLElement,onlyFloor?:string):Generator<{node:HTMLElement;floor:string}>{
  const visible=new Map<Element,boolean>();
  const viewport=chat.getBoundingClientRect();
  for(const source of chat.querySelectorAll<HTMLElement>('.mes_text')){
    const message=source.closest('[mesid]'),floor=message?.getAttribute('mesid');if(!floor||(onlyFloor&&floor!==onlyFloor))continue;
    // Do not inspect iframe DOMs in off-screen history just to remember the
    // current paragraph. Restoration searches its known floor even if shifted.
    if(!onlyFloor){const rect=message!.getBoundingClientRect();if(rect.bottom<=viewport.top||rect.top>=viewport.bottom)continue;}
    const roots=inlineDisplayRoots(source),frames=inlineFrames(roots);
    for(const root of [...roots,...[...frames.values()].flatMap(doc=>doc?.body?[doc.body]:[])]){
      if(!inlineElementReadable(root,visible))continue;
      for(const node of root.querySelectorAll<HTMLElement>('p,li,blockquote,h1,h2,h3'))if(inlineElementReadable(node,visible))yield{node,floor};
    }
  }
}
