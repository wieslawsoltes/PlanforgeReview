#!/usr/bin/env python3
"""Actual loopback HTTP server smoke tests (no browser policy modifications)."""
from __future__ import annotations
import json, os, socket, subprocess, sys, time, unittest
from pathlib import Path
from urllib.request import Request, urlopen
ROOT = Path(__file__).resolve().parents[1]

def port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

class HTTPTests(unittest.TestCase):
    def exercise(self, python):
        p = port()
        env = {**os.environ, 'PORT': str(p)}
        command = [sys.executable, 'server.py', '--port', str(p)] if python else ['node', 'server.mjs']
        process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        root = f'http://127.0.0.1:{p}'
        try:
            for _ in range(50):
                try:
                    with urlopen(root + '/index.html', timeout=1) as r:
                        self.assertIn(b'Planforge', r.read())
                    break
                except OSError:
                    if process.poll() is not None:
                        self.fail(process.stderr.read().decode())
                    time.sleep(.05)
            else:
                self.fail('Server did not become ready')
            with urlopen(root + '/src/app.js', timeout=5) as r:
                self.assertIn('javascript', r.headers['Content-Type'])
                self.assertIn(b'class App', r.read())
            with urlopen(root + '/assets/riverside-drawing-set.pdf', timeout=5) as r:
                pdf = r.read()
                self.assertTrue(pdf.startswith(b'%PDF-'))
            if python:
                with urlopen(root + '/api/health', timeout=5) as r:
                    self.assertEqual(json.load(r)['backend'], 'mupdf')
                request = Request(root + '/api/docs', data=pdf, headers={'Content-Type': 'application/pdf'})
                with urlopen(request, timeout=5) as r:
                    document = json.load(r)
                    self.assertEqual(len(document['pages']), 3)
                tile = root + f"/api/tile?id={document['id']}&page=1&scale=1&x=0&y=0&w=128&h=128"
                with urlopen(tile, timeout=5) as r:
                    self.assertEqual(r.headers['Content-Type'], 'image/png')
                    self.assertTrue(r.read().startswith(b'\x89PNG'))
                with urlopen(Request(root + '/api/docs?id=' + document['id'], method='DELETE'), timeout=5) as r:
                    self.assertTrue(json.load(r)['ok'])
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stderr.close()
    def test_node_static_server(self):
        self.exercise(False)
    def test_mupdf_server_and_actual_http_pdf_tile(self):
        self.exercise(True)

if __name__ == '__main__':
    unittest.main(verbosity=2)
