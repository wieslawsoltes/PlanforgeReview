"""Generate original vector PDF sample sheets. Requires reportlab. No third-party drawings."""
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.pdfbase.pdfdoc import PDFPageLabel
from pathlib import Path
import math
ROOT=Path(__file__).parent
INK=HexColor('#455252');LIGHT=HexColor('#a8b2af');FAINT=HexColor('#d6dcda');WALL=HexColor('#4b5955')

def line(c,x1,y1,x2,y2,w=.55,color=INK):c.setStrokeColor(color);c.setLineWidth(w);c.line(x1,y1,x2,y2)
def text(c,x,y,s,size=8,bold=False,color=INK):c.setFillColor(color);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,y,s)
def centered(c,x,y,s,size=8,bold=False,color=INK):c.setFillColor(color);c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawCentredString(x,y,s)
def rect(c,x,y,w,h,fill=None,stroke=INK,sw=.5):c.setLineWidth(sw);c.setStrokeColor(stroke);c.setFillColor(fill or HexColor('#ffffff'));c.rect(x,y,w,h,fill=bool(fill),stroke=1)
def dimension(c,x1,y1,x2,y2,label):
    line(c,x1,y1,x2,y2,.45,LIGHT)
    dx=x2-x1;dy=y2-y1;l=math.hypot(dx,dy) or 1;nx=-dy/l*4;ny=dx/l*4
    for x,y in [(x1,y1),(x2,y2)]:line(c,x-nx,y-ny,x+nx,y+ny,.6,INK)
    if abs(dx)>abs(dy):centered(c,(x1+x2)/2,(y1+y2)/2+4,label,7)
    else:
        c.saveState();c.translate(x1-5,(y1+y2)/2);c.rotate(90);centered(c,0,0,label,7);c.restoreState()
def base(c,sheet,title,rev):
    rect(c,35,35,1050,730,sw=.7)
    line(c,35,88,1085,88,.6)
    text(c,52,66,'NORTHLINE',17,True);text(c,54,51,'ARCHITECTURE  /  INTERIORS  /  PLANNING',5.7)
    line(c,232,35,232,88,.6);text(c,247,67,'RIVERSIDE HOUSE',13,True);text(c,247,51,'124 RIVER WALK  ·  CONCEPT COORDINATION',6)
    line(c,589,35,589,88,.6);text(c,605,70,'DRAWING TITLE',5.8,color=LIGHT);text(c,605,54,title,10,True)
    line(c,851,35,851,88,.6);text(c,867,71,'SCALE',5.8,color=LIGHT);text(c,867,57,'1 : 85 approx.',7.8);text(c,867,44,'VERIFY DIMENSIONS',5.5)
    line(c,962,35,962,88,.6);text(c,976,71,'SHEET / REVISION',5.8,color=LIGHT);text(c,976,52,sheet+' / '+rev,13,True)
    text(c,48,746,'CONSTRUCTION DOCUMENTS',7,True);text(c,48,733,'COORDINATION ISSUE  ·  06 SEPTEMBER 2026',6,color=LIGHT)
    text(c,845,745,'ORIGINAL DEMONSTRATION DRAWING',6);text(c,845,732,'NOT FOR CONSTRUCTION',6,True)
    # north arrow
    line(c,1022,658,1022,702,1);p=c.beginPath();p.moveTo(1022,711);p.lineTo(1016,692);p.lineTo(1022,697);p.lineTo(1028,692);p.close();c.setFillColor(INK);c.drawPath(p,fill=1,stroke=0);centered(c,1022,719,'N',10,True)
    # graphic scale: 30 PDF units per meter
    for i in range(4):rect(c,850+30*i,116,30,5,fill=INK if i%2==0 else None,sw=.4)
    for i in range(5):centered(c,850+30*i,103,str(i),6)
    text(c,982,103,'m',6)
def wall(c,x,y,w,h):
    rect(c,x,y,w,h,fill=HexColor('#dce1dc'),stroke=WALL,sw=1)
    if w>h:
        for q in range(int(x),int(x+w),12):line(c,q,y,min(q+8,x+w),y+h,.25,LIGHT)
    else:
        for q in range(int(y),int(y+h),12):line(c,x,q,x+w,min(q+8,y+h),.25,LIGHT)
