@echo off
cd /d "%~dp0"
echo Restarting KeyProxy...
echo.
powershell -ExecutionPolicy Bypass -Command "& '%~dp0manage.ps1' restart"
echo.
pause
