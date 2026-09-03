@echo off
setlocal
cd /d "%~dp0"
title Apex Picks Auto Update Setup
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Launch Apex Picks once after installing Node.js LTS.
  pause
  exit /b 1
)
node "%~dp0updater\CONFIGURE_UPDATES.cjs"
pause
