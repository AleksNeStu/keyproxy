<#
.SYNOPSIS
    Start KeyProxy silently in the background (no console window).
.DESCRIPTION
    Kills any process on port 8990, then starts node main.js hidden.
    Logs go to logs/ directory as usual.
#>

param([int]$Port = 8990)

$ErrorActionPreference = 'Continue'

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Kill existing process on port
$occupant = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if ($occupant) {
    foreach ($procId in $occupant) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}

# Ensure logs directory exists
if (-not (Test-Path "$ProjectRoot\logs")) { New-Item -ItemType Directory -Path "$ProjectRoot\logs" -Force | Out-Null }

# Start node in background, hidden window
Start-Process -FilePath 'node' `
              -ArgumentList 'main.js' `
              -WorkingDirectory $ProjectRoot `
              -WindowStyle Hidden `
              -RedirectStandardOutput "$ProjectRoot\logs\stdout.log" `
              -RedirectStandardError "$ProjectRoot\logs\stderr.log"

Write-Host "KeyProxy started silently on port $Port" -ForegroundColor Green
