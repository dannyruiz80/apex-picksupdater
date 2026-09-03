@echo off
setlocal
cd /d "%~dp0"
title Apex Picks Launcher

cls
echo ============================================================
echo                 APEX PICKS - ONE CLICK
echo ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or not available in PATH.
  echo.
  echo Opening the official Node.js download page...
  start "" "https://nodejs.org/en/download"
  echo.
  echo Install the LTS version, then double-click START_APEX.cmd again.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS, then try again.
  pause
  exit /b 1
)

echo Checking for Apex updates...
node "%~dp0updater\CHECK_FOR_UPDATES.cjs"
if errorlevel 2 (
  echo.
  echo Update check failed, but Apex can still start with the installed version.
  echo.
)

cd /d "%~dp0app"
node "%~dp0app\SETUP_API_KEY.cjs"
if errorlevel 1 (
  echo.
  echo API setup was not completed.
  pause
  exit /b 1
)

if not exist "node_modules\tsx\dist\cli.mjs" (
  echo.
  echo Installing or refreshing Apex components...
  echo This is automatic and normally only happens after an update.
  echo.
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Installation failed. Copy the error above and send it to ChatGPT.
    pause
    exit /b 1
  )
)

echo.
echo Starting Apex Picks...
echo Browser will open automatically.
echo Keep this window open while you use the app.
echo Press Ctrl+C here when you want to stop Apex Picks.
echo.

start "" cmd.exe /c "timeout /t 5 /nobreak >nul & start http://localhost:3000"
call npm.cmd run dev

echo.
echo Apex Picks has stopped.
pause
