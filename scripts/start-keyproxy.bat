@echo off
cd /d "%~dp0"
echo Starting KeyProxy...
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0manage.ps1' start"
echo.
pause
