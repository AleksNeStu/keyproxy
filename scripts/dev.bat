@echo off
cd /d "%~dp0"
echo Starting KeyProxy Dev (auto-reload)...
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0dev.ps1'"
echo.
pause
