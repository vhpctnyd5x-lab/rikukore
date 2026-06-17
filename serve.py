#!/usr/bin/env python3
# 陸これ ローカルサーバ（キャッシュ無効）。
# ブラウザが game.js / style.css / index.html を古いままキャッシュして
# 「最新版にならない」問題を防ぐため、毎回 no-store ヘッダを返す。
import http.server, socketserver, os, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, *a):  # ログ抑制
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
    print(f"陸これサーバ起動: http://localhost:{PORT}/src/index.html （キャッシュ無効）")
    httpd.serve_forever()
