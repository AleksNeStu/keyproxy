# Fix Desktop Shortcuts - Keep PowerShell Window Open
# This script updates KeyProxy desktop shortcuts to keep the window open after execution

$ErrorActionPreference = 'Stop'

$shortcuts = @(
    'KeyProxy Status.lnk',
    'KeyProxy Stop.lnk', 
    'KeyProxy Logs.lnk'
)

$shell = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath('Desktop')

Write-Host "Fixing KeyProxy desktop shortcuts..." -ForegroundColor Cyan
Write-Host ""

foreach ($shortcutName in $shortcuts) {
    $shortcutPath = Join-Path $desktopPath $shortcutName
    
    if (Test-Path $shortcutPath) {
        try {
            $shortcut = $shell.CreateShortcut($shortcutPath)
            
            Write-Host "Processing: $shortcutName" -ForegroundColor Yellow
            Write-Host "  Old Arguments: $($shortcut.Arguments)" -ForegroundColor Gray
            
            # Replace -File with -NoExit -File to keep window open
            $newArguments = $shortcut.Arguments -replace '-File', '-NoExit -File'
            
            # Also add -NoExit if it's not already there
            if ($newArguments -notmatch '-NoExit') {
                $newArguments = "-NoExit $newArguments"
            }
            
            $shortcut.Arguments = $newArguments
            $shortcut.Save()
            
            Write-Host "  New Arguments: $newArguments" -ForegroundColor Green
            Write-Host "  ✓ Updated successfully" -ForegroundColor Green
            Write-Host ""
        }
        catch {
            Write-Host "  ✗ Error: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host ""
        }
    }
    else {
        Write-Host "Skipping: $shortcutName (not found)" -ForegroundColor DarkGray
        Write-Host ""
    }
}

Write-Host "Done! Desktop shortcuts updated." -ForegroundColor Green
Write-Host ""
Write-Host "Now when you click these shortcuts, the PowerShell window will stay open." -ForegroundColor Cyan
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
