export const clone=value=>structuredClone(value);
export class AnnotationHistory {
  constructor(items=[]){this.items=clone(items);this.past=[];this.future=[];}
  commit(items){this.past.push(clone(this.items));if(this.past.length>60)this.past.shift();this.items=clone(items);this.future=[];}
  undo(){if(!this.past.length)return false;this.future.push(this.items);this.items=this.past.pop();return true;}
  redo(){if(!this.future.length)return false;this.past.push(this.items);this.items=this.future.pop();return true;}
}
export function pdfRect(viewport,a,b){
  const points=[[a[0],a[1]],[b[0],a[1]],[a[0],b[1]],[b[0],b[1]]].map(p=>viewport.convertToPdfPoint(...p));
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];
}
export function wrapText(text,width,size,measure){
  const lines=[];for(const paragraph of text.split('\n')){let line='';for(const ch of paragraph){if(line&&measure(line+ch,size)>width){lines.push(line);line=ch;}else line+=ch;}lines.push(line);}return lines;
}
export function textLayout(mark,measure){
  const pad=mark.type==='note'?8:3,w=Math.max(8,mark.boxWidth-pad*2),h=Math.max(8,mark.boxHeight-pad*2);
  let size=mark.fontSize,lines=wrapText(mark.text,w,size,measure);
  while(size>6&&lines.length*size*1.4>h){size-=.5;lines=wrapText(mark.text,w,size,measure);}
  return{size,lines,pad,overflow:lines.length*size*1.4>h};
}
