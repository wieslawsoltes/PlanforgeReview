"""Generate original vector demonstration drawings. Requires reportlab; not needed to run app."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
ROOT=Path(__file__).resolve().parent
W,H=1120,800
INK=HexColor('#31404a');LIGHT=HexColor('#a5b1b8');WALL=HexColor('#c7cdd0')

def text(c,x,y,t,size=8,color=INK,font='Helvetica',align='left'):
    c.setFillColor(color);c.setFont(font,size)
    getattr(c,{'left':'drawString','right':'drawRightString','center':'drawCentredString'}[align])(x,y,t)

def line(c,x,y,x2,y2,width=.6,color=INK):
    c.setStrokeColor(color);c.setLineWidth(width);c.line(x,y,x2,y2)

def rect(c,x,y,w,h,fill=None,stroke=INK,width=.6):
    c.setLineWidth(width);c.setStrokeColor(stroke)
    if fill:c.setFillColor(fill)
    c.rect(x,y,w,h,stroke=1,fill=int(fill is not None))

def room(c,x,y,title,sub):
    text(c,x,y,title,9,INK,'Helvetica-Bold','center');text(c,x,y-14,sub,7,HexColor('#87949a'),align='center')

def door(c,x,y,r=35,angle=0):
    c.saveState();c.translate(x,y);c.rotate(angle);c.setStrokeColor(LIGHT);c.setLineWidth(.6);c.arc(-r,0,r,r*2,0,90);line(c,0,0,r,0,.8);line(c,r,0,r,r,.6);c.restoreState()

def dim(c,x1,x2,y,label):
    line(c,x1,y,x2,y,.5,LIGHT)
    for x in (x1,x2):line(c,x,y-7,x,y+7,.5,LIGHT);line(c,x-3,y-3,x+3,y+3,.7,INK)
    text(c,(x1+x2)/2,y+5,label,7,INK,align='center')

def titleblock(c,page,revision):
    rect(c,32,31,1056,738,stroke=HexColor('#61737c'),width=.7)
    line(c,974,31,974,769,.8,HexColor('#65727b'))
    text(c,992,729,'RIVERSIDE',13,INK,'Helvetica-Bold');text(c,992,710,'HOUSE',13,INK,'Helvetica-Bold')
    text(c,992,686,'RESIDENTIAL',7);text(c,992,674,'RENOVATION',7)
    line(c,988,654,1074,654,.5,LIGHT)
    text(c,992,634,'DRAWING REVIEW',6,HexColor('#7a898f'));text(c,992,618,'ISSUED FOR',8);text(c,992,605,'COORDINATION',8,'#31404a' if False else INK)
    line(c,988,587,1074,587,.5,LIGHT)
    title=['GROUND FLOOR','REFLECTED','BUILDING'][page-1]
    sub=['PLAN','CEILING PLAN','SECTIONS'][page-1]
    text(c,992,565,title,8,INK,'Helvetica-Bold');text(c,992,551,sub,8,INK,'Helvetica-Bold')
    text(c,992,516,'PROJECT',6,LIGHT);text(c,992,503,'PF-026 / DEMO',8)
    text(c,992,470,'REVISION',6,LIGHT);text(c,992,456,'B' if revision else 'A',13,INK,'Helvetica-Bold')
    text(c,992,426,'DATE',6,LIGHT);text(c,992,413,'06 SEP 2026',8)
    text(c,992,380,'UNITS',6,LIGHT);text(c,992,367,'DIMENSIONS IN mm',7)
    text(c,992,334,'SCALE',6,LIGHT);text(c,992,321,'CALIBRATE TO',7);text(c,992,309,'KNOWN DIMENSION',7)
    for i,t in enumerate(['VERIFY ALL','DIMENSIONS','BEFORE TAKEOFF.','','FICTIONAL SAMPLE.','NOT FOR','CONSTRUCTION.']):text(c,992,272-i*12,t,6.5,HexColor('#8a979d'))
    line(c,988,136,1074,136,.5,LIGHT);text(c,992,107,['A-101','A-201','A-301'][page-1],24,INK,'Helvetica-Bold');text(c,992,83,f'SHEET {page} OF 3',7,LIGHT)
    text(c,62,54,'P L A N F O R G E    /    D E M O N S T R A T I O N   D R A W I N G S',7,HexColor('#7b8e95'))
    text(c,940,54,'DO NOT SCALE FROM A SCREENSHOT',6.5,HexColor('#8b9aa0'),align='right')

def floor(c,revision=False,ceiling=False):
    c.setDash(2,4)
    for i,x in enumerate((180,435,660,930)):
        line(c,x,198,x,710,.4,HexColor('#b7c1c6'));c.setStrokeColor(INK);c.circle(x,724,9,stroke=1,fill=0);text(c,x,721,chr(65+i),7,align='center')
    for i,y in enumerate((240,495,670)):
        line(c,134,y,953,y,.4,HexColor('#b7c1c6'));c.setStrokeColor(INK);c.circle(118,y,9,stroke=1,fill=0);text(c,118,y-3,str(i+1),7,align='center')
    c.setDash()
    rect(c,180,240,750,430,fill=HexColor('#d5dadd'),width=1.2);rect(c,190,250,730,410,fill=white,width=.6)
    # Interior wall bands, with deliberate door openings.
    for x,y,w,h in [(430,250,10,180),(430,466,10,194),(190,490,105,10),(332,490,328,10),(650,390,10,270),(650,250,10,105),(660,350,178 if not revision else 160,10),(878 if not revision else 898,350,42 if not revision else 22,10),(785,250,8,100)]:rect(c,x,y,w,h,fill=WALL,width=.7)
    # Window recesses on exterior walls.
    for x,y,w,h in [(220,240,145,10),(470,240,115,10),(710,660,120,10),(240,660,130,10),(920,440,10,130),(180,315,10,95)]:
        rect(c,x,y,w,h,fill=white,stroke=LIGHT,width=.5)
        if w>h:line(c,x,y+4,x+w,y+4,.65);line(c,x,y+7,x+w,y+7,.4)
        else:line(c,x+4,y,x+4,y+h,.65);line(c,x+7,y,x+7,y+h,.4)
    for args in [(295,495,37,0),(435,430,36,90),(655,355,36,0),(840 if not revision else 860,355,38,0)]:door(c,*args)
    # Living room furniture: sofas, side table, rug and dining table.
    rect(c,232,285,155,145,stroke=HexColor('#bbc4c9'),width=.5)
    for y in (312,356):rect(c,210,y,34,42,fill=HexColor('#f5f6f6'),stroke=LIGHT,width=.6);rect(c,214,y+3,24,34,stroke=LIGHT,width=.4)
    rect(c,277,316,68,60,stroke=LIGHT,width=.7);rect(c,281,320,60,52,stroke=HexColor('#c5cdd0'),width=.4)
    rect(c,340,400,45,28,stroke=LIGHT,width=.5)
    room(c,312,463,'LIVING ROOM','01 / OAK FLOORING')
    # Bedroom bed and cabinets.
    rect(c,223,535,130,92,stroke=LIGHT);rect(c,226,540,124,75,stroke=LIGHT);line(c,226,582,350,582,.45,LIGHT)
    for x in (230,292):rect(c,x,599,52,20,stroke=LIGHT)
    for x in (203,359):rect(c,x,600,19,27,stroke=LIGHT)
    rect(c,390,528,25,102,stroke=LIGHT)
    room(c,303,517,'BEDROOM 01','02 / OAK FLOORING')
    # Kitchen counter and island.
    rect(c,453,617,184,30,fill=HexColor('#f3f4f4'),stroke=LIGHT);rect(c,610,555,27,62,fill=HexColor('#f3f4f4'),stroke=LIGHT)
    rect(c,470,622,50,19,stroke=LIGHT)
    for x in (552,570):
        for y in (625,639):c.setStrokeColor(LIGHT);c.circle(x,y,5,stroke=1,fill=0)
    rect(c,473,546,103,42,stroke=LIGHT)
    for x in (486,522,558):c.setStrokeColor(LIGHT);c.circle(x,533,8,stroke=1,fill=0)
    room(c,543,515,'KITCHEN','03 / PORCELAIN TILE')
    # Hall / meeting area.
    room(c,548,455,'ENTRANCE HALL','04 / TERRAZZO')
    rect(c,473,295,135,53,stroke=LIGHT)
    for x in (488,523,558,593):
        rect(c,x-9,274,18,18,stroke=LIGHT);rect(c,x-9,353,18,18,stroke=LIGHT)
    room(c,540,398,'DINING','05 / OAK FLOORING')
    room(c,795,640,'FAMILY ROOM','06 / OAK FLOORING')
    rect(c,703,412,150,50,stroke=LIGHT)
    for x in (710,758,806):rect(c,x,418,40,37,stroke=LIGHT)
    rect(c,720,477,105,36,stroke=LIGHT);rect(c,877,480,25,133,stroke=LIGHT)
    room(c,721,322,'WC','07 / TILE');room(c,852,322,'UTILITY','08 / TILE')
    c.setStrokeColor(LIGHT);c.ellipse(690,270,718,295);rect(c,687,292,34,12,stroke=LIGHT)
    rect(c,825,265,66,30,stroke=LIGHT)
    dim(c,190,730,211,'18 000');dim(c,180,930,181,'25 000');dim(c,180,435,697,'8 500');dim(c,435,660,697,'7 500');dim(c,660,930,697,'9 000')
    text(c,181,758,'01',13,INK,'Helvetica-Bold');text(c,207,758,'REFLECTED CEILING PLAN' if ceiling else 'GROUND FLOOR PLAN',12,INK,'Helvetica-Bold')
    text(c,207,742,'RIVERSIDE HOUSE / COORDINATION REVIEW',7,HexColor('#86969c'))
    # North arrow and scale bar.
    c.setStrokeColor(INK);c.circle(96,124,20,stroke=1,fill=0);line(c,96,107,96,144,1);line(c,96,144,89,130,1);line(c,96,144,103,130,1);text(c,96,153,'N',9,INK,'Helvetica-Bold','center')
    for i in range(4):rect(c,718+i*45,124,45,5,fill=INK if i%2==0 else white,width=.5)
    for i,t in enumerate(('0','1.5','3','4.5','6 m')):text(c,718+i*45,110,t,6.5,INK,align='center')
    if ceiling:
        c.setDash(4,3)
        for x in (250,360,485,590,755,850):line(c,x,265,x,642,.45,HexColor('#7f98a5'))
        c.setDash()
        for x in (260,370,490,590,755,850):
            for y in (540,610):
                c.setStrokeColor(HexColor('#627d8b'));c.circle(x,y,5,stroke=1,fill=0);line(c,x-4,y,x+4,y,.5);line(c,x,y-4,x,y+4,.5)
        text(c,445,145,'CEILING HEIGHT: 2 700 mm AFFL',8)
    if revision:
        rect(c,694,579,48,30,stroke=INK,width=1);text(c,718,590,'NEW',6,INK,align='center')
        line(c,785,350,785,404,2);text(c,180,80,'REVISION B: UTILITY DOOR WIDTH AND FAMILY ROOM CASEWORK UPDATED',7,HexColor('#7b8990'))

def section(c):
    text(c,110,731,'03',13,INK,'Helvetica-Bold');text(c,141,731,'BUILDING SECTIONS',12,INK,'Helvetica-Bold')
    for row,y in enumerate((465,235)):
        line(c,130,y,940,y,1.7);line(c,130,y-10,940,y-10,.7)
        for x in (180,435,660,910):rect(c,x,y,11,130,fill=WALL,width=.8)
        line(c,175,y+130,926,y+130,2);line(c,175,y+140,926,y+140,.7)
        if row==0:
            p=c.beginPath();p.moveTo(160,y+142);p.lineTo(547,y+215);p.lineTo(939,y+142);c.setLineWidth(1.3);c.drawPath(p)
            line(c,160,y+145,939,y+145,.6)
        for x in range(180,910,24):line(c,x,y-10,x+10,y-20,.35,LIGHT)
        text(c,140,y+115,'+2.700',7);text(c,140,y+15,'+0.000',7)
        for x,t in ((280,'LIVING'),(537,'HALL'),(788,'FAMILY')):room(c,x,y+62,t,'FINISHED FLOOR')
        text(c,182,y-45,('SECTION A-A' if row==0 else 'SECTION B-B'),10,INK,'Helvetica-Bold');dim(c,180,720,y-66,'18 000')
    text(c,180,114,'GENERAL NOTES',9,INK,'Helvetica-Bold');text(c,180,98,'1. ALL LEVELS RELATIVE TO FINISHED GROUND FLOOR.  2. VERIFY DIMENSIONS WITH PROJECT ARCHITECT.',7)

def build(path,revision=False):
    c=canvas.Canvas(str(path),pagesize=(W,H),pageCompression=1);c.setTitle('Riverside House — Revision B' if revision else 'Riverside House — Drawing Set');c.setAuthor('Planforge Review Demo')
    for p in range(1,4):
        c.addPageLabel(p-1,prefix=['A-101','A-201','A-301'][p-1]);titleblock(c,p,revision)
        if p<3:floor(c,revision,p==2)
        else:section(c)
        c.showPage()
    c.save()

if __name__=='__main__':
    build(ROOT/'riverside-drawing-set.pdf');build(ROOT/'riverside-revision-b.pdf',True)
