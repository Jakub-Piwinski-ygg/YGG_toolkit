@echo off
setlocal
cd /d "%~dp0react-app"

if not exist node_modules (
  echo Installing dependencies. This only happens once...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Make sure Node.js is installed and on PATH.
    pause
    exit /b 1
  )
)

echo Starting dev server and opening browser...
call npm run dev -- --open

pause
