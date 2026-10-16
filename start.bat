@echo off
rem Design Iteration Tracker - start in this window.
rem Keep the window open while people use the tracker; close it (or press Ctrl+C) to stop.
rem To run it in the background whenever the PC starts, run scripts\windows\setup-windows.bat once instead.
title Design Iteration Tracker
cd /d "%~dp0"

where node >nul 2>&1 || (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing - first run, this takes a few minutes...
  call npm install --no-audit --no-fund || goto :error
)
if not exist dist\server\index.js (
  echo Building...
  call npm run build || goto :error
)
node dist\server\index.js
echo.
echo The tracker has stopped.
pause
exit /b 0

:error
echo.
echo Something went wrong. See the messages above.
pause
exit /b 1
