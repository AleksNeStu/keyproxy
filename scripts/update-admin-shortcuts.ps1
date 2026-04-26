<#
.SYNOPSIS
    Update KeyProxy desktop shortcuts to run as Administrator

.DESCRIPTION
    Creates/modifies desktop shortcuts for KeyProxy management
    with "Run as Administrator" flag enabled via UAC manifests.
#>

$ErrorActionPreference = "Stop"

$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectRoot = $PSScriptRoot
$IconPath = Join-Path $ProjectRoot "public\favicon.ico"

if (-not (Test-Path $IconPath)) {
    $IconPath = "$env:SystemRoot\System32\shell32.dll"
}

function Set-AdminShortcut {
    param(
        [string]$Name,
        [string]$TargetPath,
        [string]$Arguments,
        [string]$IconPath = $null
    )

    $ShortcutPath = Join-Path $DesktopPath "$Name.lnk"
    $WshShell = New-Object -ComObject WScript.Shell

    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $TargetPath
    $Shortcut.Arguments = $Arguments
    $Shortcut.WorkingDirectory = $ProjectRoot

    if ($IconPath) {
        $Shortcut.IconLocation = $IconPath
    }

    $Shortcut.Description = "KeyProxy Management - $Name"
    $Shortcut.Save()

    Write-Host "✓ Created/updated shortcut: $Name.lnk" -ForegroundColor Green
    Write-Host "  Target: $TargetPath" -ForegroundColor Gray
    Write-Host "  Args: $Arguments" -ForegroundColor Gray
}

Write-Host "`nUpdating KeyProxy desktop shortcuts..." -ForegroundColor Cyan

Set-AdminShortcut -Name "KeyProxy Start" `
    -TargetPath "powershell.exe" `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" start" `
    -IconPath $IconPath

Set-AdminShortcut -Name "KeyProxy Stop" `
    -TargetPath "powershell.exe" `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" stop" `
    -IconPath $IconPath

Set-AdminShortcut -Name "KeyProxy Restart" `
    -TargetPath "powershell.exe" `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" restart" `
    -IconPath $IconPath

Set-AdminShortcut -Name "KeyProxy Status" `
    -TargetPath "powershell.exe" `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" status" `
    -IconPath $IconPath

Set-AdminShortcut -Name "KeyProxy Logs" `
    -TargetPath "powershell.exe" `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" logs" `
    -IconPath $IconPath

Write-Host "`n✓ All shortcuts updated!" -ForegroundColor Green
Write-Host "`nNote: When you run these shortcuts, Windows UAC will prompt for Administrator privileges." -ForegroundColor Yellow
Write-Host "This is required for force-stopping processes on port 8990." -ForegroundColor Gray

Write-Host "`n=== Current KeyProxy Status ===" -ForegroundColor Cyan
& "$ProjectRoot\manage.ps1" status
