@echo off
REM Double-click / cmd launcher for Olive Studio (Tauri desktop)
REM Delegates to launch-tauri.ps1 (includes stop-before-start of port 3000 / leftovers).
setlocal
cd /d "%~dp0"

where powershell >nul 2>&1
if errorlevel 1 (
  echo PowerShell is required to launch Olive Studio desktop.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-tauri.ps1" %*
exit /b %ERRORLEVEL%
