from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
from analyzer import analyze

ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def do_GET(self):
        if self.path.split('?', 1)[0] == '/api/health':
            payload = json.dumps({'ok': True, 'service': 'CodeLens analysis engine', 'version': '1.3.3'}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(payload)
            return
        super().do_GET()
    def do_POST(self):
        if self.path != '/api/analyze':
            self.send_error(404); return
        try:
            length = int(self.headers.get('Content-Length','0'))
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            source = body.get('source','')
            if not isinstance(source,str) or not source.strip():
                result = {'error':'Paste or upload some C/C++ source code first.'}
                self.send_response(400)
            elif len(source) > 200_000:
                result = {'error':'Source is too large for this demo (maximum 200 KB).'}
                self.send_response(413)
            else:
                result = analyze(source)
                self.send_response(200)
            payload = json.dumps(result).encode()
            self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(payload)))
            self.send_header('Cache-Control','no-store')
            self.end_headers(); self.wfile.write(payload)
        except Exception as exc:
            payload = json.dumps({'error':f'Analysis failed safely: {exc}'}).encode()
            self.send_response(500); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(payload))); self.end_headers(); self.wfile.write(payload)
    def log_message(self, fmt, *args):
        print('[web]', fmt % args)

if __name__ == '__main__':
    print('\nCompiler-Based Redundant Code Detection and Explanation')
    print('Open http://127.0.0.1:8023 in your browser. Press Ctrl+C to stop.\n')
    host = os.environ.get('CODELENS_HOST', '127.0.0.1')
    port = int(os.environ.get('CODELENS_PORT', '8023'))
    print(f'Local server: http://{host}:{port}')
    ThreadingHTTPServer((host, port), Handler).serve_forever()
