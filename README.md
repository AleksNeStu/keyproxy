# 🛰️ KeyProxy

> **Professional API Key Orchestrator & Proxy** — Intelligent rotation, health monitoring, and seamless synchronization for AI development tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey.svg)]()

---

## 🎯 What is KeyProxy?

**KeyProxy** (formerly Nest-Rotato) is a production-ready API key management system that sits between your development tools and AI providers. It automatically detects failures, rotates to healthy keys, and synchronizes the active key across your entire development environment — all in real-time.

### 🔥 Key Features

- **🔄 Intelligent Key Rotation** — Automatic failover on rate limits (429), quota exhaustion (402), or errors
- **💊 Health Monitoring** — Real-time provider health checks with circuit breaker protection
- **🎯 Multi-Destination Sync** — Updates System Environment, local files, and web proxy simultaneously
- **📊 Analytics Dashboard** — Track usage, costs, latency, and request patterns per key/provider
- **🔐 Secure by Default** — Scrypt-encrypted passwords, CSRF protection, input validation
- **🌐 Web Proxy** — Zero-config HTTP proxy at `localhost:8990` for any client
- **⚡ Auto-Recovery** — Failed keys automatically recover after cooldown period
- **🎨 Professional Admin UI** — Real-time monitoring, configuration, and management

---

## 🚀 Quick Start

### Installation

#### Windows (PowerShell)
```powershell
# Install as Windows service (starts on boot)
./manage.ps1 install

# Check status
./manage.ps1 status

# View logs
./manage.ps1 logs
```

#### Linux (Systemd)
```bash
# Install as systemd service
sudo ./manage.sh install

# Check status
sudo ./manage.sh status

# View logs
sudo ./manage.sh logs
```

#### Docker
```bash
# Using Docker Compose
docker compose up -d

# Check logs
docker compose logs -f
```

### Configuration

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Add your API keys** (use `_1`, `_2` suffix for multiple keys):
   ```env
   # OpenAI Keys
   OPENAI_OPENAI_API_KEYS=sk-proj-xxx_1,sk-proj-yyy_2
   
   # Gemini Keys
   OPENAI_GEMINI_API_KEYS=AIzaSyXXX_1,AIzaSyYYY_2
   
   # Search Keys
   SEARCH_TAVILY_API_KEYS=tvly-xxx_1,tvly-yyy_2
   ```

3. **Start the service:**
   ```bash
   npm start
   ```

4. **Access admin panel:**
   ```
   http://localhost:8990/admin
   Default password: admin123
   ```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Development Tools                         │
│  (Cursor, Antigravity, CLI, Custom Apps)                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                      KeyProxy                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Key Rotator  │  │ Health Check │  │ Circuit      │      │
│  │              │  │              │  │ Breaker      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Analytics    │  │ Budget       │  │ Fallback     │      │
│  │              │  │ Tracker      │  │ Router       │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│ System   │  │ File     │  │ Web      │
│ Env      │  │ Sync     │  │ Proxy    │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │             │
     ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│              AI Providers (OpenAI, Gemini, etc.)            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎨 Admin Panel Features

### 📊 Dashboard Overview
- **Real-time key status** — Active, exhausted, recovering, disabled
- **Provider health** — Status badges, last check time, response time
- **Request metrics** — Total requests, success rate, error breakdown
- **Cost tracking** — Estimated costs per provider/key with budget alerts

### 🔑 API Keys Management
- **Multi-provider support** — 13+ providers (OpenAI, Gemini, Tavily, Firecrawl, etc.)
- **Bulk operations** — Enable/disable multiple keys at once
- **Key rotation history** — Track when and why keys were rotated
- **RPM tracking** — Real-time requests-per-minute with rate limit warnings
- **Model selection** — Fetch and filter available models per provider

### ⚙️ Configuration
- **Multi-environment support** — Switch between production, staging, personal configs
- **Priority ordering** — Drag-and-drop environment file priority
- **Hot reload** — Changes apply instantly without restart
- **Import/Export** — Backup and restore full configuration

### 📈 Analytics
- **Usage charts** — Requests over time, latency distribution
- **Cost estimation** — Per-provider breakdown with pricing tables
- **Top keys** — Most used keys with filtering
- **Performance metrics** — p50, p95, p99 latency tracking

### 🔔 Notifications
- **Telegram integration** — Broadcast alerts to Telegram channels
- **Slack webhooks** — Send notifications to Slack channels
- **Event triggers** — Key exhaustion, recovery, circuit breaker events

### 🛡️ Security
- **Password management** — Change password, force upgrade from default
- **CSRF protection** — Token-based protection for state-changing operations
- **Input validation** — Comprehensive validation on all API endpoints
- **Session management** — Secure cookie-based authentication

---

## 🔄 How Key Rotation Works

1. **Request arrives** → KeyProxy receives API request
2. **Select key** → Choose next healthy key using load balancing strategy
3. **Forward request** → Send to provider with selected key
4. **Monitor response** → Check for rate limits (429), quota errors (402), failures
5. **Auto-rotate** → On error, mark key as exhausted and try next key
6. **Sync everywhere** → Update System Env, `.active_keys.env`, and web proxy
7. **Auto-recovery** → After cooldown (5 min), retest exhausted keys

### Load Balancing Strategies

- **Round-robin** — Distribute requests evenly across all keys
- **Weighted-random** — Assign weights to prioritize certain keys
- **Least-used** — Route to key with lowest request count

---

## 🧩 Supported Providers

### LLM Providers
- **OpenAI** — GPT-4, GPT-3.5, embeddings
- **Gemini** — Gemini Pro, Gemini Flash
- **Anthropic** — Claude models
- **Groq** — Fast inference

