# One-time setup of the Design Iteration Tracker on a Windows PC (run as administrator):
#  - installs and builds the app if needed,
#  - opens the TCP port in Windows Firewall for the office network (Domain and Private profiles),
#  - creates a scheduled task that starts the tracker in the background when the PC starts
#    (no one needs to be logged in) and restarts it if it stops,
#  - starts it now and shows the address colleagues should use.
# Run with -Remove to delete the task and the firewall rule (data is kept).
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'Design Iteration Tracker'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$port = 8080
$configFile = Join-Path $root 'config.json'
if (Test-Path $configFile) {
  $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
  if ($cfg.port) { $port = [int]$cfg.port }
}

if ($Remove) {
  Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Write-Host "Removed the start-up task and the firewall rule. The data folder and backups were not touched."
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js is not installed. Install the LTS version from https://nodejs.org (for all users) and run this again.' -ForegroundColor Red
  exit 1
}

Push-Location $root
try {
  if (-not (Test-Path 'node_modules')) { Write-Host 'Installing...'; npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm install failed' } }
  if (-not (Test-Path 'dist\server\index.js')) { Write-Host 'Building...'; npm run build; if ($LASTEXITCODE) { throw 'build failed' } }
} finally { Pop-Location }

Write-Host "Opening port $port in Windows Firewall (office network only)..."
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Domain,Private | Out-Null

Write-Host 'Creating the start-up task...'
$action = New-ScheduledTaskAction -Execute (Join-Path $root 'run-service.bat') -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 4

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'Done. The tracker now runs in the background and starts with the PC.' -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "  Colleagues open:  http://${ip}:$port" }
Write-Host "  Or by PC name:    http://$($env:COMPUTERNAME):$port"
Write-Host ''
Write-Host "Log file: $root\logs\tracker.log"
$pw = Join-Path $root 'data\initial-passwords.txt'
if (Test-Path $pw) { Write-Host "First start: temporary passwords are in $pw" -ForegroundColor Yellow }
Write-Host 'Also set this PC to never sleep: Settings > System > Power.'
