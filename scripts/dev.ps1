<#
.SYNOPSIS
    KeyProxy Dev Start — force-kills port 8990, starts with auto-reload.
.DESCRIPTION
    For development. Uses node --watch (Node 18+) to auto-restart on .js changes.
    Kills any process occupying port 8990 before starting.
#>

param([int]$Port = 8990)

$ErrorActionPreference = 'Continue'

# --- Force-kill anything on the port ---
Write-Host "`n--- KeyProxy Dev ---" -ForegroundColor Cyan
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

# --- Start with auto-reload ---
Write-Host "Starting node --watch main.js  (edit any .js file to auto-restart)`n" -ForegroundColor Cyan

Set-Location (Split-Path $PSScriptRoot -Parent)
node --watch main.js
