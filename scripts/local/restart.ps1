<#
.SYNOPSIS
    Restart local KeyProxy process.
#>
param([int]$Port = 8990)

$scriptDir = $PSScriptRoot
& (Join-Path $scriptDir "stop.ps1") -Port $Port
Start-Sleep -Milliseconds 500
& (Join-Path $scriptDir "start.ps1") -Port $Port
