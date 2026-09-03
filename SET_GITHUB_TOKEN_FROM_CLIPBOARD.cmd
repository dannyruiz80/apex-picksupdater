@echo off
setlocal
cd /d "%~dp0"
title Apex Picks - GitHub Token Setup

echo ============================================================
echo       APEX PICKS - SAVE GITHUB TOKEN FROM CLIPBOARD
echo ============================================================
echo.
echo 1. In GitHub, copy your NEW Apex Picks Updater token.
echo 2. Come back to this window.
echo 3. Press any key. Apex will read the token from your clipboard.
echo.
echo The token will NOT be displayed in this window.
echo.
pause >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=(Get-Clipboard -Raw).Trim(); if([string]::IsNullOrWhiteSpace($t)){Write-Host 'Clipboard is empty.' -ForegroundColor Red; exit 2}; if(-not ($t.StartsWith('github_pat_') -or $t.StartsWith('ghp_'))){Write-Host 'Clipboard does not look like a GitHub token.' -ForegroundColor Red; exit 3}; Set-Content -LiteralPath '.update.env' -Value ('GITHUB_TOKEN='+$t) -NoNewline -Encoding ascii"
if errorlevel 1 (
  echo.
  echo Token was NOT saved.
  echo Copy the GitHub token again and rerun this file.
  echo.
  pause
  exit /b 1
)

echo.
echo GitHub token saved locally to .update.env.
echo It was not uploaded to GitHub and was not displayed here.
echo.
if not exist "apex-update.json" (
  echo NOTE: apex-update.json was not found in this folder.
  echo Put this file in the main ApexPicks folder and run it again.
  echo.
  pause
  exit /b 2
)

echo Testing private GitHub release access...
node "%~dp0updater\CHECK_FOR_UPDATES.cjs"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo SUCCESS: GitHub updater authentication is working.
  echo You can now launch Apex normally with START_APEX.cmd.
) else (
  echo The token was saved, but the update test returned code %RC%.
  echo If you still see HTTP 401, regenerate the token with:
  echo   Repository: apex-picksupdater only
  echo   Contents permission: Read-only
)
echo.
pause
