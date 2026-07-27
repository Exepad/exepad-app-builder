@echo off
rem Exepad one-click installer (Windows).
rem Double-click me. I run the bundled install.ps1 with the Windows PowerShell
rem that ships with Windows 10/11 - no extra software needed. If Docker Desktop
rem is missing you will be guided through installing it (one time), then you
rem double-click this file again.
setlocal
title Exepad Installer
echo.
echo   Exepad installer - progress appears below.
echo.
if not exist "%~dp0install.ps1" (
  echo   install.ps1 was not found next to this file.
  echo   Extract the whole ZIP first ^(right-click the ZIP - Extract All...^),
  echo   then double-click "Install Exepad.bat" inside the extracted folder.
  echo.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
rem NEQ 0, not "errorlevel 1": powershell returns NEGATIVE codes on abnormal
rem termination (e.g. Ctrl-C), which "if errorlevel 1" would treat as success.
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo   The installer did not finish. Read the messages above, fix the issue
  echo   ^(usually: install or start Docker Desktop^), then double-click this
  echo   file again.
) else (
  echo.
  if "%~1"=="" (
    echo   Done. Opening http://localhost:8080 ...
    start "" "http://localhost:8080"
  ) else (
    echo   Done. Open the URL printed above in your browser.
  )
)
echo.
pause
endlocal
