#!/usr/bin/env python3
# Servidor estático del POS "La Lupita".
# Sirve la carpeta app/ en el puerto 5500 con Cache-Control: no-store, para que
# el navegador nunca use versiones viejas de los módulos tras una actualización.
# Los archivos vienen del propio localhost, así que funciona igual sin internet.
import http.server
import socketserver
import os

PUERTO = 5500
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def log_message(self, *args):
        pass  # silencio


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PUERTO), Handler) as httpd:
    print(f"POS La Lupita sirviendo en http://localhost:{PUERTO}/")
    httpd.serve_forever()
