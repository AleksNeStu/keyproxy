# KeyProxy Scripts

## Structure

```
scripts/
├── local/          Direct process control (no admin, no service)
├── service/        Windows Service management (requires admin)
└── utils/          Shortcuts, password change, etc.
```

## Local — Direct Process Control

No Administrator privileges needed. Manages KeyProxy as a regular process.

| Script | Usage | Description |
|--------|-------|-------------|
| `start.ps1` | `.\local\start.ps1` | Start KeyProxy in background |
| `stop.ps1` | `.\local\stop.ps1` | Kill process on port 8990 |
| `restart.ps1` | `.\local\restart.ps1` | Stop + start |
| `status.ps1` | `.\local\status.ps1` | Show process/port status |
| `dev.ps1` | `.\local\dev.ps1` | Start with `node --watch` (auto-reload on .js changes) |
| `dev.bat` | Double-click | Windows wrapper for dev.ps1 |

## Service — Windows Service Management

Requires Administrator (UAC prompt). Wraps `manage.ps1` in project root.

| Script | Usage | Description |
|--------|-------|-------------|
| `install.ps1` | `.\service\install.ps1` | Install as Windows Service |
| `uninstall.ps1` | `.\service\uninstall.ps1` | Remove Windows Service |
| `start.ps1` | `.\service\start.ps1` | Start service |
| `stop.ps1` | `.\service\stop.ps1` | Stop service + kill port |
| `restart.ps1` | `.\service\restart.ps1` | Restart service |
| `status.ps1` | `.\service\status.ps1` | Service + port status |
| `logs.ps1` | `.\service\logs.ps1` | View last 40 log lines |
| `watch.ps1` | `.\service\watch.ps1` | Tail logs in real-time |
| `manager.ps1` | `.\service\manager.ps1 start` | UAC-elevated launcher (auto-prompts for admin) |

## Utils

| Script | Usage | Description |
|--------|-------|-------------|
| `create-shortcuts.ps1` | `.\utils\create-shortcuts.ps1` | Create desktop shortcuts (admin mode) |
| `create-shortcuts.ps1 -Mode simple` | | Simple mode (no UAC, uses local scripts) |
| `change-password.js` | `node utils\change-password.js <old> <new>` | Change admin password via API |

## Quick Start

```powershell
# Development (auto-reload)
.\scripts\local\dev.ps1

# Or start in background
.\scripts\local\start.ps1

# Check status
.\scripts\local\status.ps1

# Stop
.\scripts\local\stop.ps1
```

## Linux / WSL

Use `manage.sh` in the project root directly:

```bash
bash manage.sh start
bash manage.sh stop
bash manage.sh restart
bash manage.sh status
```
