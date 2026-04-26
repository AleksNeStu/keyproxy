# MCP Intercept Module

> Transparent HTTP interception for MCP servers. Routes API calls through KeyProxy for automatic key rotation.

## Quick Start

```bash
# 1. Download the intercept module
curl http://localhost:8990/inject/mcp-intercept.cjs -o mcp-intercept.cjs

# 2. Add to your MCP server config
NODE_OPTIONS=--require ./mcp-intercept.cjs
```

## How It Works

```
MCP Server (Brave)                   MCP Server (Exa)            MCP Server (Jina)
  fetch()                            axios → http.request        node-fetch → http.request
    ↓                                     ↓                           ↓
  ┌──────────────────────────────────────────────────────────────────────────┐
  │                     mcp-intercept.cjs                                    │
  │  Layer 1: globalThis.fetch  → URL rewrite + auth strip                 │
  │  Layer 2: http.request      → URL rewrite + auth strip                 │
  └──────────────────────────────┬──────────────────────────────────────────┘
                                 ↓
                       KeyProxy :8990
                 (key rotation, health check)
                                 ↓
                       Real API (brave, exa, jina)
```

## Configuration (Env Vars)

| Variable | Default | Description |
|----------|---------|-------------|
| `KEYPROXY_URL` | `http://localhost:8990` | KeyProxy base URL |
| `KEYPROXY_ROUTES` | Built-in map | JSON: `{ "api.host.com": "provider" }` |
| `KEYPROXY_STATUS_CODES` | `429,402,403` | Status codes triggering key rotation |

### Default Routes

```json
{
  "api.search.brave.com": "brave",
  "api.exa.ai": "exa",
  "r.jina.ai": "jina",
  "s.jina.ai": "jina",
  "api.firecrawl.dev": "firecrawl",
  "api.context7.com": "context7"
}
```

## Integration Examples

### Claude Code (`~/.claude.json`)

```json
{
  "search-brave": {
    "command": "npx",
    "args": ["-y", "@brave/brave-search-mcp-server"],
    "env": {
      "BRAVE_API_KEY": "placeholder",
      "NODE_OPTIONS": "--require E:/nestlab-repo/nest-solo/infra/keyproxy/src/inject/mcp-intercept.cjs",
      "KEYPROXY_ROUTES": "{\"api.search.brave.com\":\"brave\"}"
    }
  }
}
```

### Cursor / VS Code (`settings.json`)

```json
{
  "mcp.servers": {
    "search-brave": {
      "command": "npx",
      "args": ["-y", "@brave/brave-search-mcp-server"],
      "env": {
        "BRAVE_API_KEY": "placeholder",
        "NODE_OPTIONS": "--require /path/to/mcp-intercept.cjs"
      }
    }
  }
}
```

### Kiro (`~/.kiro/settings/mcp.json`)

```json
{
  "mcpServers": {
    "search-brave": {
      "command": "npx",
      "args": ["-y", "@brave/brave-search-mcp-server"],
      "env": {
        "BRAVE_API_KEY": "placeholder",
        "NODE_OPTIONS": "--require /path/to/mcp-intercept.cjs"
      }
    }
  }
}
```

## Supported Providers

| Provider | Auth Header | MCP Server Package |
|----------|------------|-------------------|
| Brave Search | `X-Subscription-Token` | `@brave/brave-search-mcp-server` |
| Exa | `x-api-key` | `exa-mcp-server` |
| Jina | `Authorization: Bearer` | `jina-mcp-tools` |
| Firecrawl | `Authorization: Bearer` | `firecrawl-mcp` |
| Context7 | `Authorization: Bearer` | `@upstash/context7-mcp` |

## Security

- **No real API keys in config** — use `"placeholder"` value
- All keys managed centrally in KeyProxy `.env`
- Keys are never exposed to MCP server processes
