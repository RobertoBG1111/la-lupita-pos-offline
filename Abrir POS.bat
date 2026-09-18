@echo off
rem ── Lanzador del POS Modelorama "La Lupita" ────────────────────────────────
rem Doble clic en este archivo para abrir el punto de venta.
rem Levanta un servidor local (necesario porque la app usa modulos ES) y abre
rem el navegador. Para APAGAR el POS, cierra la ventana negra del servidor.

cd /d "%~dp0"

rem Arranca el servidor local en una ventana minimizada (sirve app/ con no-cache).
start /min "POS - servidor (no cerrar mientras uses el POS)" python serve.py

rem Espera 2 segundos a que el servidor este listo y abre el navegador.
timeout /t 2 /nobreak >nul
start "" "http://localhost:5500/"

exit
