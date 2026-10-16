@echo off
rem Get the latest version from GitHub, rebuild and restart. Run as administrator
rem if the tracker runs as a background task. The database and backups are kept.
title Update Design Iteration Tracker
cd /d "%~dp0"
set TASK=Design Iteration Tracker

schtasks /Query /TN "%TASK%" >nul 2>&1 && (
  echo Stopping the background tracker...
  schtasks /End /TN "%TASK%" >nul 2>&1
  timeout /t 3 /nobreak >nul
)
echo Getting the latest version...
git pull --ff-only || goto :error
call npm install --no-audit --no-fund || goto :error
echo Building...
call npm run build || goto :error

schtasks /Query /TN "%TASK%" >nul 2>&1 && (
  schtasks /Run /TN "%TASK%" >nul
  echo Updated and restarted.
) || (
  echo Updated. Start it again with start.bat.
)
pause
exit /b 0

:error
echo.
echo The update did not finish. The tracker was not changed. See the messages above.
schtasks /Query /TN "%TASK%" >nul 2>&1 && schtasks /Run /TN "%TASK%" >nul
pause
exit /b 1
