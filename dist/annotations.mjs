import {storage} from './storage.mjs';
import {AnnotationHistory,clone,pdfRect,textLayout} from './annotation-core.mjs';
import {exportPDF,download} from './pdf-export.mjs';
const NS='http://www.w3.org/2000/svg';
function svg(tag,attrs={}){const el=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);return el;}
const $=s=>document.querySelector(s);
const titles={read:'阅读',highlight:'荧光',pen:'画笔',text:'文字',note:'批注',correction:'修订',select:'选择',eraser:'橡皮'};
const hints={read:'可连续滚动，也可选中文字后标记。',highlight:'在纸面拖出荧光区域；扫描件也适用。',pen:'在纸面自由涂画，按住空格可临时滚动。',text:'点击或拖出文字框，再输入内容。',note:'点击或拖出批注框，添加可导出的说明。',correction:'框选要修订的区域，覆盖后写入新文字。原文字层仍保留。',select:'点击已有标记，可修改内容或删除。',eraser:'点击已有批注或笔迹即可擦除；可撤销。'};
export class AnnotationEditor {
  constructor(panes,state,{dialog,toast,modal,setActive}){
    Object.assign(this,{panes,state,dialog,toast,modal,setActive});this.documents=new Map();this.tool='read';this.color='#303a34';this.width=2;this.fontSize=12;this.attachSerial={left:0,right:0};
    const toolbar=document.createElement('section');toolbar.id='annotationToolbar';toolbar.className='annotation-toolbar';toolbar.hidden=true;toolbar.setAttribute('aria-label','批注工具');
    toolbar.innerHTML=`<div class="annotation-controls"><span class="annotation-target" id="annotationTarget">原件 · 0 条批注</span><div class="annotation-tools" role="group" aria-label="选择批注工具">${Object.entries(titles).map(([key,title])=>`<button class="tool annotation-tool" data-tool="${key}" aria-pressed="${key==='read'}">${title}</button>`).join('')}</div><label class="color-control">颜色 <input id="annotationColor" type="color" value="#303a34" aria-label="批注颜色"></label><label class="size-control">笔宽 <select id="penWidth" aria-label="画笔粗细"><option value="1">细</option><option value="2" selected>中</option><option value="4">粗</option><option value="7">特粗</option></select></label><div class="history-controls"><button class="tool" id="undoAnnotation" title="撤销（Ctrl+Z）">撤销</button><button class="tool" id="redoAnnotation" title="重做（Ctrl+Shift+Z）">重做</button></div></div><div class="annotation-hint" id="annotationHint">${hints.read}</div>`;
    $('.toolbar').after(toolbar);this.toolbar=toolbar;
    const button=document.createElement('button');button.id='editBtn';button.className='tool';button.textContent='批注工具';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','annotationToolbar');
    $('#searchBtn').before(button);
    const out=document.createElement('button');out.id='exportBtn';out.className='outline export-button';out.textContent='导出 PDF';$('#openPair').before(out);out.onclick=()=>this.exportDialog();
    button.onclick=()=>{toolbar.hidden=!toolbar.hidden;button.setAttribute('aria-expanded',!toolbar.hidden);button.classList.toggle('selected',!toolbar.hidden);if(toolbar.hidden)this.setTool('read');};
    toolbar.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>this.setTool(b.dataset.tool));
    $('#annotationColor').oninput=e=>this.color=e.target.value;$('#penWidth').onchange=e=>this.width=Number(e.target.value);
    $('#undoAnnotation').onclick=()=>this.history('undo');$('#redoAnnotation').onclick=()=>this.history('redo');
    document.addEventListener('keydown',e=>{if(this.modal.open||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();this.history(e.shiftKey?'redo':'undo');}if(e.key==='Escape')this.setTool('read');if(e.code==='Space'&&!e.repeat){document.body.classList.add('annotation-pan');}});
    document.addEventListener('keyup',e=>{if(e.code==='Space')document.body.classList.remove('annotation-pan');});window.addEventListener('blur',()=>document.body.classList.remove('annotation-pan'));
    this.selectionButton=document.createElement('button');this.selectionButton.className='selection-highlight';this.selectionButton.textContent='荧光标记';this.selectionButton.hidden=true;document.body.append(this.selectionButton);
    document.addEventListener('pointerup',()=>setTimeout(()=>this.offerSelection(),30));
    this.selectionButton.onpointerdown=e=>e.preventDefault();this.selectionButton.onclick=()=>this.highlightSelection();
    document.addEventListener('selectionchange',()=>{if(!window.getSelection()?.toString().trim())this.selectionButton.hidden=true;});
    this.refresh();
  }
  async attach(pane){
    const serial=++this.attachSerial[pane.side],key=`annotations:${pane.doc.fingerprints[0]}`;pane.annotationKey=key;
    if(!this.documents.has(key)){
      this.documents.set(key,(async()=>{let saved=[];try{if(this.state.remember){const result=await storage('get',key);if(result?.version===1&&Array.isArray(result.items))saved=result.items;}}catch{}return new AnnotationHistory(saved);})());
    }
    const history=await this.documents.get(key);if(serial!==this.attachSerial[pane.side])return;pane.annotations=history;this.refresh();
  }
  async persist(pane){if(!pane.annotations||!this.state.remember)return;const key=pane.annotationKey,items=clone(pane.annotations.items);try{await storage('put',key,{version:1,items});}catch{this.toast('批注暂未保存到本机，请及时导出 PDF。');}}
  changed(pane){for(const p of Object.values(this.panes))if(p.annotations===pane.annotations)this.redraw(p);this.persist(pane);this.refresh();}
  commit(pane,items){pane.annotations.commit(items);this.changed(pane);}
  history(action){const p=this.panes[this.state.active];if(p.annotations?.[action]())this.changed(p);}
  setTool(tool){this.tool=tool;document.body.dataset.annotationTool=tool;this.color=tool==='highlight'?'#f3cc45':'#303a34';$('#annotationColor').value=this.color;this.toolbar.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.tool===tool));$('#annotationHint').textContent=hints[tool];this.selectionButton.hidden=true;}
  refresh(){const p=this.panes[this.state.active];$('#annotationTarget').textContent=`${this.state.active==='left'?'原件':'改件'} · ${p.annotations?.items.length||0} 条批注`;$('#undoAnnotation').disabled=!p.annotations?.past.length;$('#redoAnnotation').disabled=!p.annotations?.future.length;$('#exportBtn').disabled=!this.panes.left.doc&&!this.panes.right.doc;}
  mount(pane,entry){
    const layer=svg('svg',{class:'annotation-layer',width:entry.viewport.width,height:entry.viewport.height,viewBox:`0 0 ${entry.viewport.width} ${entry.viewport.height}`});entry.overlay=layer;entry.el.append(layer);this.draw(pane,entry);
    layer.addEventListener('pointerdown',e=>this.start(e,pane,entry));
  }
  redraw(pane){for(const e of pane.scroller.entries)if(e.overlay)this.draw(pane,e);}
  draw(pane,entry,draft=null){
    if(!entry.overlay)return;entry.overlay.replaceChildren();
    const group=svg('g',{transform:`matrix(${entry.viewport.transform.join(' ')})`});entry.overlay.append(group);
    const marks=[...(pane.annotations?.items||[]).filter(m=>m.page===entry.n),...(draft?[draft]:[])];
    for(const m of marks){const g=svg('g',{'data-mark-id':m.id,class:'annotation-mark'});const title=svg('title');title.textContent=m.text||`${titles[m.type]}标记`;g.append(title);
      if(m.type==='highlight')for(const[x,y,width,height]of m.rects)g.append(svg('rect',{x,y,width,height,fill:m.color,opacity:.32}));
      else if(m.type==='pen')g.append(svg('polyline',{points:m.points.map(p=>p.join(',')).join(' '),fill:'none',stroke:m.color,'stroke-width':m.width,'stroke-linecap':'round','stroke-linejoin':'round'}));
      else{
        const[x,y,width,height]=m.rect;
        g.append(svg('rect',{x,y,width,height,fill:m.type==='correction'?'#fff':m.type==='note'?'#fff7d6':'transparent',stroke:m.type==='note'?m.color:'none','stroke-width':.7}));
        const textGroup=svg('g',{transform:`translate(${m.origin.join(' ')}) rotate(${m.rotation}) scale(1 -1)`});
        if(m.layout)for(const[i,line]of m.layout.lines.entries()){const t=svg('text',{x:m.layout.pad,y:m.layout.pad+m.layout.size+i*m.layout.size*1.4,fill:m.color,'font-size':m.layout.size,'font-family':'Annotation Sans, sans-serif'});t.textContent=line;textGroup.append(t);}
        g.append(textGroup);
      }
      group.append(g);
    }
  }
  start(event,pane,entry){
    if(this.tool==='read'||event.button!==0||document.body.classList.contains('annotation-pan'))return;
    event.preventDefault();this.setActive(pane.side);const layer=entry.overlay,tool=this.tool;
    if(tool==='select'||tool==='eraser'){const id=event.target.closest('[data-mark-id]')?.dataset.markId;if(id){if(tool==='eraser')this.commit(pane,pane.annotations.items.filter(m=>m.id!==id));else this.editMark(pane,id);}return;}
    const point=e=>{const r=layer.getBoundingClientRect();return[Math.max(0,Math.min(entry.viewport.width,(e.clientX-r.left)*entry.viewport.width/r.width)),Math.max(0,Math.min(entry.viewport.height,(e.clientY-r.top)*entry.viewport.height/r.height))];};
    const start=point(event),pdfStart=entry.viewport.convertToPdfPoint(...start);let end=start;
    let mark={id:crypto.randomUUID(),page:entry.n,type:tool,color:this.color};
    if(tool==='pen')Object.assign(mark,{points:[pdfStart,pdfStart],width:this.width/entry.viewport.scale});
    layer.setPointerCapture(event.pointerId);
    const move=e=>{end=point(e);if(tool==='pen'){mark.points.push(entry.viewport.convertToPdfPoint(...end));this.draw(pane,entry,mark);}else{const rect=pdfRect(entry.viewport,start,end);this.draw(pane,entry,{...mark,type:'highlight',rects:[rect],color:tool==='highlight'?mark.color:'#a9b5b0'});}};
    const cleanup=()=>{layer.removeEventListener('pointermove',move);layer.removeEventListener('pointerup',up);layer.removeEventListener('pointercancel',cancel);};
    const cancel=()=>{cleanup();this.draw(pane,entry);};
    const up=e=>{end=point(e);cleanup();this.draw(pane,entry);
      if(tool==='pen'){this.commit(pane,[...pane.annotations.items,mark]);return;}
      if(tool==='highlight'){if(Math.abs(end[0]-start[0])<3||Math.abs(end[1]-start[1])<3)return;mark.rects=[pdfRect(entry.viewport,start,end)];this.commit(pane,[...pane.annotations.items,mark]);return;}
      const small=Math.abs(end[0]-start[0])<5&&Math.abs(end[1]-start[1])<5;
      let a=[Math.min(start[0],end[0]),Math.min(start[1],end[1])],b=[Math.max(start[0],end[0]),Math.max(start[1],end[1])];
      if(small){b=[Math.min(a[0]+200,entry.viewport.width-4),Math.min(a[1]+90,entry.viewport.height-4)];a=[Math.max(0,b[0]-200),Math.max(0,b[1]-90)];}
      if(b[0]-a[0]<16||b[1]-a[1]<12){this.toast('请框选稍大一些的文字区域。');return;}
      Object.assign(mark,{rect:pdfRect(entry.viewport,a,b),origin:entry.viewport.convertToPdfPoint(...a),boxWidth:(b[0]-a[0])/entry.viewport.scale,boxHeight:(b[1]-a[1])/entry.viewport.scale,rotation:entry.viewport.rotation,fontSize:this.fontSize,text:''});this.editText(pane,mark,true);
    };
    layer.addEventListener('pointermove',move);layer.addEventListener('pointerup',up);layer.addEventListener('pointercancel',cancel);
  }
  editMark(pane,id){const mark=pane.annotations.items.find(m=>m.id===id);if(!mark)return;if(mark.text!==undefined){this.editText(pane,clone(mark),false);return;}
    this.dialog('编辑标记',`<label class="editor-field">标记颜色<input id="editMarkColor" type="color"></label><div class="modal-actions"><button class="outline" id="deleteMark">删除标记</button><button class="primary" id="saveMark">保存</button></div>`);$('#editMarkColor').value=mark.color;
    $('#deleteMark').onclick=()=>{this.commit(pane,pane.annotations.items.filter(m=>m.id!==id));this.modal.close();};$('#saveMark').onclick=()=>{this.commit(pane,pane.annotations.items.map(m=>m.id===id?{...m,color:$('#editMarkColor').value}:m));this.modal.close();};
  }
  editText(pane,mark,isNew){
    this.dialog(isNew?`添加${titles[mark.type]}`:'编辑批注',`<form id="annotationForm"><label class="editor-field">内容<textarea id="annotationText" rows="5" maxlength="2000" placeholder="输入中文或其他文字" required></textarea></label><div class="editor-field-row"><label class="editor-field">字号<input id="annotationFontSize" type="number" min="6" max="48" step="0.5" required></label><label class="editor-field">颜色<input id="editMarkColor" type="color"></label></div><p class="editor-explain">${mark.type==='correction'?'修订会用白底覆盖原区域并添加新文字；原文字层仍保留，不用于删除敏感信息。':'内容直接显示在页面上，并随 PDF 一起导出。'} 文字较多时会自动缩小。</p><p id="annotationError" role="alert"></p><div class="modal-actions">${!isNew?'<button type="button" class="outline" id="deleteMark">删除批注</button>':''}<button type="button" class="outline" id="cancelMark">取消</button><button class="primary" id="saveMark">保存</button></div></form>`);
    $('#annotationText').value=mark.text;$('#annotationFontSize').value=mark.fontSize;$('#editMarkColor').value=mark.color;$('#annotationText').focus();$('#cancelMark').onclick=()=>this.modal.close();
    if(!isNew)$('#deleteMark').onclick=()=>{this.commit(pane,pane.annotations.items.filter(m=>m.id!==mark.id));this.modal.close();};
    $('#annotationForm').onsubmit=async e=>{e.preventDefault();const button=$('#saveMark'),error=$('#annotationError');button.disabled=true;button.textContent='正在保存…';
      try{await document.fonts.load('12px "Annotation Sans"');if(!document.fonts.check('12px "Annotation Sans"'))throw Error('中文字体尚未加载，请重试。');
        mark.text=$('#annotationText').value.trim();if(!mark.text)throw Error('请输入批注内容。');mark.fontSize=Number($('#annotationFontSize').value);mark.color=$('#editMarkColor').value;this.fontSize=mark.fontSize;
        const context=document.createElement('canvas').getContext('2d');mark.layout=textLayout(mark,(text,size)=>{context.font=`${size}px "Annotation Sans"`;return context.measureText(text).width;});
        if(mark.layout.overflow)throw Error('这个文字框放不下全部内容，请减少文字，或重新框选更大的区域。');
        this.commit(pane,isNew?[...pane.annotations.items,mark]:pane.annotations.items.map(m=>m.id===mark.id?mark:m));this.modal.close();
      }catch(err){error.textContent=err.message;}finally{button.disabled=false;button.textContent='保存';}
    };
  }
  offerSelection(){
    if(this.tool!=='read'||this.modal.open)return;const selection=window.getSelection();if(!selection?.rangeCount||!selection.toString().trim())return;
    const range=selection.getRangeAt(0),node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const paneEl=node.closest('.pane');if(!paneEl||!node.closest('.textLayer'))return;
    const side=paneEl.dataset.side,pane=this.panes[side],end=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;if(end.closest('.pane')!==paneEl)return;
    this.selection={range:range.cloneRange(),pane};const rect=range.getBoundingClientRect();this.selectionButton.style.left=`${Math.max(8,Math.min(innerWidth-120,rect.right-80))}px`;this.selectionButton.style.top=`${Math.max(8,Math.min(innerHeight-45,rect.bottom+5))}px`;this.selectionButton.hidden=false;
  }
  highlightSelection(){const selected=this.selection;if(!selected)return;const{range,pane}=selected,items=[];
    for(const e of pane.scroller.entries){if(!e.ready)continue;const r=e.el.getBoundingClientRect(),rects=[];
      for(const box of range.getClientRects()){const x=Math.max(box.left,r.left),y=Math.max(box.top,r.top),right=Math.min(box.right,r.right),bottom=Math.min(box.bottom,r.bottom);if(right-x>1&&bottom-y>1&&box.width<r.width+1)rects.push(pdfRect(e.viewport,[x-r.left,y-r.top],[right-r.left,bottom-r.top]));}
      if(rects.length)items.push({id:crypto.randomUUID(),page:e.n,type:'highlight',color:'#f3cc45',rects});
    }
    if(items.length){this.commit(pane,[...pane.annotations.items,...items]);this.setActive(pane.side);}this.selectionButton.hidden=true;window.getSelection()?.removeAllRanges();
  }
  exportDialog(){
    this.dialog('导出带批注的 PDF',`<p>选择要导出的文件。批注、荧光与修订会写入页面；原始文件保留。</p><div class="file-menu">${['left','right'].map(side=>`<button id="export-${side}" ${!this.panes[side].doc?'disabled':''}>导出${side==='left'?'原件':'改件'} · ${this.panes[side].annotations?.items.length||0} 条批注</button>`).join('')}</div><p class="editor-explain">导出的标记固定在页面中。继续修改请在本网站打开原文件，本机保存的批注会自动恢复。</p><p id="exportStatus" role="status"></p>`);
    for(const side of['left','right'])$(`#export-${side}`).onclick=async()=>{
      const pane=this.panes[side],file=pane.file,rotation=pane.rotation,marks=clone(pane.annotations.items),status=$('#exportStatus'),buttons=this.modal.querySelectorAll('.file-menu button');buttons.forEach(b=>b.disabled=true);
      try{const blob=await exportPDF(file,marks,text=>status.textContent=text,rotation);download(blob,file.name.replace(/\.pdf$/i,'')+'_批注.pdf');status.textContent='已生成 PDF，下载已开始。';this.toast('带批注的 PDF 已导出。');}
      catch(error){status.textContent=error.message||'导出失败，请重试。';console.warn('PDF export failed',error.name);}
      finally{for(const side of['left','right']){const b=$(`#export-${side}`);if(b)b.disabled=!this.panes[side].doc;}}
    };
  }
}
