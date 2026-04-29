<#
.SYNOPSIS
    Create desktop shortcuts for KeyProxy management.
.DESCRIPTION
    Generates shortcuts for Start, Stop, Restart, Silent Start,
    Toggle AutoRun, and View Logs on the user desktop.
#>

$desktop = [Environment]::GetFolderPath('Desktop')
$projectRoot = 'E:\nestlab-repo\nest-solo\infra\keyproxy'
$ws = New-Object -ComObject WScript.Shell

function New-Shortcut {
    param($Name, $Target, $ShortcutArgs, $Icon, $Desc)
    $sc = $ws.CreateShortcut("$desktop\$Name.lnk")
    $sc.TargetPath = $Target
    $sc.Arguments = $ShortcutArgs
    $sc.WorkingDirectory = $projectRoot
    $sc.IconLocation = $Icon
    $sc.Description = $Desc
    $sc.Save()
    Write-Host "  + $Name" -ForegroundColor Green
}

Write-Host "`nKeyProxy shortcuts:" -ForegroundColor Cyan

# Start (with console, auto-reload)
New-Shortcut "KeyProxy - Start" 'powershell.exe' `
    "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\start.ps1`"" `
    'C:\Windows\System32\shell32.dll,21' `
    'Start KeyProxy (auto-reload, with console)'

# Stop
New-Shortcut "KeyProxy - Stop" 'powershell.exe' `
    "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\stop.ps1`"" `
    'C:\Windows\System32\shell32.dll,28' `
    'Stop KeyProxy'

# Restart
New-Shortcut "KeyProxy - Restart" 'powershell.exe' `
    "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\restart.ps1`"" `
    'C:\Windows\System32\shell32.dll,27' `
    'Restart KeyProxy'

# Silent Start (no console window)
New-Shortcut "KeyProxy - Silent Start" 'powershell.exe' `
    "-ExecutionPolicy Bypass -File `"$projectRoot\scripts\local\start-silent.ps1`"" `
    'C:\Windows\System32\shell32.dll,15' `
    'Start KeyProxy silently (no console)'

# Toggle AutoRun
New-Shortcut "KeyProxy - Toggle AutoRun" 'powershell.exe' `
    "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\toggle-autorun.ps1`"" `
    'C:\Windows\System32\shell32.dll,13' `
    'Toggle KeyProxy autorun on Windows login'

# View Logs
New-Shortcut "KeyProxy - Logs" 'powershell.exe' `
    "-ExecutionPolicy Bypass -NoExit -Command `"Get-Content `"$projectRoot\logs\stdout.log`" -Wait -Tail 50; Get-Content `"$projectRoot\logs\stderr.log`" -Wait -Tail 50`"" `
    'C:\Windows\System32\shell32.dll,70' `
    'View KeyProxy logs (live tail)'

Write-Host "`nDone. 6 shortcuts on Desktop." -ForegroundColor Cyan
