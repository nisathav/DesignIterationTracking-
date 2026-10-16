@echo off
rem Used by the scheduled task created by scripts\windows\setup-windows.bat.
rem Runs the tracker without a window and appends its output to logs\tracker.log.
cd /d "%~dp0"
if not exist logs mkdir logs
node dist\server\index.js >> logs\tracker.log 2>&1
exit /b %ERRORLEVEL%
