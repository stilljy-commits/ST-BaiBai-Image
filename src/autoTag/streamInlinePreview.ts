import { MARKER_REGEX_SOURCE } from './markerSyntax';
import { onChatMutation } from '@/floor/chatObserver';

export interface InlinePreviewItem {
  id: string; ordinal: number; raw: string; url: string;
  dimensions?: { width: number; height: number };
}
export interface InlinePreviewSnapshot {
  chat: HTMLElement; root: HTMLElement; markers: string[]; items: InlinePreviewItem[];
  maxHeight: number | null;
}
interface RecordEntry { host: HTMLElement; marker?: HTMLElement; image: HTMLImageElement; url: string; loaded: boolean; failed: boolean; }
interface ReadingAnchor { floor: string; tag: string; key: string; occurrence: number; top: number; }
const PREVIEW = '[data-bbi-live-preview]';
const ignored = 'code,pre,script,style,textarea,details,summary,' + PREVIEW;
const blocks = '.mes_text p,.mes_text li,.mes_text blockquote,.mes_text h1,.mes_text h2,.mes_text h3';
const textKey = (element: Element) => (element.textContent ?? '').replace(/\s+/g,' ').trim();

/** Match the rendered text to the ENTIRE eligible marker sequence. Ambiguous or
 * transformed markers fail closed; they keep the existing floating/final path.
 */
