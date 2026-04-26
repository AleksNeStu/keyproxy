# Update KeyProxy desktop shortcuts to use .bat files

$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectRoot = $PSScriptRoot
$IconPath = "$envSystemRoot\System32\shell32.dll"

function Set-Shortcut {
    param($Name, $Target, $BatArguments)
    
    $ShortcutPath = Join-Path $DesktopPath "$Name.lnk"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $Target
    $Shortcut.Arguments = $BatArguments
    $Shortcut.WorkingDirectory = $ProjectRoot
    $Shortcut.IconLocation = $IconPath
    $Shortcut.Description = "KeyProxy - $Name"
    $Shortcut.Save()
    
    Write-Host "Updated: $Name.lnk" -ForegroundColor Green
}

Write-Host "Updating KeyProxy shortcuts..." -ForegroundColor Cyan

Set-Shortcut "KeyProxy Start" "scripts\start-keyproxy.bat" ""
Set-Shortcut "KeyProxy Stop" "scripts\stop-keyproxy.bat" ""
Set-Shortcut "KeyProxy Restart" "scripts\restart-keyproxy.bat" ""
Set-Shortcut "KeyProxy Status" "scripts\status-keyproxy.bat" ""
Set-Shortcut "KeyProxy Dev" "scripts\dev.bat" ""

Write-Host "`nAll shortcuts updated!" -ForegroundColor Green
Write-Host "Just double-click the shortcuts - they work!" -ForegroundColor Yellow
