import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument,rgb,degrees} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {AnnotationHistory,pdfRect,textLayout} from '../dist/annotation-core.mjs';
import {drawAnnotations} from '../dist/pdf-export.mjs';

test('history preserves previous strokes, supports undo/redo and clears redo after a new edit',()=>{
  const h=new AnnotationHistory();const a={id:'1',points:[[1,2],[3,4]]};h.commit([a]);a.points[0][0]=100;
  h.commit([...h.items,{id:'2'}]);assert.equal(h.items[0].points[0][0],1);h.undo();assert.equal(h.items.length,1);h.undo();assert.equal(h.items.length,0);h.redo();assert.equal(h.items.length,1);h.commit([{id:'3'}]);assert.equal(h.redo(),false);
});
test('screen rectangles normalize correctly on rotated pages',()=>{
  const vp={convertToPdfPoint:(x,y)=>[y/2,x/2]};assert.deepEqual(pdfRect(vp,[100,80],[20,30]),[15,10,25,40]);
});
test('text wrapping retains Chinese and newlines, reports content that cannot fit',()=>{
  const measure=(s,size)=>[...s].length*size;
  const m={type:'text',boxWidth:100,boxHeight:120,fontSize:12,text:'紫微斗数修订\n太阳红、太阴紫'};
  const layout=textLayout(m,measure);assert.equal(layout.lines.join('').replaceAll(' ',''),m.text.replaceAll('\n',''));assert.equal(layout.overflow,false);
  assert.equal(textLayout({...m,boxHeight:10,text:'中文'.repeat(100)},measure).overflow,true);
});
test('export preserves original text and page rotation while embedding Chinese annotation text',async()=>{
  const doc=await PDFDocument.create();const page=doc.addPage([595,842]);page.drawText('Original remains searchable',{x:50,y:800,size:14});
  const rotated=doc.addPage([595,842]);rotated.setRotation(degrees(90));
  doc.registerFontkit(fontkit);const font=await doc.embedFont(await readFile(new URL('../dist/fonts/AnnotationSans-Regular.ttf',import.meta.url)),{subset:false});
  const note={id:'text',page:1,type:'note',color:'#303a34',text:'中文批注：太阳红，太阴紫。',rect:[50,650,250,100],origin:[50,750],boxWidth:250,boxHeight:100,fontSize:16,rotation:0};
  note.layout=textLayout(note,(s,size)=>font.widthOfTextAtSize(s,size));
  const correction={...note,id:'rotate',page:2,type:'correction',rotation:90,rect:[120,100,90,220],origin:[120,100],boxWidth:220,boxHeight:90,text:'旋转页修订'};correction.layout=textLayout(correction,(s,size)=>font.widthOfTextAtSize(s,size));
  await drawAnnotations(doc,[note,correction,{page:1,type:'highlight',color:'#f3cc45',rects:[[50,795,160,20]]},{page:1,type:'pen',color:'#b34438',width:2,points:[[50,620],[100,600],[180,630]]}],{rgb,degrees},font);
  const bytes=await doc.save();const reopened=await PDFDocument.load(bytes);assert.equal(reopened.getPageCount(),2);assert.equal(reopened.getPage(1).getRotation().angle,90);
  const out=new URL('./fixtures/export-check.pdf',import.meta.url);await mkdir(new URL('./fixtures/',import.meta.url),{recursive:true});await writeFile(out,bytes);
});
