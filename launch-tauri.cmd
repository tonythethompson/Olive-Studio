@echo off
REM Double-click / cmd launcher for Olive Studio (Tauri desktop)
setlocal
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm is required. Install with: npm install -g pnpm@11.17.0
  exit /b 1
)

where cargo >nul 2>&1
if errorlevel 1 (
  echo Rust / cargo is required for the Tauri shell.
  echo Install from https://rustup.rs/ then reopen this terminal.
  exit /b 1
)

if not exist "node_modules\" (
  echo node_modules missing — running pnpm install...
  call pnpm install
  if errorlevel 1 exit /b 1
)

echo Starting Olive Studio desktop ^(Tauri dev^)...
echo   Web backend: http://127.0.0.1:3000 ^(auto via beforeDevCommand^)
echo   Ctrl+C to stop both the window and the web server.
call pnpm tauri:dev
exit /b %ERRORLEVEL%
