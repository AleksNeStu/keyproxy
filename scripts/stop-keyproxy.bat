@echo off
cd /d "%~dp0"
echo Stopping KeyProxy...
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0manage.ps1' stop"
echo.
pause
