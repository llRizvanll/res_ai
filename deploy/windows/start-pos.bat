@echo off
REM Starts the Restaurant POS (keeps running and restarts itself if it crashes).
REM Double-click to start. To start automatically with Windows, run install-autostart.bat once.
cd /d "%~dp0..\.."
set TZ=Asia/Kolkata
title Restaurant POS - keep this window open
node --no-warnings --env-file-if-exists=.env dist\server\supervisor.js
pause
