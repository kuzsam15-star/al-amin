@echo off
setlocal
title AL-AMIN encrypted recovery proof
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-AlAminRecoveryProof.ps1"
set "ALAMIN_EXIT=%ERRORLEVEL%"
echo.
if not "%ALAMIN_EXIT%"=="0" echo Recovery workflow stopped safely. No production changes were made.
pause
exit /b %ALAMIN_EXIT%
