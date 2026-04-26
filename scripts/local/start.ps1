<#
.SYNOPSIS
    Start KeyProxy (auto-reload on .js changes).
.DESCRIPTION
    Kills any process on port 8990, then starts node --watch main.js.
    Requires Node 18+ for --watch support.
#>

param([int]$Port = 8990)

$ErrorActionPreference = 'Continue'

Write-Host "`n--- KeyProxy ---" -ForegroundColor Cyan
Write-Host "Checking port $Port..." -NoNewline

$occupant = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if ($occupant) {
    foreach ($procId in $occupant) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host " occupied by PID $procId ($($proc.ProcessName))" -ForegroundColor Yellow
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
            Write-Host "  Killed." -ForegroundColor Yellow
        }
    }
    Start-Sleep -Milliseconds 500
} else {
    Write-Host " free." -ForegroundColor Green
}

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $ProjectRoot

if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" -Force | Out-Null }

Write-Host "Starting node --watch main.js`n" -ForegroundColor Cyan
node --watch main.js
