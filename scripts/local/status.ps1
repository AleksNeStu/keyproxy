<#
.SYNOPSIS
    Show KeyProxy status (local process or service).
#>
param([int]$Port = 8990)

# Check Windows Service first
$svc = Get-Service -Name 'keyproxy.exe' -ErrorAction SilentlyContinue
if ($svc) {
    $color = if ($svc.Status -eq 'Running') { 'Green' } else { 'Red' }
    Write-Host "Service: $($svc.Status.ToString().ToUpper()) | StartType: $($svc.StartType)" -ForegroundColor $color
}

# Check port
$occupant = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

if ($occupant) {
    $procId = $occupant[0]
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    Write-Host "Process: RUNNING (PID $procId, $($proc.ProcessName)) | Port $Port" -ForegroundColor Green
} else {
    Write-Host "Process: STOPPED | Port $Port free" -ForegroundColor Red
}

Write-Host "Admin: http://localhost:$Port/admin" -ForegroundColor Gray
