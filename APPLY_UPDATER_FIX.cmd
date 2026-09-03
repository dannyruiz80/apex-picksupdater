@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Apex Picks - Updater Cleanup Fix

cls
echo ============================================================
echo             APEX PICKS - UPDATER CLEANUP FIX
echo ============================================================
echo.
echo This fixes the false uv_async.c error that can appear AFTER
echo GitHub successfully says your installed Apex version is current.
echo.

set "APEX_ROOT=%~dp0"
if exist "%APEX_ROOT%updater\CHECK_FOR_UPDATES.cjs" goto found

REM If this patch was extracted into its own folder inside ApexPicks,
REM try the parent folder automatically.
for %%I in ("%APEX_ROOT%..") do set "PARENT=%%~fI\"
if exist "%PARENT%updater\CHECK_FOR_UPDATES.cjs" (
  set "APEX_ROOT=%PARENT%"
  goto found
)

echo Could not find updater\CHECK_FOR_UPDATES.cjs.
echo.
echo Copy these two patch files into your ApexPicks folder -- the same
 echo folder that contains START_APEX.cmd -- then run this file again.
echo.
pause
exit /b 2

:found
echo Apex folder found:
echo %APEX_ROOT%
echo.

if not exist "%~dp0CHECK_FOR_UPDATES_FIXED.cjs" (
  echo Missing CHECK_FOR_UPDATES_FIXED.cjs beside this patch file.
  pause
  exit /b 2
)

if not exist "%APEX_ROOT%updater\CHECK_FOR_UPDATES.cjs.pre-uv-fix.bak" (
  copy /y "%APEX_ROOT%updater\CHECK_FOR_UPDATES.cjs" "%APEX_ROOT%updater\CHECK_FOR_UPDATES.cjs.pre-uv-fix.bak" >nul
)
copy /y "%~dp0CHECK_FOR_UPDATES_FIXED.cjs" "%APEX_ROOT%updater\CHECK_FOR_UPDATES.cjs" >nul
if errorlevel 1 (
  echo Failed to replace the updater file.
  pause
  exit /b 2
)

echo Updater cleanup fix installed.
echo Your GitHub repo/token settings were NOT changed.
echo.
echo Testing update access now...
echo ------------------------------------------------------------
node "%APEX_ROOT%updater\CHECK_FOR_UPDATES.cjs"
set "RC=%ERRORLEVEL%"
echo ------------------------------------------------------------
echo.
if "%RC%"=="0" (
  echo SUCCESS: GitHub updater check completed cleanly.
  echo You can now use START_APEX.cmd normally.
) else (
  echo The updater returned code %RC%.
  echo If the text above contains an HTTP error, send a screenshot.
)
echo.
pause
exit /b %RC%
