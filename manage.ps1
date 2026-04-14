param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'watch')]
    [string]$Command
)

# When called from anywhere, $PSScriptRoot resolves to infra/nest-KeyProxy/
$KeyProxyDir = $PSScriptRoot
$Port = 8990

function Get-KeyProxyPid {
    $conns = netstat -ano 2>$null | findstr ":$Port"
    if ($conns) {
        foreach ($line in ($conns -split "`n")) {
            if ($line -match "LISTENING") {
                $parts = ($line.Trim() -split '\s+')
                $pidStr = $parts[-1]
                if ($pidStr -match '^\d+$' -and [int]$pidStr -ne 0) {
                    return [int]$pidStr
                }
            }
        }
    }
    return $null
}

switch ($Command) {
    'start' {
        $KeyProxyPid = Get-KeyProxyPid
        if ($KeyProxyPid) {
            Write-Host "âś… KeyProxy already running on port $Port (PID: $KeyProxyPid)" -ForegroundColor Yellow
        } else {
            Write-Host "đźš€ Starting KeyProxy in background..." -ForegroundColor Cyan
            $logDir = Join-Path $KeyProxyDir "logs"
            if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

            $ProcParams = @{
                FilePath = "node"
                ArgumentList = "index.js"
                WorkingDirectory = $KeyProxyDir
                WindowStyle = "Hidden"
                RedirectStandardOutput = "$logDir\stdout.log"
                RedirectStandardError = "$logDir\stderr.log"
            }
            Start-Process @ProcParams
            Start-Sleep -Seconds 2
            $newPid = Get-KeyProxyPid
            if ($newPid) {
                Write-Host "âś… KeyProxy started (PID: $newPid)" -ForegroundColor Green
                Write-Host "   Admin: http://localhost:$Port/admin" -ForegroundColor Gray
            } else {
                Write-Host "âťŚ Failed to start KeyProxy. Check: $logDir\stderr.log" -ForegroundColor Red
            }
        }
    }
    'stop' {
        $KeyProxyPid = Get-KeyProxyPid
        if ($KeyProxyPid) {
            Write-Host "đź›‘ Stopping KeyProxy (PID: $KeyProxyPid)..." -ForegroundColor Cyan
            Stop-Process -Id $KeyProxyPid -Force -ErrorAction SilentlyContinue
            Write-Host "âś… KeyProxy stopped." -ForegroundColor Green
        } else {
            Write-Host "KeyProxy is not running on port $Port." -ForegroundColor Yellow
        }
    }
    'restart' {
        & $PSCommandPath stop
        Start-Sleep -Seconds 1
        & $PSCommandPath start
    }
    'status' {
        $KeyProxyPid = Get-KeyProxyPid
        if ($KeyProxyPid) {
            Write-Host "âś… KeyProxy is RUNNING (PID: $KeyProxyPid, Port: $Port)" -ForegroundColor Green
            Write-Host "   Admin: http://localhost:$Port/admin" -ForegroundColor Gray
        } else {
            Write-Host "đź”´ KeyProxy is STOPPED" -ForegroundColor Red
        }
    }
    'logs' {
        $logFile = Join-Path $KeyProxyDir "logs\stdout.log"
        if (-not (Test-Path $logFile)) {
            Write-Host "Log file not found: $logFile" -ForegroundColor Yellow
            return
        }
        Write-Host "Tailing log file... (Ctrl+C to stop)" -ForegroundColor Gray
        Get-Content $logFile -Tail 30 -Wait
    }
    'watch' {
        Write-Host "👀 Watching for .env changes... (Ctrl+C to stop)" -ForegroundColor Cyan
        $rootEnv = Resolve-Path (Join-Path $KeyProxyDir "../../.env") -ErrorAction SilentlyContinue
        $localEnv = Resolve-Path (Join-Path $KeyProxyDir ".env") -ErrorAction SilentlyContinue
        
        $filesToWatch = @()
        if ($rootEnv) { $filesToWatch += $rootEnv.Path }
        if ($localEnv) { $filesToWatch += $localEnv.Path }

        if ($filesToWatch.Count -eq 0) {
            Write-Host "❌ No .env files found to watch!" -ForegroundColor Red
            return
        }

        # Get initial timestamps
        $lastWriteTimes = @{}
        foreach ($f in $filesToWatch) { $lastWriteTimes[$f] = (Get-Item $f).LastWriteTime }

        # Start KeyProxy if not running
        if (-not (Get-KeyProxyPid)) { & $PSCommandPath start }

        while($true) {
            Start-Sleep -Seconds 2
            foreach ($f in $filesToWatch) {
                $currentWriteTime = (Get-Item $f).LastWriteTime
                if ($currentWriteTime -gt $lastWriteTimes[$f]) {
                    Write-Host "✅ Change detected in $(Split-Path $f -Leaf). Restarting..." -ForegroundColor Yellow
                    $lastWriteTimes[$f] = $currentWriteTime
                    & $PSCommandPath restart
                }
            }
        }
    }
}
