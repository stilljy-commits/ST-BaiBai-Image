import { MARKER_REGEX_SOURCE } from './markerSyntax';
import { onChatMutation } from '@/floor/chatObserver';
import { inlineDisplayRoots, inlineElementReadable, InlineFrameObservers, inlineObserverOptions, inlineReadingBlocks, inlineReadingInput, inlineRect, inlineTextRuns } from './streamInlineSurface';

export interface InlinePreviewItem {
  id: string; ordinal: number; raw: string; url: string;
  dimensions?: { width: number; height: number };
}
export interface InlinePreviewSnapshot {
  chat: HTMLElement; root: HTMLElement; markers: string[]; items: InlinePreviewItem[];
  /** Clean host story segments, used only when a display regex removes markers. */
  anchors?: string[];
  maxHeight: number | null;
}
interface RecordEntry { host: HTMLElement; marker?: HTMLElement; image: HTMLImageElement; url: string; loaded: boolean; failed: boolean; }
interface ReadingAnchor { floor: string; tag: string; key: string; occurrence: number; top: number; }
const textKey = (element: Element) => (element.textContent ?? '').replace(/\s+/g,' ').trim();

/** Unique ordered embedding: unrelated display-only markers may be present,
 * but repeated candidates that could move a scene to another paragraph fail closed.
 */
export function inlineMarkerOrder(actual: readonly string[], expected: readonly string[]): number[] | null {
  const earliest: number[] = [];
  let cursor = 0;
  for (const marker of expected) {
    while (cursor < actual.length && actual[cursor] !== marker) cursor++;
    if (cursor === actual.length) return null;
    earliest.push(cursor++);
  }
  cursor = actual.length - 1;
  for (let index = expected.length - 1; index >= 0; index--) {
    while (cursor >= 0 && actual[cursor] !== expected[index]) cursor--;
    if (cursor !== earliest[index]) return null;
    cursor--;
  }
  return earliest;
}

