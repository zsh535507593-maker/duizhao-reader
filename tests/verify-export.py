"""Independent PDF raster check: text extraction alone missed a CJK subsetting bug."""
from pathlib import Path
import pymupdf
doc=pymupdf.open(Path(__file__).parent/'fixtures/export-check.pdf')
assert 'Original remains searchable' in doc[0].get_text()
expected=['中文批注：太阳红，太阴紫。','旋转页修订']
for page,text in zip(doc,expected):
    assert text in page.get_text()
    chars=[c for b in page.get_text('rawdict')['blocks'] if 'lines' in b for line in b['lines'] for span in line['spans'] for c in span['chars'] if c['c'] in text and c['c'].strip()]
    assert len(chars)>=len(text)
    for c in chars:
        rect=pymupdf.Rect(c['bbox'])*page.rotation_matrix
        pix=page.get_pixmap(matrix=pymupdf.Matrix(2,2),clip=rect,colorspace=pymupdf.csGRAY)
        assert sum(v<160 for v in pix.samples)>2, f"Invisible glyph: {c['c']}"
print('Export raster, Chinese glyphs, rotation and searchable source: PASS')
