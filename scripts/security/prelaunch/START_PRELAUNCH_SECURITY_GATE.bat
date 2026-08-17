@echo off
setlocal
title AL-AMIN local pre-launch security gate
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-PrelaunchSecurityGate.ps1"
set EXIT_CODE=%ERRORLEVEL%
echo.
if not "%EXIT_CODE%"=="0" echo Gate did not report READY. No remote system was changed.
pause
exit /b %EXIT_CODE%
