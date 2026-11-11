import test from 'node:test';
import assert from 'node:assert/strict';
import {pageNumber,pairedPage,fitScale,scrollFraction,excerpt,validPDF} from '../dist/reader-core.mjs';
test('page offset works in both directions and clamps at document limits',()=>{assert.equal(pairedPage(10,'left',3,125),13);assert.equal(pairedPage(13,'right',3,297),10);assert.equal(pairedPage(1,'right',3,297),1);assert.equal(pairedPage(297,'left',3,125),125);});
test('page entry rejects nonfinite and empty input',()=>{assert.equal(pageNumber('',125,5),5);assert.equal(pageNumber('NaN',125,5),5);assert.equal(pageNumber(0,125),1);assert.equal(pageNumber(999,125),125);});
test('fit whole landscape and portrait pages within actual available space',()=>{assert.equal(fitScale('page',600,400,600,800),.5);assert.equal(fitScale('page',600,400,800,600),2/3);assert.equal(fitScale('width',600,400,600,800),1);});
test('scroll sync handles non-scrollable and overscrolled content',()=>{assert.equal(scrollFraction(0,300,500),0);assert.equal(scrollFraction(100,700,500),.5);assert.equal(scrollFraction(-3,700,500),0);});
test('Chinese search returns literal text without interpreting markup',()=>{const x=excerpt('原文 <script> 太阴化科，太阳化禄。','太阴');assert.equal(x.match,'太阴');assert.ok(x.before.includes('<script>'));assert.equal(excerpt('abc','xyz'),null);});
test('file validation checks PDF content rather than file name',async()=>{assert.equal(await validPDF(new Blob(['%PDF-1.7\ncontent'])),true);assert.equal(await validPDF(new Blob(['not a pdf'])),false);});
