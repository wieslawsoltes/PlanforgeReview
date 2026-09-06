#!/usr/bin/env python3
"""Optional offline PDF service. Bind to loopback; never expose this dev server publicly.
Requires PyMuPDF (AGPL/commercial). Static/browser-only mode uses server.mjs instead.
All MuPDF calls are serialized: PyMuPDF must not be accessed concurrently by threads.
"""
from __future__ import annotations
import argparse, io, json, mimetypes, secrets, threading, time
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
try:
    import fitz
except ImportError:
    raise SystemExit('Install the optional backend: python -m pip install -r requirements.txt')
ROOT=Path(__file__).resolve().parent
LOCK=threading.RLock()
DOCS={}
LIMIT=150*1024*1024
mimetypes.add_type('text/javascript','.mjs')

def metadata(doc):
    pages=[]
    for p in doc:
        # MuPDF's transformation_matrix on rotated pages can omit CropBox
        # offsets and /UserUnit. Normalize at rotation zero, then rotate using
        # the actual physical page dimensions; restore the source untouched.
        rotation=p.rotation
        p.set_rotation(0)
        try:
            native=p.transformation_matrix
            w,h=p.rect.width,p.rect.height
        finally:
            p.set_rotation(rotation)
        turns={0:fitz.Matrix(1,0,0,1,0,0),90:fitz.Matrix(0,1,-1,0,h,0),180:fitz.Matrix(-1,0,0,-1,w,h),270:fitz.Matrix(0,-1,1,0,0,w)}
        m=native*turns[rotation]
        pages.append({'width':p.rect.width,'height':p.rect.height,'transform':list(m),'rotation':rotation,'extraRotation':0,'label':p.get_label() or str(p.number+1)})
    return pages

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):pass
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','no-store' if self.path.startswith('/api/') else 'no-cache')
        super().end_headers()
    def response(self,body,status=200,kind='application/json'):
        if isinstance(body,(dict,list)):body=json.dumps(body).encode()
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def do_GET(self):
        u=urlparse(self.path);q=parse_qs(u.query)
        if u.path=='/api/health':return self.response({'backend':'mupdf','version':fitz.VersionBind})
        if u.path=='/api/tile':
            try:
                with LOCK:
                    doc=DOCS[q['id'][0]]['doc'];p=doc[int(q['page'][0])-1]
                    scale=float(q.get('scale',['1'])[0]);x=int(q.get('x',['0'])[0]);y=int(q.get('y',['0'])[0]);w=int(q.get('w',['512'])[0]);h=int(q.get('h',['512'])[0])
                    if not 0.02<=scale<=32 or not 1<=w<=2048 or not 1<=h<=2048 or x<0 or y<0:raise ValueError('Invalid tile bounds')
                    old=p.rotation;p.set_rotation(old+int(q.get('rotation',['0'])[0]))
                    try:pix=p.get_pixmap(matrix=fitz.Matrix(scale,scale),clip=fitz.Rect(x/scale,y/scale,(x+w)/scale,(y+h)/scale),alpha=False);data=pix.tobytes('png')
                    finally:p.set_rotation(old)
                return self.response(data,kind='image/png')
            except Exception as e:return self.response({'error':str(e)},400)
        return super().do_GET()
    def do_DELETE(self):
        if not self.same_origin():return self.response({'error':'Origin mismatch'},403)
        q=parse_qs(urlparse(self.path).query)
        with LOCK:
            item=DOCS.pop(q.get('id',[''])[0],None)
            if item:item['doc'].close()
        self.response({'ok':True})
    def same_origin(self):
        origin=self.headers.get('Origin')
        return not origin or origin==f'http://{self.headers.get("Host")}'
    def do_POST(self):
        if not self.same_origin():return self.response({'error':'Origin mismatch'},403)
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size<=0 or size>LIMIT:return self.response({'error':'File limit: 150 MiB'},413)
            data=self.rfile.read(size)
            if self.path=='/api/docs':
                with LOCK:
                    doc=fitz.open(stream=data,filetype='pdf')
                    if doc.needs_pass and not doc.authenticate(self.headers.get('X-PDF-Password','')):
                        doc.close();return self.response({'passwordRequired':True},401)
                    if len(doc)>3000:doc.close();raise ValueError('Maximum 3000 pages')
                    # Keep enough documents for old/new swaps and independent overlay files.
                    while len(DOCS)>=8:
                        k=next(iter(DOCS));DOCS.pop(k)['doc'].close()
                    key=secrets.token_hex(16);DOCS[key]={'doc':doc,'bytes':data,'time':time.time()}
                    return self.response({'id':key,'pages':metadata(doc),'backend':'MuPDF'})
            if self.path=='/api/export':
                body=json.loads(data);key=body['document'];project=body['project']
                with LOCK:
                    source=DOCS[key];doc=fitz.open(stream=source['bytes'],filetype='pdf')
                    if doc.needs_pass:doc.close();raise ValueError('Export of encrypted PDFs is disabled. Use the project archive.')
                    rotations=[p.rotation for p in doc]
                    for p in doc:p.set_rotation(0)
                    for m in project['markups'].values():
                        if not project['layers'][m['layer']]['visible']:continue
                        p=doc[m['page']-1];pts=[fitz.Point(*v)*p.transformation_matrix for v in m['points']]
                        col=tuple(int(m['color'][i:i+2],16)/255 for i in (1,3,5));width=m['width'];op=m['opacity'];kind=m['type'];shape=p.new_shape()
                        # Editable standard PDF annotations with UUID /NM and semantic metadata.
                        if kind in ('length','polyline','pen'):a=p.add_polyline_annot(pts)
                        elif kind=='area':a=p.add_polygon_annot(pts)
                        elif kind in ('cloud','rectangle'):
                            rect=fitz.Rect(min(v.x for v in pts),min(v.y for v in pts),max(v.x for v in pts),max(v.y for v in pts));a=p.add_rect_annot(rect)
                            if kind=='cloud':a.set_border(width=width,clouds=2)
                        elif kind=='count':
                            v=pts[0];a=p.add_circle_annot(fitz.Rect(v.x-7,v.y-7,v.x+7,v.y+7))
                        elif kind=='callout':
                            a=p.add_line_annot(pts[0],pts[1]);a.set_line_ends(4,0)
                        else:
                            v=pts[0];a=p.add_freetext_annot(fitz.Rect(v.x,v.y-18,v.x+190,v.y+42),m.get('label') or m['subject'],fontsize=m['fontSize'],text_color=col,fontname='helv')
                        if kind not in ('text','stamp'):
                            a.set_colors(stroke=col,fill=col if kind=='area' else None)
                            a.set_border(width=width,**({'clouds':2} if kind=='cloud' else {}))
                        a.set_opacity(.18 if kind=='area' else op)
                        a.set_info(title=m['author'],subject=m['subject'],content=(m.get('label') or m['subject'])+'\nStatus: '+m['status'])
                        doc.xref_set_key(a.xref,'NM',fitz.get_pdf_str(m['id']));a.update()
                        if kind=='callout':
                            v=pts[1];t=p.add_freetext_annot(fitz.Rect(v.x,v.y-18,v.x+190,v.y+42),m.get('label') or m['subject'],fontsize=m['fontSize'],text_color=col);t.update()
                    for i,p in enumerate(doc):p.set_rotation(rotations[i])
                    out=doc.tobytes(garbage=3,deflate=True);doc.close()
                return self.response(out,kind='application/pdf')
            self.response({'error':'Unknown endpoint'},404)
        except Exception as e:self.response({'error':str(e)},400)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=8080);args=ap.parse_args()
    print(f'Planforge Review — http://localhost:{args.port} (local MuPDF backend)',flush=True)
    try:ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
    except KeyboardInterrupt:pass
