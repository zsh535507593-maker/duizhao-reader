import {cp,mkdir,copyFile,access} from 'node:fs/promises';
import path from 'node:path';
const base=path.resolve(import.meta.dirname,'..'), vendor=path.join(base,'dist/vendor'), source=path.join(base,'node_modules/pdfjs-dist');
await mkdir(vendor,{recursive:true});
for(const file of ['pdf.mjs','pdf.worker.mjs'])await copyFile(path.join(source,'build',file),path.join(vendor,file));
await copyFile(path.join(source,'web/pdf_viewer.css'),path.join(vendor,'pdf_viewer.css'));
await copyFile(path.join(source,'LICENSE'),path.join(vendor,'LICENSE'));
for(const dir of ['cmaps','standard_fonts','wasm'])await cp(path.join(source,dir),path.join(vendor,dir),{recursive:true});
for(const file of ['index.html','app.mjs','styles.css','tokens.css','reader-core.mjs','storage.mjs','samples/original.pdf','samples/revised.pdf'])await access(path.join(base,'dist',file));
console.log('Built local PDF reader with bundled PDF.js assets.');

for(const [from,to] of [['pdf-lib/dist/pdf-lib.min.js','pdf-lib.min.js'],['@pdf-lib/fontkit/dist/fontkit.umd.min.js','fontkit.umd.min.js'],['pdf-lib/LICENSE.md','pdf-lib-LICENSE.md'],['@pdf-lib/fontkit/README.md','fontkit-README.md']])await copyFile(path.join(base,'node_modules',from),path.join(vendor,to));
for(const file of ['continuous.mjs','annotations.mjs','annotation-core.mjs','pdf-export.mjs','editor.css','fonts/AnnotationSans-Regular.ttf','fonts/LICENSE.txt'])await access(path.join(base,'dist',file));
