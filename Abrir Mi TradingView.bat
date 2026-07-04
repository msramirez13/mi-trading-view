@echo off
title Mi TradingView - Servidor
cd /d "%~dp0"
echo.
echo   Mi TradingView corriendo en http://localhost:8766
echo   Cerra esta ventana para apagar el servidor.
echo.
start "" http://localhost:8766
python -m http.server 8766
