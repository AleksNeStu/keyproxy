# KeyProxy Scripts

## Structure

```
scripts/
├── manage.ps1      Windows service orchestrator (main script)
├── manage.sh       Linux/VPS orchestrator (systemd + process)
├── service.js      node-windows service installer
├── local/          Direct process control (no admin, no service)
├── service/        Windows Service wrappers (call manage.ps1)
└── utils/          Shortcuts, password change, etc.
```

## Quick Start

```powershell
# Development (auto-reload on .js changes)
.\scripts\local\dev.ps1

# Start in background
.\scripts\local\start.ps1

# Check status
.\scripts\local\status.ps1

# Stop
.\scripts\local\stop.ps1
```

## Core Scripts

| Script | Platform | Description |
|--------|----------|-------------|
| `manage.ps1` | Windows | Main orchestrator: install/uninstall/start/stop/restart/status/logs/watch |
| `manage.sh` | Linux/VPS | systemd service + process management |
| `service.js` | Windows | node-windows service wrapper (called by manage.ps1) |

## Local — Direct Process Control

No Administrator privileges needed. Manages KeyProxy as a regular process.

| Script | Description |
|--------|-------------|
| `local/start.ps1` | Start KeyProxy in background |
| `local/stop.ps1` | Kill process on port 8990 |
| `local/restart.ps1` | Stop + start |
| `local/status.ps1` | Show process/port status |
| `local/dev.ps1` | Start with `node --watch` (auto-reload) |
| `local/dev.bat` | Double-click wrapper for dev.ps1 |

## Service — Windows Service Management

Requires Administrator (UAC prompt). Thin wrappers around `manage.ps1`.

| Script | Description |
|--------|-------------|
| `service/install.ps1` | Install as Windows Service |
| `service/uninstall.ps1` | Remove Windows Service |
| `service/start.ps1` | Start service |
| `service/stop.ps1` | Stop service + kill port |
| `service/restart.ps1` | Restart service |
| `service/status.ps1` | Service + port status |
| `service/logs.ps1` | View last 40 log lines |
| `service/watch.ps1` | Tail logs in real-time |
| `service/manager.ps1` | UAC-elevated launcher (auto-prompts for admin) |

## Utils

| Script | Description |
|--------|-------------|
| `utils/create-shortcuts.ps1` | Create desktop shortcuts (admin mode) |
| `utils/create-shortcuts.ps1 -Mode simple` | Simple mode (no UAC, uses local scripts) |
| `utils/change-password.js` | Change admin password via API |

## Linux / WSL

```bash
bash scripts/manage.sh start
bash scripts/manage.sh stop
bash scripts/manage.sh restart
bash scripts/manage.sh status
sudo bash scripts/manage.sh install
sudo bash scripts/manage.sh uninstall
```
