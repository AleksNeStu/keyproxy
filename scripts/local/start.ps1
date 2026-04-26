<#
.SYNOPSIS
    Start KeyProxy as a local process (no Windows Service).
.DESCRIPTION
    Starts node main.js in the background. Kills any existing process on port 8990 first.
#>
param([int]$Port = 8990)

$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

# Kill existing process on port
$occupant = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if ($occupant) {
    foreach ($pid in $occupant) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Killing existing process on port $Port (PID $pid)" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 500
}

# Start in background
Set-Location $ProjectRoot
$proc = Start-Process -FilePath "node" -ArgumentList "main.js" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "logs\stdout.log" -RedirectStandardError "logs\stderr.log"

Start-Sleep -Milliseconds 1000

if ($proc -and -not $proc.HasExited) {
    Write-Host "KeyProxy started (PID $($proc.Id), Port $Port)" -ForegroundColor Green
    Write-Host "Admin: http://localhost:$Port/admin" -ForegroundColor Gray
} else {
    Write-Host "Failed to start KeyProxy. Check logs\stderr.log" -ForegroundColor Red
}
