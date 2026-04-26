# Update KeyProxy desktop shortcuts

$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ProjectRoot = $PSScriptRoot
$IconPath = "$envSystemRoot\System32\shell32.dll"

function Set-Shortcut {
    param($Name, $Target, $ShortcutArgs)
    
    $ShortcutPath = Join-Path $DesktopPath "$Name.lnk"
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = $Target
    $Shortcut.Arguments = $ShortcutArgs
    $Shortcut.WorkingDirectory = $ProjectRoot
    $Shortcut.IconLocation = $IconPath
    $Shortcut.Description = "KeyProxy - $Name"
    $Shortcut.Save()
    
    Write-Host "Updated: $Name.lnk" -ForegroundColor Green
}

Write-Host "Updating KeyProxy shortcuts..." -ForegroundColor Cyan

Set-Shortcut "KeyProxy Start" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" start"
Set-Shortcut "KeyProxy Stop" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" stop"
Set-Shortcut "KeyProxy Restart" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" restart"
Set-Shortcut "KeyProxy Status" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" status"
Set-Shortcut "KeyProxy Logs" "powershell.exe" "-NoProfile -ExecutionPolicy Bypass -File `"$ProjectRoot\scripts\KeyProxy Manager.ps1`" logs"

Write-Host "`nAll shortcuts updated!" -ForegroundColor Green
Write-Host "Now you can run them from desktop - they will request admin privileges." -ForegroundColor Yellow