### Search Providers
- **Tavily** — AI-optimized search
- **Exa** — Semantic search
- **Brave Search** — Privacy-focused search

### Tool Providers
- **Firecrawl** — Web scraping and crawling
- **Jina** — Document parsing and embeddings
- **Context7** — Documentation search
- **RTFM** — Package documentation

---

## 🛠️ Advanced Features

### Circuit Breaker
Prevents cascading failures by temporarily blocking requests to failing providers:
- **Threshold**: 5 consecutive failures (configurable)
- **Timeout**: 30 seconds before retry (configurable)
- **States**: Closed → Open → Half-Open → Closed

### Fallback Routing
Automatically retry failed requests on alternative providers:
```env
# If Groq fails, fallback to OpenAI
OPENAI_GROQ_FALLBACK=openai
OPENAI_GROQ_FALLBACK_MODEL=gpt-4o-mini
```

### Budget Tracking
Set daily/monthly spend caps per key with auto-disable:
```env
KEYPROXY_DEFAULT_DAILY_BUDGET=10.00
KEYPROXY_DEFAULT_MONTHLY_BUDGET=300.00
```

### Response Caching
In-memory LRU cache for repeated requests:
```env
KEYPROXY_CACHE_ENABLED=true
KEYPROXY_CACHE_TTL_SEC=300
KEYPROXY_CACHE_MAX_ENTRIES=1000
```

### Virtual API Keys
Generate scoped virtual keys with limited access:
- Provider whitelist
- Model whitelist
- Rate limits
- Expiration dates

### Prometheus Metrics
Export metrics for monitoring:
```
http://localhost:8990/metrics
```

Metrics include:
- `keyproxy_requests_total` — Total requests by provider/status
- `keyproxy_request_duration_seconds` — Request latency histogram
- `keyproxy_key_rotations_total` — Key rotation counter
- `keyproxy_errors_total` — Error counter by type

---

## 📦 Deployment Options

### Windows Service
```powershell
# Install
./manage.ps1 install

# Runs as background service, starts on boot
# Logs: daemon/keyproxy.out.log
```

### Linux Systemd
```bash
# Install
sudo ./manage.sh install

# Service: keyproxy.service
# Logs: journalctl -u keyproxy -f
```

### Docker
```yaml
# docker-compose.yml
version: '3.8'
services:
  keyproxy:
    build: .
    ports:
      - "8990:8990"
    volumes:
      - ./data:/app/data
      - ./.env:/app/.env
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8990/metrics"]
      interval: 30s
      timeout: 10s
      retries: 3
```

---

## 🔐 Security Best Practices

1. **Change default password** immediately after first login
2. **Use strong passwords** — Minimum 12 characters, mixed case, numbers, symbols
3. **Enable CSRF protection** — Already enabled by default
4. **Restrict admin access** — Use firewall rules to limit access to localhost
5. **Never commit secrets** — Keep `.env` and `data/` in `.gitignore`
6. **Regular backups** — Export configuration regularly
7. **Monitor logs** — Check for suspicious activity

---

## 📊 Performance

- **Latency overhead**: ~5-10ms per request
- **Throughput**: 1000+ requests/second (single instance)
- **Memory usage**: ~50-100MB (depends on cache size)
- **Key rotation**: <100ms failover time
- **Health checks**: Every 30 seconds (configurable)

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
node --test test/core/auth.test.js

# Run with coverage
npm run test:coverage
```

---

## 📚 Documentation

- **[Quick Start Guide](./docs/guides/QUICK_START.md)** — Get started in 5 minutes
- **[Environment Mapping](./docs/guides/ENVIRONMENT_MAPPING.md)** — Configure API keys
- **[Desktop Shortcuts](./docs/guides/DESKTOP_SHORTCUTS.md)** — Windows shortcuts setup
- **[Password Reset](./docs/troubleshooting/PASSWORD_RESET.md)** — Reset admin password
- **[Login Issues](./docs/troubleshooting/LOGIN_ISSUES.md)** — Troubleshoot login problems
- **[CSRF Protection](./docs/CSRF_PROTECTION.md)** — Security implementation details
- **[Security Test Report](./docs/SECURITY_TEST_REPORT.md)** — Security audit results

---

## 🛣️ Roadmap

### ✅ Completed
- [x] Secure password storage with scrypt
- [x] Multi-environment configuration
- [x] Provider health monitoring
- [x] Telegram & Slack notifications
- [x] Auto-recovery of failed keys
- [x] Analytics dashboard with cost tracking
- [x] Circuit breaker pattern
- [x] Fallback provider routing
- [x] Prometheus metrics endpoint
- [x] Docker containerization
- [x] Virtual API keys
- [x] Budget tracking per key
- [x] Response caching
- [x] CSRF protection & input validation

### 🚧 In Progress
- [ ] Complete analytics UI with charts
- [ ] Enhanced circuit breaker integration
- [ ] Comprehensive testing suite (target: 80% coverage)

### 📋 Planned
- [ ] Settings tab reorganization
- [ ] Collapsible provider sections
- [ ] API rate limiting enhancements
- [ ] WebSocket support for real-time updates
- [ ] Multi-user support with RBAC
- [ ] Audit logging
- [ ] Grafana dashboard templates

---

## 🤝 Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

---

## 📄 License

MIT License. Copyright (c) 2026 NestLab.

Based on the original high-availability rotation logic from the Rotato project.

---

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/keyproxy/issues)
- **Documentation**: [./docs](./docs)
- **Logs**: `./manage.ps1 logs` (Windows) or `./manage.sh logs` (Linux)

---

## 🙏 Acknowledgments

- Built with Node.js and zero external dependencies (except joi for validation)
- Inspired by high-availability patterns from production systems
- Community feedback and contributions

---

**Made with ❤️ by NestLab**
