#!/usr/bin/env python3
"""Browser interaction smoke tests.
Normal: python tests/browser_smoke.py --url http://localhost:8080
Isolated (restricted browser): --isolated tests DOM + real MuPDF API logic through
an in-process bridge. It does NOT test WebGPU, HTTP transport or IndexedDB.
Requires playwright and Chromium. PDF.js/static mode needs npm install first.
"""
from __future__ import annotations
import argparse,base64,hashlib,importlib.util,io,json,re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]

def bundle():
    chunks=[]
    for f in (ROOT/'src').glob('*.js'):
        source=f.read_text();exports=re.findall(r'export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)',source)
        source=re.sub(r"import\s+\*\s+as\s+(\w+)\s+from\s+['\"](.+?)['\"];",lambda m:'const '+m[1]+'=require('+json.dumps(Path(m[2]).name)+');',source)
        source=re.sub(r"import\s*\{([^}]+)\}\s*from\s*['\"](.+?)['\"];",lambda m:'const {'+re.sub(r'\s+as\s+',':',m[1])+'}=require('+json.dumps(Path(m[2]).name)+');',source)
        source=re.sub(r'\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)','',source)
        source=source.replace('import.meta.url',json.dumps('http://test.invalid/src/'+f.name))
        source=re.sub(r"import\(['\"]\./([^'\"]+)['\"]\)",r"Promise.resolve(require('\1'))",source)
        source=source.replace('import(', '__dynamic(')
        chunks.append('factories['+json.dumps(f.name)+']=function(require,module,exports){\n'+source+'\nObject.assign(exports,{'+','.join(exports)+'});\n};')
    return "const factories={},instances={}; function require(n){if(instances[n])return instances[n].exports;const m={exports:{}};instances[n]=m;factories[n](require,m,m.exports);return m.exports;} function __dynamic(){throw Error('External module is not part of the isolated test');}\n"+'\n'.join(chunks)+"\nwindow.__modules={require};"

