import * as pdfjs from './vendor/pdf.mjs';
import { clamp, pageNumber, pairedPage, fitScale, scrollFraction, excerpt, fileKey, validPDF } from './reader-core.mjs';
import { storage } from './storage.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"/></svg>`;
const names = {left:'原件',right:'改件'};
const other = side => side === 'left' ? 'right' : 'left';
const state = { synced:true, offset:0, active:'left', theme:'paper', tint:false, remember:true, split:50, bookmarks:[] };
let saveTimer, toastTimer, scrollLock = '', scrollUnlock, searchToken = 0, pairBusy = false;
const modal = $('#modal');
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function dialog(title, html) {
  searchToken++;
  $('#modalContent').innerHTML = `<div class="modal-header"><h2>${title}</h2><button class="icon modal-close" aria-label="关闭">${icon('close')}</button></div><div class="modal-body">${html}</div>`;
  $('.modal-close',modal).onclick = () => modal.close();
  if(!modal.open) modal.showModal();
}
modal.addEventListener('close', () => searchToken++);
modal.addEventListener('click', e => { if(e.target === modal) { const r = modal.getBoundingClientRect(); if(e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close(); } });
function safeText(tag, text, cls) { const node=document.createElement(tag); node.textContent=text; if(cls) node.className=cls; return node; }
class Pane {
  constructor(side) {
    this.side=side; this.el=$(`#pane-${side}`); this.doc=null; this.file=null; this.page=1; this.zoom='width'; this.rotation=0; this.renderSerial=0; this.loadSerial=0; this.textCache=new Map(); this.scrollRestore=0;
    this.el.innerHTML = `<div class="pane-head"><div class="doc-identity"><span class="doc-badge">${side==='left'?'原':'改'}</span><div class="doc-text"><h2 class="doc-title">${names[side]}</h2><div class="doc-meta">${side==='left'?'ORIGINAL DOCUMENT':'REVISED DOCUMENT'}</div></div></div><div class="pane-actions"><button class="icon choose-file" title="打开${names[side]} PDF" aria-label="打开${names[side]} PDF">${icon('plus')}</button><button class="icon pane-menu-button" title="文档选项" aria-label="${names[side]}选项" hidden>${icon('more')}</button></div></div><div class="pane-viewport"><div class="empty-state"><div class="drop-card"><span class="corner-label">${side==='left'?'01 / ORIGINAL':'02 / REVISED'}</span><div class="paper-icon"></div><h2>放入${names[side]}</h2><p>${side==='left'?'最初的文字，保留原本的样子。':'翻译或修订，读见新的变化。'}</p><button class="outline choose-file">${icon('file')}选择 PDF 文件</button><span class="drop-caption">或将文件拖放至此</span></div></div><div class="page-space" hidden><div class="pdf-page"></div></div></div><div class="pane-footer"><div class="empty-footer"><span>支持扫描件与文字 PDF</span><span>等待打开</span></div><div class="page-nav" hidden><button class="icon prev" aria-label="${names[side]}上一页">${icon('chevron','flip')}</button><input class="page-input" type="number" min="1" aria-label="${names[side]}页码"><span class="page-total"></span><button class="icon next" aria-label="${names[side]}下一页">${icon('chevron')}</button></div><div class="zoom-controls" hidden><button class="icon zoom-step minus" aria-label="${names[side]}缩小">−</button><select class="zoom-select" aria-label="${names[side]}缩放"><option value="width">适合宽度</option><option value="page">整页</option>${[.5,.75,1,1.25,1.5,2,3,4].map(n=>`<option value="${n}">${n*100}%</option>`).join('')}</select><button class="icon zoom-step zoom-plus" aria-label="${names[side]}放大">${icon('plus')}</button></div></div><div class="drop-overlay">松开放入${names[side]}</div><div class="page-loading" hidden><span class="spinner"></span><span>正在打开文档</span></div>`;
    this.viewport=$('.pane-viewport',this.el); this.pageEl=$('.pdf-page',this.el); this.loading=$('.page-loading',this.el);
    $$('.choose-file',this.el).forEach(b=>b.onclick=()=>this.choose());
    $('.prev',this.el).onclick=()=>this.goto(this.page-1);
    $('.next',this.el).onclick=()=>this.goto(this.page+1);
    $('.page-input',this.el).onchange=e=>this.goto(e.target.value);
    $('.page-input',this.el).onkeydown=e=>{ if(e.key==='Enter'){e.preventDefault();this.goto(e.target.value);e.target.blur();} };
    $('.zoom-select',this.el).onchange=e=>this.setZoom(e.target.value);
    $('.minus',this.el).onclick=()=>this.stepZoom(-1);
    $('.zoom-plus',this.el).onclick=()=>this.stepZoom(1);
    $('.pane-menu-button',this.el).onclick=()=>this.menu();
    this.el.addEventListener('pointerdown',()=>setActive(side));
    this.viewport.addEventListener('scroll',()=>this.onScroll(),{passive:true});
    this.viewport.addEventListener('wheel', e=> { if(e.ctrlKey && this.doc){e.preventDefault(); this.stepZoom(e.deltaY>0?-1:1);} },{passive:false});
    let dragDepth=0;
    this.el.addEventListener('dragenter',e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();dragDepth++;this.el.classList.add('drag-over');});
    this.el.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
    this.el.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;this.el.classList.remove('drag-over');}});
    this.el.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;this.el.classList.remove('drag-over');const files=[...e.dataTransfer.files];if(files.length>1)openPair(files,side);else if(files[0])this.load(files[0]);});
    let resizeTimer; this.observer=new ResizeObserver(()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(this.doc && this.el.clientWidth && ['width','page'].includes(this.zoom))this.render(true);},180);});this.observer.observe(this.viewport);
  }
  choose(){ $(`#${this.side}Input`).click(); }
  async load(file, options={}) {
    const serial=++this.loadSerial;
    this.pendingTask?.destroy(); this.loading.hidden=false; $('.page-loading span:last-child',this.el).textContent='正在打开文档';
    try {
      if(!await validPDF(file))throw new Error('请选择有效的 PDF 文件');
      const data=new Uint8Array(await file.arrayBuffer()); if(serial!==this.loadSerial)return;
      const task=pdfjs.getDocument({data, cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,isEvalSupported:false});
      this.pendingTask=task;
      task.onPassword=(update,reason)=>this.password(update,reason,task);
      const doc=await task.promise;
      if(serial!==this.loadSerial){await doc.destroy();return;}
      this.renderTask?.cancel();this.textLayer?.cancel(); this.renderSerial++;
      const old=this.doc;this.doc=doc;this.file=file;this.page=pageNumber(options.page??1,doc.numPages);this.zoom=options.zoom||'width';this.rotation=options.rotation||0;this.textCache=new Map();this.pendingTask=null;
      old?.destroy();
      $('.doc-title',this.el).textContent=file.name;$('.doc-title',this.el).title=file.name;
      $('.doc-meta',this.el).textContent=`${names[this.side]} · ${doc.numPages} 页 · ${formatSize(file.size)}`;
      $('.empty-state',this.el).hidden=true;$('.page-space',this.el).hidden=false;$('.empty-footer',this.el).hidden=true;
      for(const q of ['.page-nav','.zoom-controls','.pane-menu-button'])$(q,this.el).hidden=false;
      this.update();updateGlobal();await this.render();
      if(options.scroll)this.viewport.scrollTop=options.scroll*(this.viewport.scrollHeight-this.viewport.clientHeight);
      if(!options.restore){state.bookmarks=[];state.offset=panes.right.page-panes.left.page;updateGlobal();await saveFile(this.side,file);saveState();}
      return true;
    } catch(e) {
      if(serial===this.loadSerial && !String(e.message).includes('destroyed'))toast(e.message==='请选择有效的 PDF 文件'?e.message:'无法打开这份 PDF，请检查文件是否完整、密码是否正确。');
      console.warn('PDF load failed',e.name);
      return false;
    } finally {if(serial===this.loadSerial)this.loading.hidden=true;}
  }
  password(update,reason,task){
    dialog('文档已加密',`<p>${reason===pdfjs.PasswordResponses.INCORRECT_PASSWORD?'密码不正确，请重新输入。':'请输入此 PDF 的打开密码。密码不会保存。'}</p><form id="passwordForm"><input class="password-input" type="password" autocomplete="off" aria-label="PDF 密码" required><div class="modal-actions"><button type="button" class="outline" id="cancelPassword">取消</button><button class="primary">打开</button></div></form>`);
    let submitted=false; const cancel=()=>{if(!submitted)task.destroy();};modal.addEventListener('close',cancel,{once:true});
    $('#passwordForm').onsubmit=e=>{e.preventDefault();submitted=true;const value=$('.password-input').value;modal.close();update(value);};
    $('#cancelPassword').onclick=()=>modal.close();$('.password-input').focus();
  }
  update(){if(!this.doc)return;$('.page-input',this.el).value=this.page;$('.page-input',this.el).max=this.doc.numPages;$('.page-total',this.el).textContent=`/ ${this.doc.numPages}`;$('.prev',this.el).disabled=this.page<=1;$('.next',this.el).disabled=this.page>=this.doc.numPages;const select=$('.zoom-select',this.el);if(![...select.options].some(o=>o.value===String(this.zoom))){select.add(new Option(`${Math.round(Number(this.zoom)*100)}%`,String(this.zoom)));}select.value=this.zoom;}
  async goto(value, propagate=true){
    if(!this.doc)return;const n=pageNumber(value,this.doc.numPages,this.page);if(n===this.page && this.el.dataset.renderStatus!=='error'){this.update();return;}const request=this.navigationSerial=(this.navigationSerial||0)+1;this.page=n;this.update();await this.render();
    if(request!==this.navigationSerial)return;
    if(propagate&&state.synced){const peer=panes[other(this.side)];if(peer.doc)await peer.goto(pairedPage(n,this.side,state.offset,peer.doc.numPages),false);}
    saveState();
  }
  async render(preserve=false){
    if(!this.doc||!this.el.clientWidth)return;
    const serial=++this.renderSerial;this.el.dataset.renderStatus='loading';this.renderTask?.cancel();this.textLayer?.cancel();
    const fraction=preserve?scrollFraction(this.viewport.scrollTop,this.viewport.scrollHeight,this.viewport.clientHeight):0;
    try{
      const page=await this.doc.getPage(this.page);if(serial!==this.renderSerial)return;
      const rotation=(page.rotate+this.rotation)%360;
      const base=page.getViewport({scale:1,rotation});const inset=window.innerWidth<=760?32:48;
      const scale=fitScale(this.zoom,Math.max(100,this.viewport.clientWidth-inset),Math.max(100,this.viewport.clientHeight-inset),base.width,base.height);
      this.actualScale=scale;const viewport=page.getViewport({scale,rotation});
      const canvas=document.createElement('canvas');const textDiv=document.createElement('div');textDiv.className='textLayer';
      this.pageEl.replaceChildren(canvas,textDiv);this.pageEl.style.width=`${viewport.width}px`;this.pageEl.style.height=`${viewport.height}px`;
      this.pageEl.style.setProperty('--scale-factor',String(scale));this.pageEl.style.setProperty('--total-scale-factor',String(scale*page.userUnit));this.pageEl.style.setProperty('--user-unit',String(page.userUnit));this.pageEl.style.setProperty('--scale-round-x','1px');this.pageEl.style.setProperty('--scale-round-y','1px');
      const dpr=Math.min(window.devicePixelRatio||1,2,Math.sqrt(14000000/(viewport.width*viewport.height)));
      canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);
      this.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:null});
      await this.renderTask.promise;if(serial!==this.renderSerial)return;
      this.textLayer=new pdfjs.TextLayer({textContentSource:page.streamTextContent(),container:textDiv,viewport});
      await this.textLayer.render();if(serial!==this.renderSerial)return;
      this.viewport.scrollTop=fraction*(this.viewport.scrollHeight-this.viewport.clientHeight);
      if(!preserve)this.viewport.scrollLeft=0;
      this.el.dataset.renderedPage=String(this.page);this.el.dataset.renderStatus='ready';
    }catch(e){if(e.name==='RenderingCancelledException'||e.name==='AbortException'||serial!==this.renderSerial)return;console.error(e);this.el.dataset.renderStatus='error';this.pageEl.replaceChildren(safeText('div','此页暂时无法显示，请重新翻页或更换 PDF。','render-error'));toast('此页显示失败，请尝试重新打开文件。');}
  }
  setZoom(zoom){this.zoom=zoom;this.update();this.render(true);saveState();}
  stepZoom(direction){this.setZoom(String(clamp(Math.round(((this.actualScale||1)+direction*.15)*100)/100,.25,4)));}
  onScroll(){
    if(!this.doc)return;
    if(scrollLock && scrollLock!==this.side)return;
    saveState();if(!state.synced)return;const peer=panes[other(this.side)];if(!peer.doc)return;
    scrollLock=this.side;clearTimeout(scrollUnlock);
    const fraction=scrollFraction(this.viewport.scrollTop,this.viewport.scrollHeight,this.viewport.clientHeight);
    const h=scrollFraction(this.viewport.scrollLeft,this.viewport.scrollWidth,this.viewport.clientWidth);
    peer.viewport.scrollTop=fraction*(peer.viewport.scrollHeight-peer.viewport.clientHeight);peer.viewport.scrollLeft=h*(peer.viewport.scrollWidth-peer.viewport.clientWidth);
    scrollUnlock=setTimeout(()=>scrollLock='',100);
  }
  menu(){
    dialog(`${names[this.side]}选项`,`<div id="fileNameFull" class="file-name-full"></div><div class="file-menu"><button id="replaceFile">${icon('file')}更换这份 PDF</button><button id="rotateFile">${icon('rotate')}顺时针旋转 90°</button><button id="downloadFile">${icon('file')}下载当前文件</button><button id="closeFile">${icon('close')}关闭这份文档</button></div>`);
    $('#fileNameFull').textContent=this.file.name;$('#replaceFile').onclick=()=>{modal.close();this.choose();};$('#rotateFile').onclick=()=>{this.rotation=(this.rotation+90)%360;modal.close();this.render();saveState();};
    $('#downloadFile').onclick=()=>{const url=URL.createObjectURL(this.file);const a=document.createElement('a');a.href=url;a.download=this.file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);modal.close();};
    $('#closeFile').onclick=()=>{modal.close();this.clear();};
  }
  async clear(){
    this.loadSerial++;this.renderSerial++;this.pendingTask?.destroy();this.renderTask?.cancel();this.textLayer?.cancel();this.doc?.destroy();this.doc=null;this.file=null;this.page=1;this.pageEl.replaceChildren();
    $('.doc-title',this.el).textContent=names[this.side];$('.doc-title',this.el).removeAttribute('title');$('.doc-meta',this.el).textContent=this.side==='left'?'ORIGINAL DOCUMENT':'REVISED DOCUMENT';
    $('.empty-state',this.el).hidden=false;$('.empty-footer',this.el).hidden=false;
    for(const q of ['.page-space','.page-nav','.zoom-controls','.pane-menu-button'])$(q,this.el).hidden=true;
    state.offset=0;state.bookmarks=[];updateGlobal();await storage('delete',this.side).catch(()=>{});saveState();
  }
  async text(pageNo){if(this.textCache.has(pageNo))return this.textCache.get(pageNo);const page=await this.doc.getPage(pageNo);const content=await page.getTextContent();const text=content.items.map(x=>x.str+(x.hasEOL?'\n':'')).join('');this.textCache.set(pageNo,text);return text;}
}
const panes={left:new Pane('left'),right:new Pane('right')};
function formatSize(size){return size<1024*1024?`${Math.round(size/1024)} KB`:`${(size/1024/1024).toFixed(1)} MB`;}
function setActive(side){state.active=side;for(const [key,p]of Object.entries(panes)){p.el.classList.toggle('active',key===side);$(`#tab-${key}`).setAttribute('aria-selected',key===side);$(`#tab-${key}`).tabIndex=key===side?0:-1;}if(panes[side].doc&&!panes[side].pageEl.clientWidth)panes[side].render();}
function updateGlobal(){
  const both=!!panes.left.doc&&!!panes.right.doc;$('#alignBtn').disabled=!both;$('#swapBtn').disabled=!both;$('#searchBtn').disabled=!panes.left.doc&&!panes.right.doc;
  $('#syncBtn').classList.toggle('selected',state.synced);$('#syncBtn').setAttribute('aria-pressed',state.synced);$('#syncLabel').textContent=state.synced?'同步阅读':'独立阅读';
  $('#offsetLabel').hidden=!both||!state.offset;$('#offsetLabel').textContent=`右页 ${state.offset>=0?'+':''}${state.offset}`;
}
async function openPair(files,start='left'){
  if(pairBusy)return;pairBusy=true;
  try{if(files.length>2)toast('每次对读两份文件，本次打开前两份。');if(files[0])await panes[start].load(files[0]);if(files[1])await panes[other(start)].load(files[1]);state.offset=panes.right.page-panes.left.page;updateGlobal();saveState();}finally{pairBusy=false;}
}
$('#openPair').onclick=()=>{dialog('打开对照文档',`<p>分别选择原件与改件，即可开始阅读。也可以直接把文件拖到左右两栏。</p><div class="file-menu"><button class="outline" id="chooseOriginal">${icon('file')}选择左侧原件</button><button class="outline" id="chooseRevised">${icon('file')}选择右侧改件</button></div><div class="modal-actions"><button class="primary" id="chooseBoth">同时选择两份 PDF</button></div><p class="error-details">同时选择时按文件列表顺序放入，打开后可交换左右。</p>`);$('#chooseOriginal').onclick=()=>{modal.close();panes.left.choose();};$('#chooseRevised').onclick=()=>{modal.close();panes.right.choose();};$('#chooseBoth').onclick=()=>{modal.close();$('#pairInput').click();};};
$('#pairInput').onchange=e=>{openPair([...e.target.files]);e.target.value='';};
for(const side of ['left','right']){$(`#${side}Input`).onchange=e=>{if(e.target.files[0])panes[side].load(e.target.files[0]);e.target.value='';};$(`#tab-${side}`).onclick=()=>{setActive(side);panes[side].render(true);};}
$('#syncBtn').onclick=()=>{state.synced=!state.synced;if(state.synced)state.offset=panes.right.page-panes.left.page;updateGlobal();saveState();toast(state.synced?'已按当前两页同步，翻页与滚动会联动。':'已切换为独立阅读，可分别定位两份文件。');};
$('#alignBtn').onclick=()=>{state.offset=panes.right.page-panes.left.page;state.synced=true;updateGlobal();saveState();toast(`已对齐原件第 ${panes.left.page} 页与改件第 ${panes.right.page} 页。`);};
$('#swapBtn').onclick=async()=>{const a=snapshotPane(panes.left),b=snapshotPane(panes.right),af=panes.left.file,bf=panes.right.file;state.offset=-state.offset;state.bookmarks=state.bookmarks.map(x=>({...x,left:x.right,right:x.left}));await panes.left.load(bf,{...b,restore:true});await panes.right.load(af,{...a,restore:true});await Promise.all([saveFile('left',bf),saveFile('right',af)]);updateGlobal();saveState();toast('已交换左右文件。');};
function setTheme(theme){state.theme=theme;document.documentElement.dataset.theme=theme;$('#themeName').textContent={light:'白昼',paper:'暖纸',dark:'墨夜'}[theme];$$('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.themeChoice===theme));document.querySelector('meta[name=theme-color]').content={light:'#f5f6f7',paper:'#f4f2ed',dark:'#1c201e'}[theme];saveState();}
$('#themeBtn').onclick=()=>{const hidden=!$('#themeMenu').hidden;$('#themeMenu').hidden=hidden;$('#themeBtn').setAttribute('aria-expanded',!hidden);};
$$('[data-theme-choice]').forEach(b=>b.onclick=()=>setTheme(b.dataset.themeChoice));
$('#tintPages').onchange=e=>{state.tint=e.target.checked;document.body.classList.toggle('tint-pages',state.tint);saveState();};
document.addEventListener('click',e=>{if(!e.target.closest('.popover-wrap')){$('#themeMenu').hidden=true;$('#themeBtn').setAttribute('aria-expanded',false);}});
function focusMode(){const focused=document.body.classList.toggle('focused');$('#focusBtn').setAttribute('aria-pressed',focused);$('#focusBtn').setAttribute('aria-label',focused?'退出专注阅读':'专注阅读');}
$('#focusBtn').onclick=focusMode;
function setSplit(percent){state.split=clamp(percent,30,70);$('#reader').style.setProperty('--split',`${state.split/(100-state.split)}fr`);$('#splitter').setAttribute('aria-valuenow',Math.round(state.split));saveState();}
$('#splitter').addEventListener('pointerdown',e=>{e.preventDefault();e.target.setPointerCapture(e.pointerId);const move=ev=>{const r=$('#reader').getBoundingClientRect();setSplit((ev.clientX-r.left)/r.width*100);};const stop=()=>{$('#splitter').removeEventListener('pointermove',move);};$('#splitter').addEventListener('pointermove',move);$('#splitter').addEventListener('pointerup',stop,{once:true});$('#splitter').addEventListener('pointercancel',stop,{once:true});});
$('#splitter').ondblclick=()=>setSplit(50);$('#splitter').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();e.stopPropagation();setSplit(e.key==='Home'?50:state.split+(e.key==='ArrowRight'?2:-2));}};
function showHelp(){dialog('读得从容',`<dl class="help-list"><dt>放入文件</dt><dd>左边原件，右边改件。支持拖放，也可以点击选择文件。扫描 PDF 可直接阅读。</dd><dt>同步对读</dt><dd>开启同步后，两边一起翻页、滚动。页数不同时会停在各自最后一页。</dd><dt>页码对齐</dt><dd>先关闭同步，各自翻到对应内容，再点击“对齐当前页”。之后会保留这段页码差。</dd><dt>放大细读</dt><dd>每边独立缩放，支持适合宽度、整页和放大。按住 Ctrl 滚轮可缩放，拖动中缝可调整左右宽度。</dd><dt>搜索复制</dt><dd>有文字层的 PDF 支持搜索和选字复制。纯扫描件没有文字层时，需先进行 OCR。</dd><dt>阅读外观</dt><dd>白昼、暖纸和墨夜三种主题。默认保留文件原色；启用“页面跟随阅读主题”会改变屏幕显示色彩。</dd><dt>快捷键</dt><dd>← → 翻页，F 专注，B 保存当前对照页，Ctrl+F 搜索。先点一侧即可选择操作对象。</dd></dl><p>文件在当前浏览器处理，不会上传。阅读记录可以保存在本机，也可以随时清除。手机可在“原件 / 改件”之间切换。</p>`);}
$$('.help-open').forEach(b=>b.onclick=showHelp);
function showSearch(){
  if(!panes.left.doc&&!panes.right.doc)return;
  dialog('查找文字',`<form id="searchForm" class="search-form"><input id="searchQuery" type="search" placeholder="输入要查找的字词" aria-label="搜索关键词" required><button class="primary">查找</button></form><div class="search-scope"><label><input type="radio" name="scope" value="both" checked>两份文件</label><label><input type="radio" name="scope" value="left">原件</label><label><input type="radio" name="scope" value="right">改件</label></div><div class="search-status" id="searchStatus">支持文字 PDF；扫描图片需先 OCR。</div><div class="search-results" id="searchResults"></div>`);
  $('#searchQuery').focus();$('#searchForm').onsubmit=async e=>{
    e.preventDefault();const query=$('#searchQuery').value.trim();if(!query)return;const token=++searchToken;const scope=$('input[name=scope]:checked').value;const results=$('#searchResults'),status=$('#searchStatus');results.replaceChildren();let count=0,hasText=false,failed=0;
    for(const side of ['left','right']){const p=panes[side];if(!p.doc||(scope!=='both'&&scope!==side))continue;const doc=p.doc;
      for(let i=1;i<=doc.numPages;i++){if(token!==searchToken||doc!==p.doc)return;status.textContent=`正在查找${names[side]} ${i} / ${doc.numPages} 页…`;
        let text;try{text=await p.text(i);}catch{failed++;continue;}if(token!==searchToken)return;if(text.trim())hasText=true;const hit=excerpt(text,query);
        if(hit){count++;const b=safeText('button','', 'search-result');b.append(safeText('strong',`${names[side]} · 第 ${i} 页`));const snippet=document.createElement('span');snippet.append(document.createTextNode(hit.before),safeText('mark',hit.match),document.createTextNode(hit.after));b.append(snippet);b.onclick=()=>{modal.close();setActive(side);p.goto(i);};results.append(b);}
        if(i%8===0)await new Promise(r=>setTimeout(r,0));if(count>=200)break;
      }if(count>=200)break;
    }
    if(token!==searchToken)return;status.textContent=!hasText?'未找到可搜索的文字层。这份文件可能需要先做 OCR。':count?`${count>=200?'已显示前 200':`找到 ${count}`} 个匹配页面，点击可跳转。`:'未找到匹配文字。';if(failed)status.textContent+=` ${failed} 页未能读取。`;
  };
}
$('#searchBtn').onclick=showSearch;
function snapshotPane(p){return{page:p.page,zoom:p.zoom,rotation:p.rotation,scroll:scrollFraction(p.viewport.scrollTop,p.viewport.scrollHeight,p.viewport.clientHeight),key:p.file?fileKey(p.file):null};}
function saveState(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{const data={...state,left:state.remember?snapshotPane(panes.left):null,right:state.remember?snapshotPane(panes.right):null,bookmarks:state.remember?state.bookmarks:[]};try{localStorage.setItem('duizhao-settings',JSON.stringify(data));}catch{$('#storageLabel').textContent='本次阅读 · 无法保存进度';}},250);}
async function saveFile(side,file){if(!state.remember)return;try{await storage('put',side,{blob:file,name:file.name,lastModified:file.lastModified});$('#storageLabel').textContent='文件与进度仅保存在本机';}catch{$('#storageLabel').textContent='文件仅在本次阅读中保留';toast('浏览器未能保存文件，刷新后请重新打开。');}}
function addBookmark(){if(!panes.left.doc&&!panes.right.doc)return;const entry={left:panes.left.page,right:panes.right.page};if(state.bookmarks.some(x=>x.left===entry.left&&x.right===entry.right)){toast('这组对照页已保存。');return;}state.bookmarks.push(entry);saveState();toast(`已保存对照页 ${entry.left} / ${entry.right}，可在阅读记录中查看。`);}
function showSession(){
  dialog('阅读记录',`<div class="storage-option"><label class="checkbox"><input type="checkbox" id="rememberFiles" ${state.remember?'checked':''}>在本机记住文件与阅读进度</label><p>仅此浏览器可用。清除浏览器数据后，需重新选择文件。</p></div><button class="outline" id="bookmarkCurrent">${icon('bookmark')}保存当前对照页</button><div id="bookmarks" class="bookmarks-list"></div><div class="modal-actions"><button class="quiet" id="clearStored">清除本机记录</button><button class="primary" id="sessionDone">完成</button></div>`);
  $('#rememberFiles').onchange=async e=>{state.remember=e.target.checked;if(state.remember){for(const side of ['left','right'])if(panes[side].file)await saveFile(side,panes[side].file);}else{await storage('clear').catch(()=>{});$('#storageLabel').textContent='文件仅在本次阅读中保留';}saveState();};
  $('#bookmarkCurrent').onclick=()=>{addBookmark();drawBookmarks();};$('#clearStored').onclick=async()=>{await storage('clear').catch(()=>{});state.remember=false;state.bookmarks=[];try{localStorage.removeItem('duizhao-settings');}catch{}$('#rememberFiles').checked=false;drawBookmarks();saveState();$('#storageLabel').textContent='已清除记录 · 当前文件仍可阅读';toast('本机保存的文件与对照页已清除。');};$('#sessionDone').onclick=()=>modal.close();drawBookmarks();
}
function drawBookmarks(){const list=$('#bookmarks');list.replaceChildren();if(!state.bookmarks.length){list.append(safeText('p','尚未保存对照页。'));return;}state.bookmarks.forEach((b,i)=>{const row=safeText('div','','bookmark-row'),go=safeText('button',`原件 ${b.left} 页 · 改件 ${b.right} 页`),remove=safeText('button','×');remove.setAttribute('aria-label','删除此对照页');go.onclick=()=>{state.offset=b.right-b.left;panes.left.goto(b.left,false);panes.right.goto(b.right,false);updateGlobal();modal.close();saveState();};remove.onclick=()=>{state.bookmarks.splice(i,1);saveState();drawBookmarks();};row.append(go,remove);list.append(row);});}
$('#sessionBtn').onclick=showSession;
$('#demoBtn').onclick=async()=>{if(panes.left.doc||panes.right.doc){dialog('打开试读示例',`<p>示例会替换当前两份文档。您可以随时重新打开自己的文件。</p><div class="modal-actions"><button class="outline" id="cancelDemo">取消</button><button class="primary" id="confirmDemo">打开示例</button></div>`);$('#cancelDemo').onclick=()=>modal.close();$('#confirmDemo').onclick=()=>{modal.close();loadDemo();};}else await loadDemo();};
async function loadDemo(){try{const files=await Promise.all(['original','revised'].map(async(type,i)=>{const response=await fetch(`./samples/${type}.pdf`);if(!response.ok)throw Error('demo');return new File([await response.blob()],`对照阅读示例_${i?'改件':'原件'}.pdf`,{type:'application/pdf',lastModified:1});}));await openPair(files);toast('已打开 3 页试读示例，可试用翻页、搜索和主题。');}catch{toast('示例暂时无法打开，请直接选择您的 PDF。');}}
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('#themeMenu').hidden=true;$('#themeBtn').setAttribute('aria-expanded',false);if(!modal.open&&document.body.classList.contains('focused'))focusMode();return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='f'){if(panes.left.doc||panes.right.doc){e.preventDefault();showSearch();}return;}
  if(modal.open||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.target.isContentEditable||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const p=panes[state.active];p.goto(p.page+(e.key==='ArrowRight'?1:-1));}
  if(e.key.toLowerCase()==='f')focusMode();if(e.key.toLowerCase()==='b')addBookmark();
});
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
async function restore(){
  let saved;try{saved=JSON.parse(localStorage.getItem('duizhao-settings')||'null');}catch{}
  if(saved){for(const k of ['synced','offset','remember','tint','bookmarks'])if(saved[k]!==undefined)state[k]=saved[k];if(['paper','light','dark'].includes(saved.theme))setTheme(saved.theme);setSplit(Number(saved.split)||50);state.bookmarks=Array.isArray(state.bookmarks)?state.bookmarks:[];$('#tintPages').checked=state.tint;document.body.classList.toggle('tint-pages',state.tint);}
  if(state.remember){let any=false;for(const side of ['left','right'])try{const entry=await storage('get',side);if(entry?.blob){const file=new File([entry.blob],entry.name,{type:'application/pdf',lastModified:entry.lastModified||0});await panes[side].load(file,{...(saved?.[side]||{}),restore:true});any=true;}}catch{state.remember=false;}if(any){$('#storageLabel').textContent='已恢复上次阅读 · 仅本机保存';toast('已回到上次阅读的位置。');}}
  updateGlobal();saveState();
}
await restore();
