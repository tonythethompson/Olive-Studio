@echo off
REM Double-click / cmd launcher for Olive Studio (Tauri desktop)
REM Delegates to launch-tauri.ps1 (includes stop-before-start of port 3000 / leftovers).
setlocal
cd /d "%~dp0"

set "PS_EXE="
where powershell >nul 2>&1
if not errorlevel 1 (
  set "PS_EXE=powershell"
) else (
  where pwsh >nul 2>&1
  if not errorlevel 1 (
    set "PS_EXE=pwsh"
  )
)

if not defined PS_EXE (
  echo PowerShell is required to launch Olive Studio desktop.
  echo Install Windows PowerShell or PowerShell 7 ^(pwsh^).
  exit /b 1
)

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-tauri.ps1" %*
exit /b %ERRORLEVEL%