def isolated(page):
    spec=importlib.util.spec_from_file_location('pfserver',ROOT/'server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)
    def backend(_,url,method,encoded,headers):
        raw=base64.b64decode(encoded or '');headers={str(k):str(v) for k,v in (headers or {}).items()};headers['Content-Length']=str(len(raw))
        out=[]
        if url.startswith('assets/'):
            f=ROOT/url
            out=[(f.read_bytes(),200,'application/pdf')]
        else:
            h=object.__new__(server.Handler);h.path=url;h.headers=headers;h.rfile=io.BytesIO(raw)
            h.response=lambda body,status=200,kind='application/json':out.append((body,status,kind))
            getattr(h,'do_'+method)()
        body,status,kind=out[-1]
        if isinstance(body,(dict,list)):body=json.dumps(body).encode()
        return {'data':base64.b64encode(body).decode(),'status':status,'type':kind}
    page.expose_binding('__pdfBackend',backend)
    page.expose_binding('__sha',lambda _,b64:base64.b64encode(hashlib.sha256(base64.b64decode(b64)).digest()).decode())
    html=(ROOT/'index.html').read_text();html=re.sub(r'<link[^>]+(?:stylesheet|icon)[^>]*>','',html);html=re.sub(r'<script type="module".*?</script>','',html);html=html.replace('</head>','<style>'+(ROOT/'style.css').read_text()+'</style></head>')
    page.set_content(html)
    page.add_script_tag(content="""
    const enc=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
    const dec=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
    Object.defineProperty(crypto,'randomUUID',{value:()=>{const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;let s=[...a].map(v=>v.toString(16).padStart(2,'0')).join('');return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);}});
    Object.defineProperty(crypto,'subtle',{value:{digest:async(_,data)=>dec(await __sha(enc(new Uint8Array(data.buffer||data,data.byteOffset||0,data.byteLength)))).buffer}});
    const local=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)}});
    window.fetch=async(url,opts={})=>{if(opts.signal?.aborted)throw new DOMException('Cancelled','AbortError');let body=opts.body,b64='';if(body){if(typeof body==='string')body=new TextEncoder().encode(body);else if(body instanceof Blob)body=new Uint8Array(await body.arrayBuffer());b64=enc(new Uint8Array(body.buffer||body,body.byteOffset||0,body.byteLength));}const r=await __pdfBackend(String(url),opts.method||'GET',b64,opts.headers||{});if(opts.signal?.aborted)throw new DOMException('Cancelled','AbortError');return new Response(dec(r.data),{status:r.status,headers:{'Content-Type':r.type}});};
    """)
    page.add_script_tag(content=bundle()+"""
    const storage=require('storage.js'),memory=new Map();window.__downloads=[];
    storage.saveProject=async(p,pdf,overlay)=>{const old=memory.get(p.id)||{};memory.set(p.id,{project:structuredClone(p),pdf:pdf?new Blob([pdf]):old.pdf,overlay:overlay?new Blob([overlay]):old.overlay});return new Date().toISOString();};
    storage.listProjects=async()=>[...memory.values()].map(v=>v.project);storage.loadProject=async id=>memory.get(id);
    storage.download=(data,name,type)=>__downloads.push({data:data instanceof Blob?data:new Blob([data],{type}),name});
    require('app.js');
    """)


def run(page,out):
    page.wait_for_function('window.planforge?.source && planforge.tiles.cache.size>0',timeout=25000)
    page.wait_for_timeout(900)
    assert page.evaluate('Object.keys(planforge.project.markups).length')==11
    assert page.locator('#total-area').inner_text()=='99'
    page.screenshot(path=str(out/'workspace.png'),full_page=True)
    checks=['three-page real PDF render','initial analytical takeoff totals']
    def point(pdf):
        return page.evaluate('(p)=>{const a=planforge.toScreen(p),b=document.querySelector("#stage").getBoundingClientRect();return [a[0]+b.left,a[1]+b.top]}',pdf)
    def click(pdf):page.mouse.click(*point(pdf))
    def tool(t):page.locator('.toolbar [data-tool="'+t+'"]').click()
    def drag(a,b):page.mouse.move(*point(a));page.mouse.down();page.mouse.move(*point(b),steps=6);page.mouse.up()
    tool('count');click([510,400]);assert page.evaluate('Object.keys(planforge.project.markups).length')==12
    page.keyboard.press('Control+z');assert page.evaluate('Object.keys(planforge.project.markups).length')==11
    page.keyboard.press('Control+Shift+z');assert page.evaluate('Object.keys(planforge.project.markups).length')==12
    checks.append('count placement and undo/redo')
    tool('length');click([450,370]);click([600,370]);assert page.evaluate('Object.values(planforge.project.markups).at(-1).type')=='length'
    page.locator('.toolbar [data-tool="select"]').click();click([520,370]);drag([600,370],[630,370]);assert abs(page.evaluate('Object.values(planforge.project.markups).at(-1).points[1][0]')-630)<.1
    checks.append('length creation and vertex editing')
    tool('area')
    for p in [[700,400],[820,400],[820,460],[700,460]]:click(p)
    page.keyboard.press('Enter');assert page.evaluate('Object.values(planforge.project.markups).at(-1).type')=='area'
    assert page.locator('#total-area').inner_text()=='107'
    checks.append('simple polygon area = 8 m²')
    tool('cloud');drag([590,120],[730,165]);assert page.evaluate('Object.values(planforge.project.markups).at(-1).type')=='cloud';checks.append('revision cloud drag')
    tool('callout');click([700,420]);click([560,165]);page.locator('#dialog textarea').fill('Coordinate service access');page.locator('#dialog-submit').click();page.wait_for_timeout(150);assert page.evaluate('Object.values(planforge.project.markups).at(-1).label')=='Coordinate service access';checks.append('callout dialog and text')
    page.locator('[data-panel="layers"]').click();page.locator('[data-layer-lock="takeoff"]').click();before=page.evaluate('Object.keys(planforge.project.markups).length');tool('count');click([510,400]);assert page.evaluate('Object.keys(planforge.project.markups).length')==before;page.locator('[data-layer-lock="takeoff"]').click();checks.append('locked-layer mutation prevention')
    page.evaluate('planforge.setTool("calibrate")');click([190,226]);click([730,226]);page.locator('#dialog input[name=distance]').fill('18');page.locator('#dialog-submit').click();page.wait_for_timeout(150);assert abs(page.evaluate('planforge.pg.calibration.metersPerUnit')-1/30)<1e-9;checks.append('two-point physical calibration')
    page.evaluate('planforge.action("demooverlay")');page.wait_for_function('planforge.overlaySource && planforge.project.overlay.config.visible');page.wait_for_timeout(700);page.screenshot(path=str(out/'overlay.png'),full_page=True)
    page.locator('#left-content input[name="ov-dx"]').fill('12');page.locator('#left-content input[name="ov-dx"]').press('Tab');assert page.evaluate('planforge.project.overlay.config.dx')==12;page.evaluate('planforge.history.undo()');assert page.evaluate('planforge.project.overlay.config.dx')==0;checks.append('real revision PDF overlay and registration history')
    page.evaluate('planforge.go(2)');page.evaluate('planforge.action("rotate")');page.wait_for_timeout(600);assert page.evaluate('planforge.pg.extraRotation')==90;checks.append('page navigation and rotated PDF rendering')
    page.evaluate('planforge.go(1)');page.evaluate('planforge.setTool("select")');page.evaluate('planforge.action("exportpdf")');page.wait_for_timeout(400)
    if page.evaluate('!!window.__downloads'):
        names=page.evaluate('__downloads.map(d=>d.name)');assert 'planforge-reviewed.pdf' in names
        data=page.evaluate('async()=>{const x=__downloads.find(d=>d.name==="planforge-reviewed.pdf");return enc(new Uint8Array(await x.data.arrayBuffer()))}');(out/'reviewed.pdf').write_bytes(base64.b64decode(data));checks.append('actual PDF annotation export')
        page.evaluate('planforge.action("save")');page.wait_for_timeout(150);assert page.evaluate('__downloads.some(d=>d.name.endsWith(".planforge"))');checks.append('binary project archive export')
    return checks

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--isolated',action='store_true');ap.add_argument('--url',default='http://localhost:8080');ap.add_argument('--output',default=str(ROOT/'test-results'));ap.add_argument('--chromium',default='/usr/bin/chromium');args=ap.parse_args();out=Path(args.output);out.mkdir(exist_ok=True,parents=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=args.chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-webgpu','--use-angle=swiftshader'])
        page=browser.new_page(viewport={'width':1600,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
        if args.isolated:isolated(page)
        else:page.goto(args.url)
        try:
            checks=run(page,out);assert not errors,errors
            result={'mode':'isolated DOM + real MuPDF API bridge' if args.isolated else 'normal browser','renderer':page.evaluate('planforge.compositor.mode'),'checks':checks,'errors':errors,'not_tested':['WebGPU execution','real HTTP fetch','IndexedDB persistence','PDF.js and PDF-LIB browser integration'] if args.isolated else []}
            (out/'browser-results.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
        except Exception:
            page.screenshot(path=str(out/'failure.png'),full_page=True);print('PAGE ERRORS:',errors);print('STATE:',page.evaluate('({source:!!window.planforge?.source,toast:document.querySelector("#toast").textContent,tool:window.planforge?.tool})'));raise
        finally:browser.close()
