import * as pdfjs from './vendor/pdf.mjs';
import {fitScale,clamp} from './reader-core.mjs';

// Page shells stay in the document; only nearby pages retain a canvas and text layer.
export class ContinuousReader {
  constructor(pane,onMount){this.pane=pane;this.root=pane.el.querySelector('.page-space');this.onMount=onMount;this.entries=[];this.version=0;}
  async open(){
    this.destroy();const version=this.version,doc=this.pane.doc;
    const first=await doc.getPage(1);if(version!==this.version)return;
    this.root.replaceChildren();
    for(let n=1;n<=doc.numPages;n++){
      const shell=document.createElement('section');shell.className='page-shell';shell.setAttribute('aria-label',`第 ${n} 页`);
      const label=document.createElement('div');label.className='page-caption';label.textContent=`第 ${n} 页`;
      const el=document.createElement('div');el.className='pdf-page';el.dataset.page=n;
      shell.append(label,el);this.root.append(shell);this.entries.push({n,shell,el,proxy:n===1?first:null,base:first,revision:0});
    }
    this.layout(false);this.move(this.pane.page,0);await this.paint();
    // Discover mixed page sizes without allocating all page canvases.
    this.metadataTask=(async()=>{
      for(let start=1;start<doc.numPages;start+=12){
        const group=this.entries.slice(start,start+12);
        await Promise.all(group.map(async entry=>{try{const page=await doc.getPage(entry.n);if(version===this.version){entry.proxy=page;entry.base=page;}}catch{}}));
        if(version!==this.version)return;
      }
      if(version===this.version){this.layout(true);this.paint();}
    })();
  }
  layout(preserve=true){
    if(!this.entries.length)return;
    const p=this.pane,anchor=preserve?(this.pendingAnchor||this.position()):{page:p.page,fraction:0};
    const inset=innerWidth<=760?32:48;
    for(const e of this.entries){
      const rotation=(e.base.rotate+p.rotation)%360,base=e.base.getViewport({scale:1,rotation});
      const scale=fitScale(p.zoom,Math.max(100,p.viewport.clientWidth-inset),Math.max(100,p.viewport.clientHeight-inset-24),base.width,base.height);
      const vp=e.base.getViewport({scale,rotation});
      if(!e.viewport||Math.abs(e.viewport.width-vp.width)>.1||Math.abs(e.viewport.height-vp.height)>.1||e.viewport.rotation!==rotation){
        this.release(e);e.viewport=vp;e.el.style.width=`${vp.width}px`;e.el.style.height=`${vp.height}px`;
        e.el.style.setProperty('--scale-factor',scale);e.el.style.setProperty('--total-scale-factor',scale*e.base.userUnit);e.el.style.setProperty('--user-unit',e.base.userUnit);e.el.style.setProperty('--scale-round-x','1px');e.el.style.setProperty('--scale-round-y','1px');
      }
    }
    this.move(anchor.page,anchor.fraction);p.actualScale=this.entries[p.page-1]?.viewport.scale||1;
  }
  position(){
    if(!this.pane.el.clientWidth)return this.pendingAnchor||{page:this.pane.page,fraction:0};
    const y=this.pane.viewport.scrollTop+16;let found=this.entries[0];
    for(const e of this.entries){if(e.shell.offsetTop>y+1)break;found=e;}
    if(!found)return{page:1,fraction:0};
    return{page:found.n,fraction:clamp((y-found.shell.offsetTop)/(found.shell.offsetHeight+20),0,1)};
  }
  move(page,fraction=0){
    const e=this.entries[clamp(page,1,this.entries.length)-1];if(!e)return;
    if(!this.pane.el.clientWidth){this.pendingAnchor={page:e.n,fraction};this.pane.page=e.n;this.pane.update();return;}
    this.pendingAnchor=null;
    this.pane.ignoreSyncUntil=performance.now()+180;
    this.pane.viewport.scrollTop=Math.max(0,e.shell.offsetTop-16+fraction*(e.shell.offsetHeight+20));
    this.pane.page=e.n;this.pane.pageEl=e.el;this.pane.actualScale=e.viewport?.scale||1;this.pane.update();this.schedule();
  }
  schedule(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.paint();});}
  async paint(){
    const p=this.pane;if(!p.doc||!this.entries.length)return;
    const top=p.viewport.scrollTop,bottom=top+p.viewport.clientHeight;
    const visible=this.entries.filter(e=>e.shell.offsetTop+e.shell.offsetHeight>=top-250&&e.shell.offsetTop<=bottom+250);
    const retained=new Set(visible);
    for(const e of this.entries)if(!retained.has(e)&&(e.ready||e.busy))this.release(e);
    await Promise.all(visible.map(e=>this.render(e)));
  }
  async render(e){
    if(e.ready||e.busy)return;
    e.busy=true;const version=this.version,revision=e.revision,doc=this.pane.doc;
    try{
      const proxy=e.proxy||await doc.getPage(e.n);if(version!==this.version||revision!==e.revision)return;e.proxy=proxy;
      const viewport=e.viewport,canvas=document.createElement('canvas'),textDiv=document.createElement('div');textDiv.className='textLayer';
      e.el.replaceChildren(canvas,textDiv);e.el.setAttribute('aria-busy','true');
      this.onMount(e);
      const dpr=Math.min(devicePixelRatio||1,2,Math.sqrt(10000000/(viewport.width*viewport.height)));
      canvas.width=Math.ceil(viewport.width*dpr);canvas.height=Math.ceil(viewport.height*dpr);
      e.task=proxy.render({canvasContext:canvas.getContext('2d'),viewport,transform:[dpr,0,0,dpr,0,0]});await e.task.promise;
      if(version!==this.version||revision!==e.revision)return;
      e.text=new pdfjs.TextLayer({textContentSource:proxy.streamTextContent(),container:textDiv,viewport});await e.text.render();
      if(version!==this.version||revision!==e.revision)return;
      e.ready=true;e.el.setAttribute('aria-busy','false');this.pane.el.dataset.renderStatus='ready';
    }catch(err){if(version!==this.version||revision!==e.revision||['RenderingCancelledException','AbortException'].includes(err.name))return;
      const message=document.createElement('button');message.className='page-retry';message.textContent='此页加载失败，点击重试';message.onclick=()=>{this.release(e);this.render(e);};e.el.replaceChildren(message);console.warn('Page render failed',err.name);
    }finally{if(revision===e.revision)e.busy=false;}
  }
  release(e){e.revision++;e.task?.cancel();e.text?.cancel();e.task=null;e.text=null;e.ready=false;e.busy=false;e.el.replaceChildren();e.overlay=null;}
  destroy(){this.version++;cancelAnimationFrame(this.frame);this.frame=null;for(const e of this.entries)this.release(e);this.entries=[];this.root.replaceChildren();}
}
