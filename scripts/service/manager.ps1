<#
.SYNOPSIS
    KeyProxy Manager — run management commands with Administrator privileges.
.DESCRIPTION
    Launches with UAC prompt if not already elevated.
    Usage: .\manager.ps1 [start|stop|restart|status|logs|install|uninstall]
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'install', 'uninstall')]
    [string]$Command = 'status'
)

$ErrorActionPreference = "Stop"

function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" $Command"
    Start-Process powershell -Verb RunAs -ArgumentList $arguments
    exit
}

Write-Host "KeyProxy Manager (Administrator)`n" -ForegroundColor Cyan
Write-Host "Command: $Command`n" -ForegroundColor Gray

$ManageScript = Join-Path (Split-Path $PSScriptRoot -Parent) "..\manage.ps1"
if (Test-Path $ManageScript) {
    try {
        & $ManageScript $Command
    } catch {
        Write-Host "`nError: $_" -ForegroundColor Red
        Write-Host "`nPress any key to exit..." -ForegroundColor Gray
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
} else {
    Write-Host "Error: manage.ps1 not found at: $ManageScript" -ForegroundColor Red
    Write-Host "`nPress any key to exit..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}
