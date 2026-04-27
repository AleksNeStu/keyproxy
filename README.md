# KeyProxy

> **Stop putting real API keys in MCP config files.** KeyProxy is a local API key vault + proxy that intercepts MCP server traffic and injects rotated keys — your config files never see a real key again.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

---

## The Problem

MCP servers (Claude Desktop, Cursor, Windsurf, Kiro, etc.) require API keys in plaintext config files:

```json
// ~/.claude.json — your real API key, exposed on disk
{
  "search-brave": {
    "env": { "BRAVE_API_KEY": "BSAD-real-key-here-a1b2c3" }
  }
}
```

That means:

- Keys sitting in plaintext in `~/.claude.json`, `settings.json`, `mcp.json`
- Same key copied across 5+ config files
- No rotation, no health checks, no rate-limit handling
- One leaked config = one leaked key

## The Solution

KeyProxy runs locally as a transparent proxy. MCP servers talk to `localhost:8990` instead of the real API. KeyProxy injects a rotated key, forwards the request, and handles rate limits automatically.

```
Your MCP Config (placeholder key)          KeyProxy (real keys in .env)
─────────────────────────────            ──────────────────────────────
BRAVE_API_KEY = "placeholder"   ────►   Rotates 4 Brave keys
EXA_API_KEY    = "placeholder"   ────►   Auto-recovers from 429/402
JINA_API_KEY   = "placeholder"   ────►   Health checks every 5 min
```

Your config files only contain `"placeholder"`. Real keys live in KeyProxy's encrypted `.env`.

---

## Quick Start — MCP Injection

### 1. Start KeyProxy

```bash
npm start
# Running at http://localhost:8990
```

Add your real API keys to `.env`:
```env
OPENAI_BRAVE_API_KEYS=BSAD-key1,BSAD-key2,BSAD-key3
OPENAI_EXA_API_KEYS=exa-key1,exa-key2
OPENAI_JINA_API_KEYS=jina-key1
```

### 2. Inject into MCP servers

Add the intercept module to your MCP server config:

```json
{
  "search-brave": {
    "command": "npx",
    "args": ["-y", "@brave/brave-search-mcp-server"],
    "env": {
      "BRAVE_API_KEY": "placeholder",
      "NODE_OPTIONS": "--require ./mcp-intercept.cjs"
    }
  }
}
```

That's it. The intercept module rewrites all API calls through KeyProxy. Download it:

```bash
curl http://localhost:8990/inject/mcp-intercept.cjs -o mcp-intercept.cjs
```

### 3. Monitor via Admin Panel

Open `http://localhost:8990/admin` — see key health, usage analytics, cost tracking, and rotate keys in real-time.

---

## What It Does

| Feature | Description |
| ------- | ----------- |
| **Key rotation** | Automatically switches to next key on 429 (rate limit) or 402 (quota) |
| **Health monitoring** | Probes exhausted keys every 5 min with exponential backoff |
| **Permanent freeze** | Freezes keys with zero balance (Exa free tier) — no wasted retries |
| **Multi-destination sync** | Updates system env vars, files, and proxy simultaneously |
| **Usage analytics** | Tracks requests, tokens, and estimated cost per key/provider |
| **Budget tracking** | Daily/monthly spend caps per key with auto-disable |
| **Virtual keys** | Scoped `vk-xxxx` keys with provider/model whitelists and rate limits |
| **Circuit breaker** | Per-provider failover with configurable thresholds |
| **Response caching** | LRU cache for repeated requests |
| **Fallback routing** | Cross-provider failover chains |
| **Notifications** | Telegram bot + Slack webhooks for key events |
| **Prometheus metrics** | `/metrics` endpoint for Grafana dashboards |

---

## Supported Providers

### AI Models
OpenAI, Gemini, Groq, Mistral, ZhipuAI, SiliconFlow

### MCP / Search / Content
Brave Search, Exa, Jina, Firecrawl, Context7, Tavily, SearchAPI, OnRef

---

## Installation

<details>
<summary>Windows (PowerShell)</summary>

```powershell
./scripts/manage.ps1 install   # Install as Windows service (starts on boot)
./scripts/manage.ps1 status    # Check status
./scripts/manage.ps1 logs      # View logs
```

</details>

<details>
<summary>Linux (Systemd)</summary>

```bash
sudo ./scripts/manage.sh install   # Install as systemd service
sudo ./scripts/manage.sh status
sudo ./scripts/manage.sh logs
```
</details>

<details>
<summary>Docker</summary>

```yaml
# docker-compose.yml
services:
  keyproxy:
    build: .
    ports: ["8990:8990"]
    volumes: [./data:/app/data, ./.env:/app/.env]
    restart: unless-stopped
```

</details>

---

## MCP Integration Examples

Works with any MCP client that supports `NODE_OPTIONS`:

| Client | Config File | Setup |
| ------ | ----------- | ----- |
| Claude Code | `~/.claude.json` | Add `NODE_OPTIONS` to server env |
| Cursor | `settings.json` | Add `NODE_OPTIONS` to `mcp.servers` |
| Windsurf | `~/.codeium/windsurf/mcp.json` | Add `NODE_OPTIONS` to server env |
| Kiro | `~/.kiro/settings/mcp.json` | Add `NODE_OPTIONS` to server env |
| VS Code | `settings.json` | Add `NODE_OPTIONS` to `mcp.servers` |

See [MCP Intercept README](src/inject/README.md) for full integration guides.

---

## Architecture

```
MCP Servers                    KeyProxy                          AI Providers
─────────────                  ─────────                         ────────────
Brave Search  ──┐              Key Rotator     ──┐
Exa           ──┤  intercept   Health Monitor  ──┤  rotated key   api.search.brave.com
Jina          ──┤ ──────────►  Circuit Breaker ──┤ ───────────►  api.exa.ai
Firecrawl     ──┤  :8990       Budget Tracker  ──┤               api.jina.ai
Context7      ──┘              Analytics       ──┘               api.firecrawl.dev
```

KeyProxy intercepts outgoing HTTP requests from MCP servers via `mcp-intercept.cjs`, injects a healthy rotated key, and forwards to the real API. No code changes needed in MCP servers.

---

## Security

- Real API keys never appear in MCP config files
- Admin panel protected with scrypt-hashed password + CSRF tokens
- Rate limiting on all admin API endpoints
- Security headers (CSP, X-Frame-Options, etc.)
- Input validation with Joi schemas
- Keys stored in `.env` (gitignored by default)

---

## Performance

- **Latency overhead**: ~5ms per request (local proxy)
- **Throughput**: 1000+ req/s single instance
- **Memory**: ~50-100MB
- **Key failover**: <100ms

---

## License

MIT License. Copyright (c) 2026 NestLab.
