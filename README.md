# 🔄 Rotato — API Key Rotation Proxy

Rotato is a local HTTP proxy that automatically rotates API keys to prevent `429 Too Many Requests` errors. It intercepts all AI/scraping traffic and cycles through your key pool transparently.

## What It Proxies

Rotato acts as a transparent bridge to various AI and data services.

| Service | Local Rotato Endpoint | Key Discovery Pattern |
|---------|-----------------------|----------------------|
| **Gemini** | `http://localhost:8990/gemini/*` | `GEMINI_API_KEY_*` |
| **OpenAI** | `http://localhost:8990/openai/*` | `OPENAI_API_KEY_*` |
| **Firecrawl** | `http://localhost:8990/firecrawl/*` | `OPENAI_FIRECRAWL_API_KEY_*` |
| **Context7** | `http://localhost:8990/context7/*` | `OPENAI_CONTEXT7_API_KEY_*` |
| **Ref** | `http://localhost:8990/onref/*` | `OPENAI_REF_API_KEY_*` |
| **Custom** | `http://localhost:8990/{name}/*` | `OPENAI_{NAME}_API_KEY_*` |

> [!TIP]
> **Blog Documentation**: For detailed service mapping, custom provider configuration (like **7jm** or **Comantek**), and implementation examples, see the [Mapping Documentation](docs/MAPPING.md).

## Quick Start

```powershell
# From infra/nest-rotato/
.\manage.ps1 start     # Start in background
.\manage.ps1 status    # Check if running
.\manage.ps1 stop      # Stop
.\manage.ps1 restart   # Restart (after .env changes)
.\manage.ps1 logs      # Tail stdout.log
```

## Admin Dashboard

- **URL**: http://localhost:8990/admin  
- **Password**: see `ADMIN_PASSWORD` in `.env`

## Configuration

This service uses **Zero-Maintenance Global Discovery**.  
API keys are read **automatically** from the root `nest-solo/.env`.  
The local `.env` in this folder contains **only** service settings (port, password):

```env
PORT=8990
ADMIN_PASSWORD=your-password-here
```

### Adding a new key

Just add it to `nest-solo/.env`:
```env
GEMINI_API_KEY_26=AIza...
FIRECRAWL_API_KEY_03=fc-...
```
Then restart: `.\manage.ps1 restart`

## Autostart (Windows)

To enable automatic startup at login:
```powershell
# From nest-solo root (requires Admin / UAC prompt):
.\scripts\setup\install-rotato-autostart.ps1
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Admin shows no keys | Restart the server: `.\manage.ps1 restart` |
| Test button shows "404 Not Found" | Normal for Firecrawl/Ref/Context7 — they have no `/models` endpoint. Proxy still works. |
| Port 8990 in use | `.\manage.ps1 stop` then `start` |
| Server won't start | Check `logs\stderr.log` |
