<#
.SYNOPSIS
    Toggle KeyProxy autorun on Windows login.
.DESCRIPTION
    Adds or removes KeyProxy from HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
    When enabled, KeyProxy starts silently in background on login.
#>

param([int]$Port = 8990)

$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$name = 'KeyProxy'
$projectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$silentScript = Join-Path $PSScriptRoot 'start-silent.ps1'

# Check current state
$current = Get-ItemProperty -Path $regPath -Name $name -ErrorAction SilentlyContinue

if ($current.$name) {
    # Remove autorun
    Remove-ItemProperty -Path $regPath -Name $name -ErrorAction Stop
    Write-Host "KeyProxy autorun DISABLED" -ForegroundColor Yellow
} else {
    # Add autorun — runs silent start script via powershell hidden window
    $command = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$silentScript`" -Port $Port"
    Set-ItemProperty -Path $regPath -Name $name -Value $command
    Write-Host "KeyProxy autorun ENABLED (silent start on login)" -ForegroundColor Green
}