def window(c,x,y,w):
    rect(c,x,y-5,w,10,fill=HexColor('#ffffff'),sw=.4);line(c,x,y,w+x,y,.8);line(c,x,y+2,x+w,y+2,.3);line(c,x,y-2,x+w,y-2,.3)
def door(c,x,y,r=32,angle=0):
    c.saveState();c.translate(x,y);c.rotate(angle);line(c,0,0,r,0,.8);c.setStrokeColor(LIGHT);c.setLineWidth(.5);c.arc(-r,-r,r,r,0,90);c.restoreState()
def sofa(c,x,y,w,h):
    rect(c,x,y,w,h,sw=.55);rect(c,x+4,y+4,w-8,h-12,sw=.35)
    line(c,x+w/2,y+4,x+w/2,y+h-8,.4);line(c,x+4,y+h-8,x+w-4,y+h-8,.5)
def bed(c,x,y,w,h):
    rect(c,x,y,w,h,sw=.55);rect(c,x+3,y+h-29,w-6,25,sw=.35);line(c,x+3,y+h-38,x+w-3,y+h-38,.5);rect(c,x+7,y+h-24,w/2-10,17,sw=.3);rect(c,x+w/2+3,y+h-24,w/2-10,17,sw=.3)
def plan(c,rev='A',ceiling=False):
    c.setDash([9,3,2,3]);
    for x,label in [(180,'A'),(435,'B'),(660,'C'),(915,'D')]:
        line(c,x,183,x,704,.35,FAINT);c.setStrokeColor(LIGHT);c.circle(x,706,10,stroke=1,fill=0);centered(c,x,703,label,8)
    for y,label in [(245,'1'),(495,'2'),(655,'3')]:
        line(c,124,y,960,y,.35,FAINT);c.circle(119,y,10,stroke=1,fill=0);centered(c,119,y-3,label,8)
    c.setDash([])
    for args in [(180,240,735,10),(180,650,735,10),(180,250,10,400),(905,250,10,400),(430,250,10,400),(440,490,465,10),(660,500,10,150),(660,250,10,145),(740,350,10,140)]:wall(c,*args)
    for x,y,w in [(225,655,135),(475,655,125),(725,655,115),(230,245,145),(735,245,115)]:window(c,x,y,w)
    # interior openings
    for x,y,w,h in [(429,330,12,40),(429,520,12,40),(579,489,38,12),(659,395,12,50),(780,489,36,12),(739,403,12,33)]:rect(c,x,y,w,h,fill=HexColor('#ffffff'),stroke=HexColor('#ffffff'))
    door(c,440,330,38,90);door(c,440,520,38,90);door(c,580,500,37,90);door(c,670,395,46,90);door(c,780,500,35,90);door(c,750,404,32,0)
    if rev=='B':
        rect(c,835,238,70,14,fill=HexColor('#ffffff'),stroke=HexColor('#ffffff'));door(c,835,250,65,90)
        wall(c,665,350,74,10)
    else:
        rect(c,849,238,47,14,fill=HexColor('#ffffff'),stroke=HexColor('#ffffff'));door(c,850,250,45,90)
    centered(c,308,474,'LIVING / DINING',10,True);centered(c,308,459,'01   |   64.00 m²',7,color=LIGHT)
    centered(c,550,628,'KITCHEN',10,True);centered(c,550,615,'02   |   35.00 m²',7,color=LIGHT)
    centered(c,789,628,'BEDROOM 01',9,True);centered(c,789,615,'03   |   42.67 m²',7,color=LIGHT)
    centered(c,554,471,'BEDROOM 02',9,True);centered(c,554,458,'04   |   60.00 m²',7,color=LIGHT)
    centered(c,830,466,'BATHROOM',8.5,True);centered(c,829,453,'05   |   23.11 m²',7,color=LIGHT)
    centered(c,790,322,'ENTRANCE',8.5,True);centered(c,790,309,'06   |   18.00 m²',7,color=LIGHT)
    if not ceiling:
        sofa(c,218,346,135,47);sofa(c,366,350,37,87);rect(c,260,297,80,38,sw=.4)
        rect(c,240,540,130,53,sw=.55)
        for x in [252,284,316,348]:
            rect(c,x,526,18,12,sw=.35);rect(c,x,595,18,12,sw=.35)
        rect(c,448,598,23,43,sw=.4);rect(c,448,536,23,55,sw=.4);rect(c,477,618,163,23,sw=.4);rect(c,510,532,108,42,sw=.6)
        for x in [490,522,554,586,618]:line(c,x,618,x,641,.3)
        rect(c,475,623,30,15,sw=.4);c.circle(548,630,5);c.circle(563,630,5)
        bed(c,741,522,99,76);rect(c,701,570,28,25,sw=.3);rect(c,851,570,27,25,sw=.3)
        bed(c,495,301,113,135);rect(c,456,402,28,30,sw=.3);rect(c,619,402,28,30,sw=.3)
        rect(c,760,369,43,69,sw=.5);c.ellipse(765,375,798,431,stroke=1,fill=0)
        rect(c,853,421,35,22,sw=.4);c.ellipse(863,393,881,417,stroke=1,fill=0)
        for y in range(252,344,12):line(c,678,y,731,y,.4,LIGHT)
        line(c,704,256,704,337,.4);line(c,704,337,700,330,.4);line(c,704,337,708,330,.4)
        text(c,680,350,'UP',6)
    else:
        c.setDash([3,3])
        for x in range(210,900,45):line(c,x,255,x,644,.25,FAINT)
        for y in range(260,647,45):line(c,193,y,899,y,.25,FAINT)
        c.setDash([])
        for x in [250,350,520,600,760,850]:
            for y in [295,415,545,600]:
                c.setStrokeColor(INK);c.setLineWidth(.5);c.circle(x,y,6);line(c,x-4,y-4,x+4,y+4,.35);line(c,x-4,y+4,x+4,y-4,.35)
        centered(c,310,390,'CEILING +2700',7);centered(c,550,565,'CEILING +2700',7);centered(c,790,570,'CEILING +2700',7)
    dimension(c,180,682,435,682,'8 500');dimension(c,435,682,660,682,'7 500');dimension(c,660,682,915,682,'8 500')
    dimension(c,150,245,150,495,'8 333');dimension(c,150,495,150,655,'5 333')
    dimension(c,180,204,720,204,'18 000');dimension(c,720,204,915,204,'6 500')
    line(c,180,195,180,236,.3,LIGHT);line(c,720,195,720,236,.3,LIGHT);line(c,915,195,915,236,.3,LIGHT)
    text(c,55,163,'GENERAL NOTES',7,True)
    for i,s in enumerate(['1. ALL DIMENSIONS IN MILLIMETERS UNLESS NOTED.','2. VERIFY ALL DIMENSIONS ON SITE. DO NOT SCALE.','3. COORDINATE STRUCTURE AND BUILDING SERVICES.']):text(c,55,151-i*10,s,5.5)

