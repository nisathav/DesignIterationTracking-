@echo off
rem One-time setup on the tracker PC: run in the background at start-up and open the firewall port.
rem Right-click this file and choose "Run as administrator".
rem To undo:  setup-windows.bat remove
net session >nul 2>&1 || (
  echo Please right-click setup-windows.bat and choose "Run as administrator".
  pause
  exit /b 1
)
if /i "%~1"=="remove" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1" -Remove
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows.ps1"
)
pause
