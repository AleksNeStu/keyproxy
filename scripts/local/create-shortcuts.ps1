<#
.SYNOPSIS
    Create desktop shortcuts for KeyProxy Start, Stop, Restart.
#>

$desktop = [Environment]::GetFolderPath('Desktop')
$projectRoot = 'E:\nestlab-repo\nest-solo\infra\keyproxy'

$ws = New-Object -ComObject WScript.Shell

# Start shortcut
$sc = $ws.CreateShortcut("$desktop\KeyProxy - Start.lnk")
$sc.TargetPath = 'powershell.exe'
$sc.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\start.ps1`""
$sc.WorkingDirectory = $projectRoot
$sc.IconLocation = 'C:\Windows\System32\shell32.dll,21'
$sc.Description = 'Start KeyProxy (auto-reload)'
$sc.Save()
Write-Host "Created: KeyProxy - Start.lnk" -ForegroundColor Green

# Stop shortcut
$sc2 = $ws.CreateShortcut("$desktop\KeyProxy - Stop.lnk")
$sc2.TargetPath = 'powershell.exe'
$sc2.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\stop.ps1`""
$sc2.WorkingDirectory = $projectRoot
$sc2.IconLocation = 'C:\Windows\System32\shell32.dll,28'
$sc2.Description = 'Stop KeyProxy'
$sc2.Save()
Write-Host "Created: KeyProxy - Stop.lnk" -ForegroundColor Green

# Restart shortcut
$sc3 = $ws.CreateShortcut("$desktop\KeyProxy - Restart.lnk")
$sc3.TargetPath = 'powershell.exe'
$sc3.Arguments = "-ExecutionPolicy Bypass -NoExit -File `"$projectRoot\scripts\local\restart.ps1`""
$sc3.WorkingDirectory = $projectRoot
$sc3.IconLocation = 'C:\Windows\System32\shell32.dll,27'
$sc3.Description = 'Restart KeyProxy'
$sc3.Save()
Write-Host "Created: KeyProxy - Restart.lnk" -ForegroundColor Green

Write-Host "`nDone. 3 shortcuts placed on Desktop." -ForegroundColor Cyan
