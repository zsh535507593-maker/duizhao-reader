from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

out = Path(__file__).resolve().parent.parent / 'dist' / 'samples'
out.mkdir(exist_ok=True)
pdfmetrics.registerFont(TTFont('Song', 'C:/Windows/Fonts/simsun.ttc', subfontIndex=0))
pages = [
 ('兩卷並讀', '两卷并读', ['讀書宜靜，對照宜明。原件與改件分置左右，', '從同一處起讀，便可察其文字、標點與版式。', '', '校讀之時，先觀全頁，再看細節。遇到封面、', '序言與目錄頁數不同，可各自翻到相應內容，', '再以當前兩頁對齊。', '', '一頁原文，一頁新意。兩卷相照，細讀其間。'], ['读书宜静，对照宜明。原件与改件分置左右，', '从同一处起读，便可察其文字、标点与版式。', '', '校读时，先看整页，再看细节。如果封面、', '序言和目录的页数不同，可以分别翻到对应', '内容，再将当前两页设为同步阅读的起点。', '', '一页原文，一页新意。两卷相照，细读其间。']),
 ('清楚而不失真', '清楚而不失真', ['文字當清晰，圖表當完整。核對主星與四化，', '宜保留圖中本色，免使色義相混。', '', '太陽為紅，太陰為紫。其餘配色從已定規則，', '逐項查驗。', '', '原件之宮位、箭頭及大限流年，皆須細讀。', '有疑之處，留待核對，不憑想像補入。'], ['文字应当清晰，图表应当完整。核对主星和', '四化时，保留图中的原色，避免混淆颜色含义。', '', '太阳为红，太阴为紫。其余配色遵循已确认', '的规则，逐项检查。', '', '宫位、箭头、大限与流年，都需要对照原件。', '不确定的内容应保留，并在核对后处理。']),
 ('從容閱讀', '从容阅读', ['日間用明紙，夜讀用墨色。調其外觀，不改', '其內容。', '', '讀至有得處，可存當前兩頁，以待續讀。', '全文有文字層者，可搜尋字詞、選取複製；', '純掃描頁則需先辨識其文字。', '', '此為對照閱讀功能示例，並非書籍原文。'], ['日间用白昼，夜读用墨夜。调整阅读外观，', '文档内容保持原样。', '', '读到需要回看的地方，可以保存当前对照页。', '具有文字层的 PDF 可搜索和复制；纯扫描', '页面需先完成文字识别。', '', '本文件为自编功能示例，不是书籍原文。'])
]
for revised in [False, True]:
 c=canvas.Canvas(str(out / ('revised.pdf' if revised else 'original.pdf')), pagesize=(595,842))
 c.setTitle('对照阅读示例 - '+('改件' if revised else '原件'))
 for n, item in enumerate(pages,1):
  c.setFillColor(HexColor('#ffffff' if revised else '#faf8f2')); c.rect(0,0,595,842,fill=1,stroke=0)
  c.setFillColor(HexColor('#777970')); c.setFont('Song',10); c.drawString(70,782,'对照阅读札记  /  '+('简体修订示例' if revised else '繁体原件示例'))
  c.setStrokeColor(HexColor('#d4d5cc')); c.setLineWidth(.5); c.line(70,765,525,765)
  c.setFillColor(HexColor('#6b7267')); c.setFont('Helvetica',10); c.drawString(70,715,f'0{n}')
  c.setFillColor(HexColor('#30352e')); c.setFont('Song',26); c.drawString(70,671,item[1 if revised else 0])
  c.setFont('Song',15)
  for i,line in enumerate(item[3 if revised else 2]):c.drawString(70,610-i*34,line)
  if n==2:
   for x,name,color in [(70,'太阳','#ff0000'),(180,'太阴','#601986'),(290,'化禄','#129f07'),(400,'化科','#00a0e9')]:
    c.setFillColor(HexColor(color));c.setFont('Song',16);c.drawString(x,230,name)
  c.setStrokeColor(HexColor('#d4d5cc'));c.line(70,90,525,90)
  c.setFont('Song',10);c.setFillColor(HexColor('#777970'));c.drawString(70,65,'对照 · 双卷阅读');c.drawRightString(525,65,f'{n} / 3')
  c.showPage()
 c.save()
print('Created two original demonstration PDFs, three pages each.')
