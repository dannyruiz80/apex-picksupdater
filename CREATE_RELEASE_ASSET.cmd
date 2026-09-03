@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required.
  pause
  exit /b 1
)
node "%~dp0updater\BUILD_RELEASE_ASSET.cjs"
if errorlevel 1 (
  echo Release asset build failed.
  pause
  exit /b 1
)
echo.
echo Created: apex-picks-windows-app.zip
echo Upload that file to the matching GitHub Release.
pause
