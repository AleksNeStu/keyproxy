# 🛰️ KeyProxy

**KeyProxy** (formerly Nest-Rotato) is a professional, cross-platform API key orchestrator and proxy. It manages rotation, health-checking, and real-time synchronization of API keys across multiple destinations (System Env, Local Files, etc.), ensuring your AI tools always have access to a healthy, high-quota key.

## 🚀 Professional Workflow

KeyProxy sits between your development tools (Antigravity, Cursor, CLI) and multiple API providers. It automatically:
1. **Detects** rate limits and failures.
2. **Rotates** to the next healthy key in the pool.
3. **Synchronizes** the active key to your OS environment and local files instantly.

---

## 🛠️ Installation & Autorun

KeyProxy is designed to run silently in the background.

### 🪟 Windows (Powershell)
Install as a hidden background task that starts on logon:
```powershell
./manage.ps1 install
```
*   **Status**: `./manage.ps1 status`
*   **Logs**: `./manage.ps1 logs`
*   **Uninstall**: `./manage.ps1 uninstall`

### 🐧 Linux (Bash/Systemd)
Install as a robust systemd service:
```bash
sudo ./manage.sh install
```
*   **Status**: `./manage.sh status`
*   **Logs**: `./manage.sh logs`
*   **Uninstall**: sudo `./manage.sh uninstall`

---

## 🔄 Modular Sync Destinations

KeyProxy implements a **Destination Manager** that broadcasts the currently active "healthy" key to multiple targets simultaneously:

| Destination | Purpose | Advantage |
|---|---|---|
| **System Env** | Global availability via OS variables | Standard integration for scripts and IDEs |
| **File Sync** | Writes to `.active_keys.env` | **Instant updates** for tools like Cursor that watch files |
| **Web Proxy** | `http://localhost:8990` | Zero-configuration rotation for any HTTP client |

---

## 🧩 Supported Providers

Configure your keys in the root `.env` file using the `_1`, `_2` indexing pattern. KeyProxy handles the rest:

*   **Search**: Tavily, Exa, Brave Search.
*   **LLM**: OpenAI, Gemini (Google AI), Anthropic.
*   **Tooling**: Firecrawl, Jina, etc.

For a full list of environment variable mappings, see [Environment Mapping Guide](./docs/guides/ENVIRONMENT_MAPPING.md).

---

## 🏛️ Admin Panel
Access the professional dashboard for real-time monitoring:
**`http://localhost:8990/admin`**

### 🔐 Authentication
- **Default Password**: `admin123`
- **Password Storage**: Encrypted in `data/admin.hash` (scrypt)
- **Reset Password**: See [Password Reset Guide](./docs/troubleshooting/PASSWORD_RESET.md)

**Important:** 
- Admin panel requires password for security
- API endpoints (`/provider/*`) do NOT require password by default
- Use `ACCESS_KEY` per provider for API authentication (optional)

---

## 📚 Documentation

- **[Quick Start Guide](./docs/guides/QUICK_START.md)** - Get started in 5 minutes
- **[Environment Mapping](./docs/guides/ENVIRONMENT_MAPPING.md)** - Configure API keys
- **[Desktop Shortcuts](./docs/guides/DESKTOP_SHORTCUTS.md)** - Windows shortcuts setup
- **[Password Reset](./docs/troubleshooting/PASSWORD_RESET.md)** - Reset admin password
- **[Login Issues](./docs/troubleshooting/LOGIN_ISSUES.md)** - Troubleshoot login problems

---

## ⚖️ License
MIT License. (C) 2026 NestLab. Based on the original high-availability rotation logic from the Rotato project.