export function inlineMarkerRanges(root: HTMLElement, expected: string[]): Range[] | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs: {node: Text; start: number; end: number}[] = []; let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(ignored)) continue;
    runs.push({node:node as Text,start:text.length,end:text.length+(node.textContent?.length ?? 0)});
    text += node.textContent ?? '';
  }
  const matches = [...text.matchAll(new RegExp(MARKER_REGEX_SOURCE,'g'))];
  if (matches.length !== expected.length || matches.some((match,i)=>match[0]!==expected[i])) return null;
  return matches.map(match=>{
    const start=match.index!,end=start+match[0].length;
    const first=runs.find(run=>run.end>start)!,last=runs.find(run=>run.end>=end)!;
    const range=root.ownerDocument.createRange();range.setStart(first.node,start-first.start);range.setEnd(last.node,end-last.start);
    return range;
  });
}
function anchor(chat: HTMLElement): ReadingAnchor | undefined {
  const top=chat.getBoundingClientRect().top,bottom=top+chat.clientHeight;
  const seen=new Map<string,number>();
  for(const node of chat.querySelectorAll<HTMLElement>(blocks)){
    if(node.closest(PREVIEW))continue;
    const key=textKey(node),floor=node.closest('[mesid]')?.getAttribute('mesid');if(!key||!floor)continue;
    const identity=floor+'|'+node.tagName+'|'+key,occurrence=seen.get(identity)??0;seen.set(identity,occurrence+1);
    const rect=node.getBoundingClientRect();
    if(rect.height&&rect.bottom>top+8&&rect.top<bottom)return {floor,tag:node.tagName,key,occurrence,top:rect.top};
  }
}
function restore(chat:HTMLElement,reading:ReadingAnchor|undefined,follow:boolean){
  if(follow){chat.scrollTop=chat.scrollHeight;return;}
  if(!reading)return;let occurrence=0;
  for(const node of chat.querySelectorAll<HTMLElement>(blocks)){
    if(node.tagName!==reading.tag||node.closest('[mesid]')?.getAttribute('mesid')!==reading.floor||textKey(node)!==reading.key)continue;
    if(occurrence++!==reading.occurrence)continue;
    const delta=node.getBoundingClientRect().top-reading.top;if(Number.isFinite(delta)&&Math.abs(delta)>.5)chat.scrollTop+=delta;
    break;
  }
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
  private chat:HTMLElement|null=null;
  private reading?:ReadingAnchor;
  private follow=true;
  private disposed=false;
  private handingOff=false;
  private refreshing=false;
  private shown='';
  private unsubscribe:()=>void;
  private scroll=()=>{
    // A host rewrite can clamp scrollTop temporarily; keep the last valid anchor
    // until the images have been restored, instead of recording that collapse.
    if([...this.records.values()].some(record=>record.marker&&!record.host.isConnected))return;
    this.remember();
  };
  constructor(private read:()=>InlinePreviewSnapshot|null,private changed:()=>void=()=>{},private open?:(item:InlinePreviewItem)=>void){
    this.unsubscribe=onChatMutation(()=>this.refresh());
  }
  has(id:string):boolean{const record=this.records.get(id);return !!record&&!!this.root?.contains(record.host);}
  private remember(){
    if(!this.chat)return;
    this.follow=this.chat.scrollHeight-this.chat.scrollTop-this.chat.clientHeight<48;
    this.reading=this.follow?undefined:anchor(this.chat);
  }
  private remove(record:RecordEntry){
    // A host DOM patcher may repurpose an existing span for new prose. Preserve
    // any light-DOM children it added, rather than deleting that prose with it.
    record.host.replaceWith(...record.host.childNodes);
    if(record.marker?.isConnected)record.marker.replaceWith(...record.marker.childNodes);
    record.marker=undefined;
  }
  private notify(){
    const shown=[...this.records].filter(([,record])=>record.host.isConnected).map(([id])=>id).join('|');
    if(shown!==this.shown){this.shown=shown;this.changed();}
  }
  refresh():void{
    if(this.disposed||this.handingOff||this.refreshing)return;this.refreshing=true;
    try{
      const snapshot=this.read();
      if(!snapshot){this.clear();return;}
      if(this.chat!==snapshot.chat){this.chat?.removeEventListener('scroll',this.scroll);this.chat=snapshot.chat;this.chat.addEventListener('scroll',this.scroll,{passive:true});this.remember();}
      if(this.root!==snapshot.root){
        this.observer?.disconnect();this.root=snapshot.root;
        this.observer=new MutationObserver(()=>this.refresh());
        this.observer.observe(this.root,{childList:true,subtree:true,characterData:true});
      }
      const detached=[...this.records.values()].some(record=>record.marker&&!record.host.isConnected);
      if(!detached)this.remember();
      const reading=this.reading,follow=this.follow;
      const wanted=new Set(snapshot.items.map(item=>item.id));
      for(const[id,record]of this.records)if(!wanted.has(id)){this.remove(record);this.records.delete(id);}
      for(const item of snapshot.items){
        const record=this.records.get(item.id);if(!record)continue;
        if(record.host.isConnected&&(!snapshot.root.contains(record.host)||!record.marker?.isConnected||record.marker.textContent!==item.raw||record.marker.nextSibling!==record.host||record.host.dataset.bbiLivePreview!==item.id))this.remove(record);
        record.marker?.style.setProperty('display','none','important');
      }
      let ranges=inlineMarkerRanges(snapshot.root,snapshot.markers);
      if(!ranges){for(const record of this.records.values())this.remove(record);restore(snapshot.chat,reading,follow);this.remember();this.notify();return;}
      for(const item of [...snapshot.items].sort((a,b)=>b.ordinal-a.ordinal)){
        if(snapshot.markers[item.ordinal]!==item.raw)continue;
        let record=this.records.get(item.id);
        if(record&&record.url!==item.url){this.remove(record);this.records.delete(item.id);record=undefined;ranges=inlineMarkerRanges(snapshot.root,snapshot.markers);}
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
        if(!record.loaded||snapshot.root.contains(record.host))continue;
        const range=ranges?.[item.ordinal];if(!range)continue;
        const first=range.startContainer.parentElement,last=range.endContainer.parentElement;
        if(first?.closest('p,li,blockquote')!==last?.closest('p,li,blockquote'))continue;
        const marker=snapshot.root.ownerDocument.createElement('span');marker.dataset.bbiLiveMarker=item.id;marker.style.setProperty('display','none','important');
        record.host.dataset.bbiLivePreview=item.id;record.host.style.cssText='display:block!important;width:100%!important;margin:10px 0!important;overflow-anchor:none;';
        marker.append(range.extractContents());range.insertNode(marker);marker.after(record.host);record.marker=marker;
      }
      restore(snapshot.chat,reading,follow);this.remember();this.notify();
    }catch{
      // A display integration failure must never turn a successful image task
      // into an analysis/generation failure. This run falls back to final slots.
      this.disposed=true;this.unsubscribe();this.clear();
      console.warn('[柏宝绘] 本轮正文即时预览已回退，图片生成与正文结束后的插入继续运行。');
    }finally{this.observer?.takeRecords();this.refreshing=false;}
  }
  private clear(){
    for(const record of this.records.values())this.remove(record);this.records.clear();
    this.observer?.disconnect();this.observer=null;this.root=null;this.chat?.removeEventListener('scroll',this.scroll);this.chat=null;this.notify();
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
