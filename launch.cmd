@echo off
REM Double-click / cmd launcher for Olive Studio (browser / web only).
REM For the desktop app, use launch-tauri.cmd
setlocal
cd /d "%~dp0"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo pnpm is required. Install with: npm install -g pnpm@11.17.0
  exit /b 1
)

if not exist "node_modules\" (
  echo node_modules missing — running pnpm install...
  call pnpm install
  if errorlevel 1 exit /b 1
)

echo Starting Olive Studio (dev) at http://localhost:3000 ...
start "" "http://localhost:3000"
call pnpm dev
exit /b %ERRORLEVEL%
