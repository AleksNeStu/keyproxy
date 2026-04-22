# Desktop Shortcuts Configuration

## Problem
Desktop shortcuts (KeyProxy Status, Stop, Logs) were closing immediately after execution, making it impossible to see the output.

## Solution
Added `-NoExit` parameter to PowerShell arguments to keep the window open after command execution.

## Updated Shortcuts

### KeyProxy Status.lnk
- **Location**: `%USERPROFILE%\Desktop\KeyProxy Status.lnk`
- **Target**: `powershell.exe`
- **Arguments**: `-NoProfile -ExecutionPolicy Bypass -NoExit -File "e:\nestlab-repo\nest-solo\infra\keyproxy\manage.ps1" status`
- **Working Directory**: `e:\nestlab-repo\nest-solo\infra\keyproxy`

### KeyProxy Stop.lnk
- **Location**: `%USERPROFILE%\Desktop\KeyProxy Stop.lnk`
- **Target**: `powershell.exe`
- **Arguments**: `-NoProfile -ExecutionPolicy Bypass -NoExit -File "e:\nestlab-repo\nest-solo\infra\keyproxy\manage.ps1" stop`
- **Working Directory**: `e:\nestlab-repo\nest-solo\infra\keyproxy`

### KeyProxy Logs.lnk
- **Location**: `%USERPROFILE%\Desktop\KeyProxy Logs.lnk`
- **Target**: `powershell.exe`
- **Arguments**: `-NoProfile -ExecutionPolicy Bypass -NoExit -File "e:\nestlab-repo\nest-solo\infra\keyproxy\manage.ps1" logs`
- **Working Directory**: `e:\nestlab-repo\nest-solo\infra\keyproxy`

## How It Works

### Before (Window Closes Immediately)
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "script.ps1"
```

### After (Window Stays Open)
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "script.ps1"
```

The `-NoExit` parameter tells PowerShell to keep the window open after the script finishes executing.

## Manual Update

If you need to update shortcuts manually:

```powershell
$shell = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopPath 'KeyProxy Status.lnk'
$shortcut = $shell.CreateShortcut($shortcutPath)

# Add -NoExit before -File
$shortcut.Arguments = $shortcut.Arguments -replace '-File', '-NoExit -File'
$shortcut.Save()
```

## Automated Update Script

Use the provided script to update all shortcuts at once:

```powershell
cd E:\nestlab-repo\nest-solo\infra\keyproxy
.\scripts\fix-desktop-shortcuts.ps1
```

## Creating New Shortcuts

When creating new desktop shortcuts for KeyProxy commands, use this template:

1. **Target**: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
2. **Arguments**: `-NoProfile -ExecutionPolicy Bypass -NoExit -File "E:\nestlab-repo\nest-solo\infra\keyproxy\manage.ps1" <command>`
3. **Working Directory**: `E:\nestlab-repo\nest-solo\infra\keyproxy`
4. **Icon**: (Optional) Use PowerShell icon or custom icon

Replace `<command>` with: `status`, `stop`, `start`, `restart`, or `logs`

## Troubleshooting

### Window Still Closes Immediately
1. Check if `-NoExit` is present in shortcut arguments
2. Right-click shortcut → Properties → Shortcut tab → Target field
3. Verify arguments contain `-NoExit -File`

### Shortcut Not Working
1. Verify file path is correct
2. Check working directory is set to keyproxy folder
3. Ensure `manage.ps1` exists at specified path

### Want Window to Close Automatically
Remove `-NoExit` from arguments:
```powershell
$shortcut.Arguments = $shortcut.Arguments -replace '-NoExit ', ''
$shortcut.Save()
```

## Related Files
- `manage.ps1` - Main management script
- `scripts/fix-desktop-shortcuts.ps1` - Automated shortcut updater
