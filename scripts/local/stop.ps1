<#
.SYNOPSIS
    Stop local KeyProxy process.
.DESCRIPTION
    Kills any process listening on port 8990.
#>
param([int]$Port = 8990)

$occupant = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if ($occupant) {
    foreach ($pid in $occupant) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Stopping KeyProxy (PID $pid, Port $Port)" -ForegroundColor Yellow
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Milliseconds 500

    $check = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $check) {
        Write-Host "KeyProxy stopped." -ForegroundColor Green
    } else {
        Write-Host "Port $Port still occupied." -ForegroundColor Red
    }
} else {
    Write-Host "No process on port $Port." -ForegroundColor Gray
}
