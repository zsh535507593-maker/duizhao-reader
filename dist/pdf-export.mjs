function script(src){return new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=new URL(src,import.meta.url).href;el.onload=resolve;el.onerror=()=>reject(Error('导出组件加载失败，请检查网络后重试。'));document.head.append(el);});}
let libraries;
async function loadLibraries(){if(!libraries)libraries=Promise.all([script('./vendor/pdf-lib.min.js'),script('./vendor/fontkit.umd.min.js')]).catch(e=>{libraries=null;throw e;});await libraries;return{...globalThis.PDFLib,fontkit:globalThis.fontkit};}
function rgbColor(hex,rgb){return rgb(...hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255));}
export async function drawAnnotations(doc,marks,api,font){
  const {rgb,degrees}=api,pages=doc.getPages();
  for(const m of marks){const page=pages[m.page-1];if(!page)continue;const color=rgbColor(m.color,rgb);
    if(m.type==='highlight'){for(const [x,y,width,height]of m.rects)page.drawRectangle({x,y,width,height,color,opacity:.32});}
    else if(m.type==='pen'){for(let i=1;i<m.points.length;i++)page.drawLine({start:{x:m.points[i-1][0],y:m.points[i-1][1]},end:{x:m.points[i][0],y:m.points[i][1]},thickness:m.width,color,lineCap:1});}
    else {
      const [x,y,width,height]=m.rect;
      if(m.type==='correction')page.drawRectangle({x,y,width,height,color:rgb(1,1,1)});
      if(m.type==='note')page.drawRectangle({x,y,width,height,color:rgb(1,.97,.84),borderColor:color,borderWidth:.7});
      const angle=m.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),size=m.layout.size;
      for(const [i,line]of m.layout.lines.entries()){
        const dx=m.layout.pad,dy=-m.layout.pad-size-i*size*1.4;
        if(line)page.drawText(line,{x:m.origin[0]+dx*cos-dy*sin,y:m.origin[1]+dx*sin+dy*cos,size,font,color,rotate:degrees(m.rotation)});
      }
    }
  }
}
export async function exportPDF(file,marks,progress,rotation=0){
  progress('正在准备导出…');const api=await loadLibraries();
  let doc;try{doc=await api.PDFDocument.load(await file.arrayBuffer());}catch(error){if(/encrypt/i.test(error.message))throw Error('这份 PDF 已加密，暂不能写入批注。请先用 PDF 软件另存为无密码文件，再打开编辑。');throw error;}
  let font;
  if(marks.some(m=>m.text)){
    progress('正在嵌入中文字体…');const response=await fetch(new URL('./fonts/AnnotationSans-Regular.ttf',import.meta.url));if(!response.ok)throw Error('中文字体加载失败，请重试。');
    doc.registerFontkit(api.fontkit);font=await doc.embedFont(await response.arrayBuffer(),{subset:false});
  }
  for(const page of doc.getPages())page.setRotation(api.degrees((page.getRotation().angle+rotation)%360));
  progress('正在写入批注…');await drawAnnotations(doc,marks,api,font);
  const bytes=await doc.save();return new Blob([bytes],{type:'application/pdf'});
}
export function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
