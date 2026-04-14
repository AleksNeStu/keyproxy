param(
    [Parameter(Position = 0, Mandatory = $true)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'watch')]
    [string]$Command
)

# When called from anywhere, $PSScriptRoot resolves to infra/nest-rotato/
$RotatoDir = $PSScriptRoot
$Port = 8990

function Get-RotatoPid {
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
        $rotatoPid = Get-RotatoPid
        if ($rotatoPid) {
            Write-Host "âś… Rotato already running on port $Port (PID: $rotatoPid)" -ForegroundColor Yellow
        } else {
            Write-Host "đźš€ Starting Rotato in background..." -ForegroundColor Cyan
            $logDir = Join-Path $RotatoDir "logs"
            if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

            $ProcParams = @{
                FilePath = "node"
                ArgumentList = "index.js"
                WorkingDirectory = $RotatoDir
                WindowStyle = "Hidden"
                RedirectStandardOutput = "$logDir\stdout.log"
                RedirectStandardError = "$logDir\stderr.log"
            }
            Start-Process @ProcParams
            Start-Sleep -Seconds 2
            $newPid = Get-RotatoPid
            if ($newPid) {
                Write-Host "âś… Rotato started (PID: $newPid)" -ForegroundColor Green
                Write-Host "   Admin: http://localhost:$Port/admin" -ForegroundColor Gray
            } else {
                Write-Host "âťŚ Failed to start Rotato. Check: $logDir\stderr.log" -ForegroundColor Red
            }
        }
    }
    'stop' {
        $rotatoPid = Get-RotatoPid
        if ($rotatoPid) {
            Write-Host "đź›‘ Stopping Rotato (PID: $rotatoPid)..." -ForegroundColor Cyan
            Stop-Process -Id $rotatoPid -Force -ErrorAction SilentlyContinue
            Write-Host "âś… Rotato stopped." -ForegroundColor Green
        } else {
            Write-Host "Rotato is not running on port $Port." -ForegroundColor Yellow
        }
    }
    'restart' {
        & $PSCommandPath stop
        Start-Sleep -Seconds 1
        & $PSCommandPath start
    }
    'status' {
        $rotatoPid = Get-RotatoPid
        if ($rotatoPid) {
            Write-Host "âś… Rotato is RUNNING (PID: $rotatoPid, Port: $Port)" -ForegroundColor Green
            Write-Host "   Admin: http://localhost:$Port/admin" -ForegroundColor Gray
        } else {
            Write-Host "đź”´ Rotato is STOPPED" -ForegroundColor Red
        }
    }
    'logs' {
        $logFile = Join-Path $RotatoDir "logs\stdout.log"
        if (-not (Test-Path $logFile)) {
            Write-Host "Log file not found: $logFile" -ForegroundColor Yellow
            return
        }
        Write-Host "Tailing log file... (Ctrl+C to stop)" -ForegroundColor Gray
        Get-Content $logFile -Tail 30 -Wait
    }
    'watch' {
        Write-Host "👀 Watching for .env changes... (Ctrl+C to stop)" -ForegroundColor Cyan
        $rootEnv = Resolve-Path (Join-Path $RotatoDir "../../.env") -ErrorAction SilentlyContinue
        $localEnv = Resolve-Path (Join-Path $RotatoDir ".env") -ErrorAction SilentlyContinue
        
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

        # Start Rotato if not running
        if (-not (Get-RotatoPid)) { & $PSCommandPath start }

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