export function inlineStoryText(source: string): string {
  // Only presentation syntax is removed. Story words and punctuation must still
  // match; this is not fuzzy matching, translation or a guess at paragraph order.
  return source.replace(/```[\s\S]*?```/g, '').replace(/!\[[^\]\n]*\]\([^\n)]*\)/g, '')
    .replace(/\[([^\]\n]+)\]\([^\n)]*\)/g, '$1').replace(/<[^>]*>/g, '')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
      const named: Record<string,string> = {'&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'"};
      const key=entity.toLowerCase();if(named[key]!==undefined)return named[key];
      const hex=key.startsWith('&#x'),code=parseInt(key.slice(hex?3:2,-1),hex?16:10);
      return code>0&&code<=0x10ffff?String.fromCodePoint(code):entity;
    }).replace(/(^|\n)\s{0,3}(?:#{1,6} |>{1,3} |[-+*] )/g, '$1')
    .replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
}
export const inlineAnchorText=(source:string)=>inlineStoryText(source).replace(/\s/g,'').slice(-160);
/** First match the entire unique marker sequence. If markers are hidden by a
 * display regex, each unchanged, unique prose ending can locate its own scene.
 * Ambiguous or changed text retains the floating/final path.
 */
export function inlineMarkerRanges(root: HTMLElement | HTMLElement[], expected: string[], anchors?: string[]): Array<Range|null> | null {
  const {text,runs}=inlineTextRuns(Array.isArray(root)?root:[root]);
  const matches = [...text.matchAll(new RegExp(MARKER_REGEX_SOURCE,'g'))];
  const order = inlineMarkerOrder(matches.map(match => match[0]), expected);
  const rangeAt=(start:number,end:number)=>{
    const first=runs.find(run=>run.end>start)!,last=runs.find(run=>run.end>=end)!;
    // A collapsed prose anchor can be exactly at the end of the last text node.
    const from=start===end?last:first;if(!from||!last)return null;
    if(from.node.ownerDocument!==last.node.ownerDocument)return null;
    const range=from.node.ownerDocument.createRange();range.setStart(from.node,start-from.start);range.setEnd(last.node,end-last.start);
    return range;
  };
  if(order)return order.map(index=>rangeAt(matches[index].index!,matches[index].index!+matches[index][0].length));
  if(!anchors||anchors.length!==expected.length)return null;
  // A complete but ambiguous/reordered marker set is not a hidden-marker case.
  if(expected.every(marker=>matches.filter(match=>match[0]===marker).length>=expected.filter(value=>value===marker).length))return null;
  const offsets:number[]=[];let canonical='';
  for(let i=0;i<text.length;i++)if(!/\s/.test(text[i])){offsets.push(i);canonical+=text[i];}
  let previousEnd=-1;
  const ranges=expected.map((marker,index)=>{
    const key=inlineAnchorText(anchors[index]);
    if(key.length<16)return null; // Short or repeated phrases cannot own an image.
    const at=canonical.indexOf(key);if(at<0||canonical.lastIndexOf(key)!==at)return null;
    const end=offsets[at+key.length-1]+1;
    if(end<=previousEnd)return null;
    const candidates=matches.filter(match=>match[0]===marker);
    if(candidates.length>expected.filter(value=>value===marker).length)return null;
    const adjacent=matches.find(match=>match.index!>=end&&!text.slice(end,match.index!).trim());
    if(adjacent&&adjacent[0]!==marker)return null;
    previousEnd=end;
    return adjacent?rangeAt(adjacent.index!,adjacent.index!+adjacent[0].length):rangeAt(end,end);
  });
  return ranges.some(Boolean)?ranges:null;
}
function anchor(chat: HTMLElement): ReadingAnchor | undefined {
  const top=chat.getBoundingClientRect().top,bottom=top+chat.clientHeight;
  const seen=new Map<string,number>();
  for(const {node,floor} of inlineReadingBlocks(chat)){
    const key=textKey(node);if(!key)continue;
    const identity=floor+'|'+node.tagName+'|'+key,occurrence=seen.get(identity)??0;seen.set(identity,occurrence+1);
    const rect=inlineRect(node,chat.ownerDocument);
    if(rect?.height&&rect.bottom>top+8&&rect.top<bottom)return {floor,tag:node.tagName,key,occurrence,top:rect.top};
  }
}
function restore(chat:HTMLElement,reading:ReadingAnchor|undefined,follow:boolean):boolean{
  if(follow){chat.scrollTop=chat.scrollHeight;return true;}
  if(!reading)return true;let occurrence=0;
  for(const {node,floor} of inlineReadingBlocks(chat,reading.floor)){
    if(node.tagName!==reading.tag||floor!==reading.floor||textKey(node)!==reading.key)continue;
    if(occurrence++!==reading.occurrence)continue;
    const rect=inlineRect(node,chat.ownerDocument);if(!rect)break;
    const delta=rect.top-reading.top;if(Number.isFinite(delta)&&Math.abs(delta)>.5)chat.scrollTop+=delta;
    const after=inlineRect(node,chat.ownerDocument);return !!after&&Math.abs(after.top-reading.top)<1;
  }
  // A projection can briefly be empty while its new frame document loads.
  // Retain the old paragraph until it returns or the reader moves deliberately.
  return false;
}

/** Display only. Never writes chat, regex settings, image storage, or task state.
 * The narrow observer restores reused, decoded image nodes in the same microtask
 * after host streaming HTML changes. The shared chat observer only discovers a
 * replaced/virtualized root. Our own records are drained to avoid observer loops.
 */
export class StreamInlinePreview {
  private records=new Map<string,RecordEntry>();
  private observer:MutationObserver|null=null;
  private root:HTMLElement|null=null;
  private scope:HTMLElement|null=null;
  private surfaces:HTMLElement[]=[];
  private frameObservers=new InlineFrameObservers(()=>this.refresh(),()=>this.readingInput());
  private chat:HTMLElement|null=null;
  private reading?:ReadingAnchor;
  private follow=true;
  private pendingReading?:ReadingAnchor;
  private pendingFollow=false;
  private disposed=false;
  private handingOff=false;
  private refreshing=false;
  private shown='';
  private diagnostic='';
  private unsubscribe:()=>void;
  private scroll=()=>{
    // A host rewrite can clamp scrollTop temporarily; keep the last valid anchor
    // until the images have been restored, instead of recording that collapse.
    if(this.pendingReading||this.pendingFollow||[...this.records.values()].some(record=>record.marker&&!this.contains(record.host)))return;
    this.remember();
  };
  private readingInput=()=>{this.pendingReading=undefined;this.pendingFollow=false;this.remember();};
  constructor(private read:()=>InlinePreviewSnapshot|null,private changed:()=>void=()=>{},private open?:(item:InlinePreviewItem)=>void,
    private diagnose?:(reason:string,detail:Record<string,number>)=>void){
    this.unsubscribe=onChatMutation(()=>this.refresh());
  }
  private contains(node:Node):boolean{return this.surfaces.some(root=>root.contains(node));}
  has(id:string):boolean{const record=this.records.get(id);return !!record&&this.contains(record.host)&&inlineElementReadable(record.marker?.parentElement??null);}
  private report(reason:string,detail:Record<string,number>){
    if(this.diagnostic===reason)return;this.diagnostic=reason;this.diagnose?.(reason,detail);
  }
  private remember(){
    if(!this.chat)return;
    this.follow=this.chat.scrollHeight-this.chat.scrollTop-this.chat.clientHeight<48;
    this.reading=this.follow?undefined:anchor(this.chat);
  }
  private restore(reading:ReadingAnchor|undefined,follow:boolean){
    if(!this.chat)return;
    const restored=restore(this.chat,reading,follow);
    this.pendingReading=!follow&&reading&&!restored?reading:undefined;
    this.pendingFollow=follow&&this.frameObservers.resizing();
    if(!this.pendingReading&&!this.pendingFollow)this.remember();
  }
  private remove(record:RecordEntry){
    // A host DOM patcher may repurpose an existing span for new prose. Preserve
    // any light-DOM children it added, rather than deleting that prose with it.
    record.host.replaceWith(...record.host.childNodes);
    if(record.marker?.isConnected)record.marker.replaceWith(...record.marker.childNodes);
    record.marker=undefined;
  }
  private removeCopies(){
    // Some streaming renderers clone the hidden source HTML into a projection.
    // Shadow images are not cloned; unwrap these empty copies before mapping
    // scenes, while preserving any prose the renderer put inside them.
    const owned=new Set<Node>();for(const record of this.records.values()){owned.add(record.host);if(record.marker)owned.add(record.marker);}
    for(const root of this.surfaces)for(const node of root.querySelectorAll('[data-bbi-live-preview],[data-bbi-live-marker]'))if(!owned.has(node))node.replaceWith(...node.childNodes);
  }
  private notify(){
    const shown=[...this.records].filter(([id])=>this.has(id)).map(([id])=>id).join('|');
    if(shown!==this.shown){this.shown=shown;this.changed();}
  }
  refresh():void{
    if(this.disposed||this.handingOff||this.refreshing)return;this.refreshing=true;
    try{
      const snapshot=this.read();
      if(!snapshot){this.diagnostic='';this.clear();return;}
      if(this.chat!==snapshot.chat){if(this.chat){this.chat.removeEventListener('scroll',this.scroll);inlineReadingInput(this.chat,this.readingInput,false);}this.chat=snapshot.chat;this.chat.addEventListener('scroll',this.scroll,{passive:true});inlineReadingInput(this.chat,this.readingInput,true);this.remember();}
      const scope=snapshot.root.parentElement??snapshot.root;
      if(this.root!==snapshot.root||this.scope!==scope){
        this.observer?.disconnect();this.root=snapshot.root;this.scope=scope;
        this.observer=new MutationObserver(()=>this.refresh());
        this.observer.observe(scope,inlineObserverOptions);
      }
      const roots=inlineDisplayRoots(snapshot.root);this.surfaces=this.frameObservers.sync(roots);
      const detached=[...this.records.values()].some(record=>record.marker&&!this.contains(record.host));
      if(!detached&&!this.pendingReading&&!this.pendingFollow)this.remember();
      const reading=this.pendingReading??this.reading,follow=this.pendingFollow||this.follow;
      const wanted=new Set(snapshot.items.map(item=>item.id));
      for(const[id,record]of this.records)if(!wanted.has(id)){this.remove(record);this.records.delete(id);}
      for(const item of snapshot.items){
        const record=this.records.get(item.id);if(!record)continue;
        if(record.marker&&(!this.contains(record.host)||!this.contains(record.marker)||!inlineElementReadable(record.marker.parentElement)||record.marker.dataset.bbiLiveRaw!==item.raw||record.marker.nextSibling!==record.host||record.host.dataset.bbiLivePreview!==item.id))this.remove(record);
        record.marker?.style.setProperty('display','none','important');
      }
      this.removeCopies();
      let ranges=inlineMarkerRanges(roots,snapshot.markers,snapshot.anchors);
      if(!ranges){this.report('marker-map-unavailable',{markers:snapshot.markers.length,readyImages:snapshot.items.length});for(const record of this.records.values())this.remove(record);this.restore(reading,follow);this.notify();return;}
      for(const item of [...snapshot.items].sort((a,b)=>b.ordinal-a.ordinal)){
        if(snapshot.markers[item.ordinal]!==item.raw)continue;
        let record=this.records.get(item.id);
        if(record&&record.url!==item.url){this.remove(record);this.records.delete(item.id);record=undefined;ranges=inlineMarkerRanges(roots,snapshot.markers,snapshot.anchors);}
        if(!record){
          const host=snapshot.root.ownerDocument.createElement('span');host.dataset.bbiLivePreview=item.id;
          host.style.cssText='display:block!important;width:100%!important;margin:10px 0!important;overflow-anchor:none;';
          const shadow=host.attachShadow({mode:'open'}),image=new Image();
          image.alt='已生成配图';image.style.cssText='display:block;max-width:100%;height:auto;touch-action:auto;cursor:zoom-in;border-radius:8px;';
          if(item.dimensions){image.width=item.dimensions.width;image.height=item.dimensions.height;}
          record={host,image,url:item.url,loaded:false,failed:false};this.records.set(item.id,record);shadow.append(image);
          const owned=record;
          image.onload=()=>{
            const show=()=>{if(this.disposed||this.records.get(item.id)!==owned)return;image.width=image.naturalWidth;image.height=image.naturalHeight;owned.loaded=true;this.refresh();};
            if(typeof image.decode==='function')void image.decode().then(show,()=>{if(this.disposed||this.records.get(item.id)!==owned)return;owned.failed=true;this.refresh();});
            else show();
          };
          image.onerror=()=>{if(this.disposed||this.records.get(item.id)!==owned)return;owned.failed=true;this.refresh();};
          image.onclick=()=>{if(!this.disposed&&owned.host.isConnected)this.open?.(item);};
          image.src=item.url;
        }
        record.image.style.maxHeight=snapshot.maxHeight===null?'none':snapshot.maxHeight+'px';
        record.image.style.width=snapshot.maxHeight===null?'100%':'auto';
        if(record.failed){this.remove(record);continue;}
        const range=ranges?.[item.ordinal];if(!range){this.remove(record);continue;}
        if(record.marker&&record.marker.ownerDocument!==range.startContainer.ownerDocument)this.remove(record);
        if(!record.loaded||this.contains(record.host))continue;
        const first=range.startContainer.parentElement,last=range.endContainer.parentElement;
        if(first?.closest('p,li,blockquote')!==last?.closest('p,li,blockquote'))continue;
        const marker=range.startContainer.ownerDocument!.createElement('span');marker.dataset.bbiLiveMarker=item.id;marker.dataset.bbiLiveRaw=item.raw;marker.style.setProperty('display','none','important');
        record.host.dataset.bbiLivePreview=item.id;record.host.style.cssText='display:block!important;width:100%!important;margin:10px 0!important;overflow-anchor:none;';
        marker.append(range.extractContents());range.insertNode(marker);marker.after(record.host);record.marker=marker;
      }
      const visible=[...this.records].filter(([id])=>this.has(id)).length;
      if(visible)this.report('displaying',{images:visible});
      else if([...this.records.values()].some(record=>record.failed))this.report('image-load-failed',{readyImages:snapshot.items.length});
      this.restore(reading,follow);this.notify();
    }catch{
      // A display integration failure must never turn a successful image task
      // into an analysis/generation failure. This run falls back to final slots.
      this.disposed=true;this.unsubscribe();this.clear();
      this.report('display-error',{});
      console.warn('[柏宝绘] 本轮正文即时预览已回退，图片生成与正文结束后的插入继续运行。');
    }finally{this.observer?.takeRecords();this.frameObservers.drain();this.refreshing=false;}
  }
  private clear(){
    for(const record of this.records.values())this.remove(record);this.records.clear();
    this.frameObservers.clear();this.surfaces=[];this.scope=null;this.pendingReading=undefined;this.pendingFollow=false;
    this.observer?.disconnect();this.observer=null;this.root=null;if(this.chat){this.chat.removeEventListener('scroll',this.scroll);inlineReadingInput(this.chat,this.readingInput,false);}this.chat=null;this.notify();
  }
  /** Freeze preview reattachment while the existing final writer takes over.
   * Restore the reader after real cards have reserved their image geometry. */
  beginHandoff():()=>void{
    this.remember();this.handingOff=true;const chat=this.chat;
    return ()=>{const reading=this.reading,follow=this.follow;this.dispose();if(chat)restore(chat,reading,follow);};
  }
  dispose():void{
    if(this.disposed)return;this.disposed=true;this.unsubscribe();
    const chat=this.chat;if(!this.handingOff)this.remember();const reading=this.reading,follow=this.follow;
    this.clear();if(chat)restore(chat,reading,follow);
  }
}
