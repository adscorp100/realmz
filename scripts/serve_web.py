#!/usr/bin/env python3
"""Serves build_web/ for local play or a tunnel, with caching disabled.

Browsers and CDNs (Cloudflare caches .css/.js by default) must never mix files
from different builds, so every response says no-store.
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build_web")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".webmanifest": "application/manifest+json",
        ".ttf": "font/ttf",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s [%s] %s\n" % (self.headers.get("CF-Connecting-IP", self.client_address[0]),
                                           self.log_date_time_string(), fmt % args))


http.server.ThreadingHTTPServer(("", PORT), Handler).serve_forever()
