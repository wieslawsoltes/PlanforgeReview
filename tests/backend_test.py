#!/usr/bin/env python3
"""Real MuPDF regression tests. No web server, network, NumPy or image mocks."""
import unittest,importlib.util,json,io,re
from pathlib import Path
import fitz
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('pfserver',ROOT/'server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)

def request(path,method='GET',body=b''):
    out=[];h=object.__new__(server.Handler);h.path=path;h.headers={'Content-Length':str(len(body))};h.rfile=io.BytesIO(body)
    h.response=lambda data,status=200,kind='application/json':out.append((data,status,kind));getattr(h,'do_'+method)();return out[-1]

def fixture(crop=False,rotation=0,unit=1):
    d=fitz.open();p=d.new_page(width=600,height=800);xref=d.get_new_xref();d.update_object(xref,'<<>>');d.update_stream(xref,b'1 0 0 rg 148 198 4 4 re f');p.set_contents(xref)
    if crop:p.set_cropbox(fitz.Rect(50,70,550,750))
    d.xref_set_key(p.xref,'UserUnit',str(unit));p.set_rotation(rotation);data=d.tobytes();d.close();return data

class BackendTests(unittest.TestCase):
    def test_metadata_and_pixels_all_crop_rotation_userunit_combinations(self):
        for crop in (False,True):
            for rotation in (0,90,180,270):
                for unit in (1,2):
                    with self.subTest(crop=crop,rotation=rotation,unit=unit):
                        raw=fixture(crop,rotation,unit);meta,status,_=request('/api/docs','POST',raw);self.assertEqual(status,200)
                        m=fitz.Matrix(*meta['pages'][0]['transform']);pred=fitz.Point(150,200)*m
                        x=(150-(50 if crop else 0))*unit;y=((730 if crop else 800)-200)*unit;w=(500 if crop else 600)*unit;h=(680 if crop else 800)*unit
                        expected={0:(x,y),90:(h-y,x),180:(w-x,h-y),270:(y,w-x)}[rotation]
                        self.assertAlmostEqual(pred.x,expected[0]);self.assertAlmostEqual(pred.y,expected[1])
                        image,status,_=request('/api/tile?id='+meta['id']+f'&page=1&scale=1&x={int(pred.x)-16}&y={int(pred.y)-16}&w=32&h=32&rotation=0');self.assertEqual(status,200)
                        pix=fitz.Pixmap(image);color=pix.pixel(16,16);self.assertGreater(color[0],240);self.assertLess(color[1],20)
    def test_page_extra_rotation_renders_correct_physical_tile(self):
        meta,_,_=request('/api/docs','POST',fixture(True,90,2))
        # Intrinsic 90 + view 90 = 180; native marker becomes (800, 300).
        data,status,_=request('/api/tile?id='+meta['id']+'&page=1&scale=1&x=784&y=284&w=32&h=32&rotation=90');self.assertEqual(status,200);self.assertEqual(fitz.Pixmap(data).pixel(16,16),(255,0,0))
    def test_pdf_export_preserves_native_annotation_ids_and_coordinates(self):
        for rotation in (0,90,180,270):
            meta,_,_=request('/api/docs','POST',fixture(True,rotation,2))
            m={'id':'5666c084-8f3e-4a62-991e-0d75f0db711c','type':'count','page':1,'points':[[150,200]],'color':'#00aa88','opacity':1,'width':1.5,'fontSize':11,'layer':'a','subject':'Fixture','author':'Test','label':'','status':'Accepted'}
            body={'document':meta['id'],'project':{'layers':{'a':{'visible':True}},'markups':{m['id']:m}}}
            result,status,_=request('/api/export','POST',json.dumps(body).encode());self.assertEqual(status,200,result)
            d=fitz.open(stream=result,filetype='pdf');p=d[0];self.assertEqual(p.rotation,rotation);a=next(p.annots());self.assertEqual(a.info['id'],m['id'])
            value=d.xref_get_key(a.xref,'Rect')[1];numbers=[float(x) for x in re.findall(r'-?\d+(?:\.\d+)?',value)];self.assertAlmostEqual((numbers[0]+numbers[2])/2,150);self.assertAlmostEqual((numbers[1]+numbers[3])/2,200);d.close()
    def test_real_multi_page_sample_and_annotations(self):
        raw=(ROOT/'assets/riverside-drawing-set.pdf').read_bytes();meta,status,_=request('/api/docs','POST',raw);self.assertEqual(status,200);self.assertEqual(len(meta['pages']),3);self.assertEqual(meta['pages'][2]['label'],'A-301')
    def test_invalid_tile_size_rejected(self):
        meta,_,_=request('/api/docs','POST',fixture());_,status,_=request('/api/tile?id='+meta['id']+'&page=1&scale=1&w=999999&h=20');self.assertEqual(status,400)
    def test_invalid_pdf_is_rejected(self):
        _,status,_=request('/api/docs','POST',b'not a pdf');self.assertEqual(status,400)
    def test_document_disposal(self):
        meta,_,_=request('/api/docs','POST',fixture());request('/api/docs?id='+meta['id'],'DELETE');self.assertNotIn(meta['id'],server.DOCS)
    def test_password_challenge(self):
        d=fitz.open(stream=fixture(),filetype='pdf');raw=d.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256,user_pw='user',owner_pw='owner');d.close();data,status,_=request('/api/docs','POST',raw);self.assertEqual(status,401);self.assertTrue(data['passwordRequired'])

if __name__=='__main__':unittest.main(verbosity=2)
