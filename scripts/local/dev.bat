@echo off
cd /d "%~dp0"
echo Starting KeyProxy Dev (auto-reload)...
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
