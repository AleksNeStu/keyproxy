<#
.SYNOPSIS
    Create KeyProxy desktop shortcuts.
.DESCRIPTION
    Creates desktop shortcuts for KeyProxy management.
    Uses admin-elevated manager.ps1 for service commands.
    Shortcuts keep the PowerShell window open after execution.
#>

param(
    [ValidateSet('admin', 'simple')]
    [string]$Mode = 'admin'
)

$ErrorActionPreference = "Stop"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ScriptsDir = Join-Path $ProjectRoot "scripts"
$IconPath = Join-Path $ProjectRoot "public\favicon.ico"

if (-not (Test-Path $IconPath)) {
    $IconPath = "$env:SystemRoot\System32\shell32.dll"
}

function New-KeyProxyShortcut {
    param([string]$Name, [string]$Target, [string]$Arguments)

    $ShortcutPath = Join-Path $DesktopPath "$Name.lnk"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $Target
    $Shortcut.Arguments = $Arguments
    $Shortcut.WorkingDirectory = $ProjectRoot
    $Shortcut.IconLocation = $IconPath
    $Shortcut.Description = "KeyProxy - $Name"
    $Shortcut.Save()
    Write-Host "  $Name" -ForegroundColor Green
}

Write-Host "`nCreating KeyProxy desktop shortcuts ($Mode mode)..." -ForegroundColor Cyan

if ($Mode -eq 'admin') {
    # Admin mode: UAC-elevated shortcuts via manager.ps1
    $managerScript = Join-Path $ScriptsDir "service\manager.ps1"
    foreach ($cmd in @('Start', 'Stop', 'Restart', 'Status', 'Logs')) {
        New-KeyProxyShortcut -Name "KeyProxy $cmd" -Target "powershell.exe" `
            -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$managerScript`" $($cmd.ToLower())"
    }
} else {
    # Simple mode: direct .bat wrappers
    foreach ($cmd in @('Start', 'Stop', 'Restart', 'Status')) {
        New-KeyProxyShortcut -Name "KeyProxy $cmd" -Target "powershell.exe" `
            -Arguments "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$($ScriptsDir)\local\$($cmd.ToLower()).ps1`""
    }
}

# Dev shortcut (always available)
$devBat = Join-Path $ScriptsDir "local\dev.bat"
New-KeyProxyShortcut -Name "KeyProxy Dev" -Target "cmd.exe" -Arguments "/c `"$devBat`""

Write-Host "`nDone! Shortcuts created on desktop." -ForegroundColor Green
