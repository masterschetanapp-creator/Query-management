@echo off
setlocal
cd /d "%~dp0"
set PORT=8788
start "" http://127.0.0.1:%PORT%/index.html
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0LeadTracker_Server.ps1" -Port %PORT%
