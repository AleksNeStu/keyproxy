/**
 * KeyProxy Manager - Run as Administrator
 *
 * This script serves as a launcher for KeyProxy management commands.
 * It will automatically request Administrator privileges via UAC prompt.
 */

param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'install', 'uninstall')]
    [string]$Command = 'status'
)

$ErrorActionPreference = "Stop"

# Check if running as Administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# If not admin, relaunch with elevated privileges
if (-not (Test-Administrator)) {
    Write-Host "Requesting Administrator privileges..." -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"" + $PSCommandPath + """ " + $MyInvocation.BoundParameters.Keys + " " + $MyInvocation.BoundParameters.Values
    Start-Process powershell -Verb RunAs -ArgumentList $arguments
    exit
}

# Running as admin - execute command
Write-Host "KeyProxy Manager (Administrator)`n" -ForegroundColor Cyan
Write-Host "Command: $Command`n" -ForegroundColor Gray

$ManageScript = Join-Path $PSScriptRoot "manage.ps1"
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
