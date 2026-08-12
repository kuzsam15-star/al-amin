@echo off
setlocal
title AL-AMIN SEC-001 controlled release
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-Sec001Release.ps1"
set "code=%ERRORLEVEL%"
echo.
echo SEC-001 release wrapper finished with exit code %code%.
pause
exit /b %code%