def elevations(c):
    for row,y in enumerate([460,230]):
        wall(c,185,y,720,9);rect(c,200,y+10,690,123,sw=.8);line(c,170,y+134,915,y+134,.8);line(c,185,y+139,900,y+139,.5)
        for x in [230,410,610,770]:
            rect(c,x,y+35,85,73,sw=.6);line(c,x+42.5,y+35,x+42.5,y+108,.4)
        for yy in range(y+14,y+125,7):line(c,200,yy,890,yy,.22,FAINT)
        line(c,160,y,930,y,.4,INK);text(c,173,y-17,('01  SOUTH ELEVATION' if row==0 else '02  NORTH ELEVATION'),8,True)
        dimension(c,943,y,943,y+134,'4 467');text(c,973,y+131,'+4.467',7);text(c,973,y+5,'±0.000',7)

for revision,filename in [('A','riverside-drawing-set.pdf'),('B','riverside-revision-b.pdf')]:
    c=canvas.Canvas(str(ROOT/filename),pagesize=(1120,800),pageCompression=1);c.setTitle('Riverside House — '+('Drawing Set' if revision=='A' else 'Revision B'));c.setAuthor('Planforge Review Demo')
    for i,(sheet,title) in enumerate([('A-101','GROUND FLOOR PLAN'),('A-201','REFLECTED CEILING PLAN'),('A-301','BUILDING ELEVATIONS')]):
        c._doc.Catalog.PageLabels=c._doc.Catalog.PageLabels or __import__('reportlab.pdfbase.pdfdoc',fromlist=['PDFPageLabels']).PDFPageLabels()
        c._doc.Catalog.PageLabels.addPageLabel(i,PDFPageLabel(prefix=sheet))
        base(c,sheet,title,revision)
        if i<2:plan(c,revision,ceiling=i==1)
        else:elevations(c)
        c.showPage()
    c.save()
    print(filename)
