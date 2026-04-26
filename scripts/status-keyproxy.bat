@echo off
cd /d "%~dp0"
echo KeyProxy Status:
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0manage.ps1' status"
echo.
pause
