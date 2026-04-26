param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('install', 'uninstall', 'start', 'stop', 'restart', 'status', 'logs', 'watch')]
    [string]$Command
)

$KeyProxyDir = Split-Path $PSScriptRoot -Parent
$Port = 8990
$ServiceName = 'keyproxy.exe'
$AdminUrl = "http://localhost:${Port}/admin"

# --- Helpers ---

function Test-Admin {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
    if (-not (Test-Admin)) {
        Write-Host "This command requires Administrator privileges. Relaunching elevated..." -ForegroundColor Yellow
        Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $Command" -Wait
        exit 0
    }
}

function Get-ServiceState {
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) { return $svc }
    # Check if running as standalone process (no service)
    $conns = netstat -ano 2>$null | findstr ":$Port"
    if ($conns) {
        foreach ($line in ($conns -split "`n")) {
            if ($line -match "LISTENING") {
                $pidStr = (($line.Trim() -split '\s+')[-1])
                if ($pidStr -match '^\d+$' -and [int]$pidStr -ne 0) {
                    return [PSCustomObject]@{ Name = "$ServiceName (process)"; Status = "Running"; StartType = "Manual"; Pid = [int]$pidStr }
                }
            }
        }
    }
    return $null
}

# --- Commands ---

switch ($Command) {
    'install' {
        Assert-Admin
        Write-Host "Installing KeyProxy as Windows Service..." -ForegroundColor Cyan

        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "Service already exists (Status: $($svc.Status)). Use 'uninstall' first to reinstall." -ForegroundColor Yellow
            return
        }

        # Kill standalone process if running
        $state = Get-ServiceState
        if ($state -and $state.Pid) {
            Write-Host "Stopping standalone process (PID: $($state.Pid))..." -ForegroundColor Gray
            Stop-Process -Id $state.Pid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }

        Push-Location $KeyProxyDir
        node "$PSScriptRoot\service.js"
        Pop-Location

        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Host "Service installed and started." -ForegroundColor Green
            Write-Host "  Name: $ServiceName | Port: $Port | Admin: $AdminUrl" -ForegroundColor Gray
        } else {
            Write-Host "Failed to install service. Check console output above." -ForegroundColor Red
        }
    }

    'uninstall' {
        Assert-Admin
        Write-Host "Removing KeyProxy Windows Service..." -ForegroundColor Cyan

        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc) {
            Write-Host "Service not found. Nothing to uninstall." -ForegroundColor Yellow
            return
        }

        if ($svc.Status -eq 'Running') {
            Write-Host "Stopping service..." -ForegroundColor Gray
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }

        Push-Location $KeyProxyDir
        node "$PSScriptRoot\service.js" uninstall
        Pop-Location

        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if (-not $svc) {
            Write-Host "Service removed." -ForegroundColor Green
        } else {
            Write-Host "Service still exists. Try manually: sc delete $ServiceName" -ForegroundColor Red
        }
    }

    'start' {
        Assert-Admin
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            if ($svc.Status -eq 'Running') {
                Write-Host "Service already running." -ForegroundColor Yellow
            } else {
                # Force-kill any process on port before starting service
                $conns = netstat -ano 2>$null | findstr ":$Port.*LISTENING"
                if ($conns) {
                    $pidStr = ((($conns -split "`n")[0].Trim() -split '\s+')[-1])
                    if ($pidStr -match '^\d+$' -and [int]$pidStr -ne 0) {
                        Write-Host "Killing existing process on port $Port (PID: $pidStr)..." -ForegroundColor Yellow
                        Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
                        Start-Sleep -Seconds 1
                    }
                }
                Start-Service -Name $ServiceName
                Start-Sleep -Seconds 2
                $svc = Get-Service -Name $ServiceName
                Write-Host "Service started (Status: $($svc.Status))." -ForegroundColor Green
            }
        } else {
            Write-Host "Service not installed. Use 'install' first." -ForegroundColor Red
        }
        Write-Host "  Admin: $AdminUrl" -ForegroundColor Gray
    }

    'stop' {
        Assert-Admin
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            if ($svc.Status -ne 'Running') {
                Write-Host "Service is not running (Status: $($svc.Status))." -ForegroundColor Yellow
            } else {
                Stop-Service -Name $ServiceName -Force
                Start-Sleep -Seconds 1
                Write-Host "Service stopped." -ForegroundColor Green
            }
        }
        # Always force-kill any process on port (standalone or service)
        $conns = netstat -ano 2>$null | findstr ":$Port.*LISTENING"
        if ($conns) {
            $pidStr = ((($conns -split "`n")[0].Trim() -split '\s+')[-1])
            if ($pidStr -match '^\d+$' -and [int]$pidStr -ne 0) {
                Write-Host "Killing process on port $Port (PID: $pidStr)..." -ForegroundColor Yellow
                Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
                Start-Sleep -Seconds 1
                Write-Host "Port $Port is now free." -ForegroundColor Green
            }
        } else {
            if (-not $svc) {
                Write-Host "Service not installed and no process running on port $Port." -ForegroundColor Gray
            }
        }
    }

    'restart' {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            Assert-Admin

            # Force-kill any process on the port before restarting
            $conns = netstat -ano 2>$null | findstr ":$Port.*LISTENING"
            if ($conns) {
                $pidStr = ((($conns -split "`n")[0].Trim() -split '\s+')[-1])
                if ($pidStr -match '^\d+$' -and [int]$pidStr -ne 0) {
                    Write-Host "Killing existing process on port $Port (PID: $pidStr)..." -ForegroundColor Gray
                    Stop-Process -Id ([int]$pidStr) -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 2
                }
            }

            # Stop service cleanly, then kill if hung
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2

            # Double-check port is free
            $conns2 = netstat -ano 2>$null | findstr ":$Port.*LISTENING"
            if ($conns2) {
                $pidStr2 = ((($conns2 -split "`n")[0].Trim() -split '\s+')[-1])
                if ($pidStr2 -match '^\d+$' -and [int]$pidStr2 -ne 0) {
                    Write-Host "Process still alive, force-killing PID: $pidStr2..." -ForegroundColor Yellow
                    Stop-Process -Id ([int]$pidStr2) -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 2
                }
            }

            Start-Service -Name $ServiceName
            Start-Sleep -Seconds 2
            $svc = Get-Service -Name $ServiceName
            Write-Host "Service restarted (Status: $($svc.Status))." -ForegroundColor Green
        } else {
            Write-Host "Service not installed. Use 'install' first." -ForegroundColor Red
        }
    }

    'status' {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc) {
            $statusColor = if ($svc.Status -eq 'Running') { 'Green' } else { 'Red' }
            Write-Host "Service: $($svc.Status.ToString().ToUpper()) | StartType: $($svc.StartType) | Port: $Port" -ForegroundColor $statusColor
            Write-Host "Admin: $AdminUrl" -ForegroundColor Gray

            $conns = netstat -ano 2>$null | findstr ":$Port.*LISTENING"
            if ($conns) {
                $pidStr = ((($conns -split "`n")[0].Trim() -split '\s+')[-1])
                Write-Host "PID: $pidStr" -ForegroundColor DarkGray
            }
        } else {
            # Check for standalone process
            $state = Get-ServiceState
            if ($state) {
                Write-Host "Process: RUNNING (PID: $($state.Pid), Port: $Port) — no service installed" -ForegroundColor Yellow
            } else {
                Write-Host "STOPPED — service not installed, no process running" -ForegroundColor Red
            }
            Write-Host "Run 'install' to set up as Windows Service." -ForegroundColor Gray
        }
    }

    'logs' {
        $logDir = Join-Path $KeyProxyDir "logs"
        $logFile = Join-Path $logDir "stdout.log"
        $errFile = Join-Path $logDir "stderr.log"

        # node-windows uses daemon output
        $daemonLog = Join-Path $KeyProxyDir "daemon\keyproxy.err.log"
        $daemonOut = Join-Path $KeyProxyDir "daemon\keyproxy.out.log"

        if (Test-Path $daemonOut) {
            Write-Host "=== Service log (last 40 lines) ===" -ForegroundColor Cyan
            Get-Content $daemonOut -Tail 40
        } elseif (Test-Path $logFile) {
            Write-Host "=== Process log (last 40 lines) ===" -ForegroundColor Cyan
            Get-Content $logFile -Tail 40
        } else {
            Write-Host "No logs found in $logDir or daemon/" -ForegroundColor Yellow
        }

        if (Test-Path $errFile) {
            $errSize = (Get-Item $errFile).Length
            if ($errSize -gt 0) {
                Write-Host "`n=== stderr (last 10 lines) ===" -ForegroundColor Red
                Get-Content $errFile -Tail 10
            }
        }
        if (Test-Path $daemonLog) {
            $errSize = (Get-Item $daemonLog).Length
            if ($errSize -gt 0) {
                Write-Host "`n=== Daemon errors (last 10 lines) ===" -ForegroundColor Red
                Get-Content $daemonLog -Tail 10
            }
        }
    }

    'watch' {
        Write-Host "Watching KeyProxy logs... (Ctrl+C to stop)" -ForegroundColor Cyan

        $daemonOut = Join-Path $KeyProxyDir "daemon\keyproxy.out.log"
        $logFile = Join-Path $KeyProxyDir "logs\stdout.log"

        if (Test-Path $daemonOut) {
            Get-Content $daemonOut -Tail 30 -Wait
        } elseif (Test-Path $logFile) {
            Get-Content $logFile -Tail 30 -Wait
        } else {
            Write-Host "No log file found. Start KeyProxy first." -ForegroundColor Red
        }
    }
}
