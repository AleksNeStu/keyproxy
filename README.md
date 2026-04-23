# 🛰️ KeyProxy

> **Professional API Key Orchestrator & Proxy** — Intelligent rotation, health monitoring, and seamless synchronization for AI development tools.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-lightgrey.svg)]()

---

## 🎯 What is KeyProxy?

**KeyProxy** is a production-ready API key management system that sits between your development tools and AI providers. It automatically detects failures, rotates to healthy keys, and synchronizes the active key across your entire development environment — all in real-time.

### 🔥 Core Features

- **🔄 Intelligent Key Rotation** — Automatic failover on rate limits (429), quota exhaustion (402), or errors
- **💊 Health Monitoring** — Real-time provider health checks with auto-recovery
- **🎯 Multi-Destination Sync** — Updates System Environment, local files, and web proxy simultaneously
- **📊 Usage Analytics** — Track requests, costs, and latency per key/provider
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
│  │ Analytics    │  │ Budget       │  │ Exclusion    │      │
│  │              │  │ Tracker      │  │ Manager      │      │
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

### 📊 Available Tabs

#### 1. **API Keys** — Provider & Key Management
- ✅ View all configured providers (OpenAI, Gemini, Tavily, etc.)
- ✅ Enable/disable individual keys
- ✅ Reorder keys for rotation priority
- ✅ View key status: Active, Fresh, Exhausted
- ✅ Real-time RPM (requests per minute) tracking
- ✅ Key expiration tracking with extend functionality
- ✅ Test individual keys
- ✅ Fetch and configure available models per provider
- ✅ Toggle provider sync to environment

#### 2. **API Logs** — Request Monitoring
- ✅ Real-time request logs (last 100 entries)
- ✅ View request details: method, endpoint, status, latency
- ✅ Filter by provider, status code
- ✅ Response inspection for debugging

#### 3. **Management** — Provider Health Dashboard
- ✅ Provider health status (Active, Degraded, Failed, Disabled)
- ✅ Key counts: Total, Enabled, Disabled, Exhausted
- ✅ Request statistics per provider
- ✅ Average response time tracking
- ✅ Last check timestamp
- ✅ Manual health check trigger
- ✅ Provider reset functionality

#### 4. **Analytics** — Usage & Cost Tracking
- ✅ Request count tracking
- ✅ Token usage estimation (input/output)
- ✅ Cost estimation per provider/key
- ✅ Date range filtering (7d, 30d, all)
- ✅ Top keys by usage
- ✅ Model breakdown
- ⏳ Charts visualization (planned)

#### 5. **Virtual Keys** — Scoped Access Control
- ✅ Generate virtual API keys (vk-xxxx format)
- ✅ Provider whitelist per virtual key
- ✅ Model whitelist per virtual key
- ✅ Rate limiting per virtual key
- ✅ Expiration dates
- ✅ Enable/disable virtual keys
- ✅ Revoke virtual keys

#### 6. **Budgets** — Spend Management
- ✅ Set daily/monthly budget per key
- ✅ Auto-disable keys when budget exceeded
- ✅ Budget tracking and alerts
- ✅ Reset budget counters
- ✅ View available keys for budget assignment

#### 7. **Configuration** — Environment Management
- ✅ Multi-environment support (.env files)
- ✅ Add/remove environment files
- ✅ Switch between environments
- ✅ Reorder environment priority (drag-and-drop)
- ✅ Enable/disable environment files
- ✅ File system browser for .env selection
- ✅ Hot reload configuration
- ✅ Import/export configuration backup

### ⚙️ Settings Modal
- ✅ Change admin password
- ✅ Telegram bot configuration
- ✅ Slack webhook notifications
- ✅ Notification event triggers
- ✅ Test notifications
- ✅ Cache configuration (enable/disable, TTL, max entries)
- ✅ Circuit breaker settings
- ✅ Fallback provider configuration
- ✅ Load balancing strategy (round-robin, weighted-random, least-used)
- ✅ Key weight configuration

---

## 🔄 How Key Rotation Works

1. **Request arrives** → KeyProxy receives API request
2. **Select key** → Choose next healthy key using load balancing strategy
3. **Forward request** → Send to provider with selected key
4. **Monitor response** → Check for rate limits (429), quota errors (402), failures
5. **Auto-rotate** → On error, mark key as exhausted and try next key
6. **Sync everywhere** → Update System Env, `.active_keys.env`, and web proxy
7. **Auto-recovery** → After cooldown (5 min default), retest exhausted keys with exponential backoff

### Load Balancing Strategies

- **Round-robin** — Distribute requests evenly across all keys (default)
- **Weighted-random** — Assign weights to prioritize certain keys
- **Least-used** — Route to key with lowest request count

---

## 🧩 Supported Providers

### LLM Providers
- ✅ **OpenAI** — GPT-4, GPT-3.5, embeddings
- ✅ **Gemini** — Gemini Pro, Gemini Flash
- ✅ **Anthropic** — Claude models (via OpenAI-compatible API)
- ✅ **Groq** — Fast inference

### Search Providers
- ✅ **Tavily** — AI-optimized search
- ✅ **Exa** — Semantic search
- ✅ **Brave Search** — Privacy-focused search

### Tool Providers
- ✅ **Firecrawl** — Web scraping and crawling
- ✅ **Jina** — Document parsing and embeddings
- ✅ **Context7** — Documentation search
- ✅ **RTFM** — Package documentation

---

## 🛠️ Advanced Features

### ✅ Implemented

#### Health Monitoring & Auto-Recovery
- Real-time provider health checks (every 5 minutes)
- Automatic recovery of exhausted keys after cooldown
- Exponential backoff for failed recovery attempts
- Max recovery attempts limit (default: 5)
- Configurable cooldown period (default: 5 minutes)

#### Circuit Breaker
- Per-provider circuit breaker pattern
- Threshold: 5 consecutive failures (configurable)
- Timeout: 30 seconds before retry (configurable)
- States: Closed → Open → Half-Open → Closed
- Manual reset via admin panel

#### Response Caching
- In-memory LRU cache for repeated requests
- Configurable TTL (default: 300 seconds)
- Configurable max entries (default: 1000)
- X-Cache HIT/MISS headers
- Enable/disable per provider

#### Virtual API Keys
- Generate scoped virtual keys (vk-xxxx format)
- Provider whitelist
- Model whitelist
- Rate limits per key
- Expiration dates
- Enable/disable/revoke functionality

#### Budget Tracking
- Daily/monthly spend caps per key
- Auto-disable when cap reached
- Notification on budget exceeded
- Reset counters
- Cost estimation based on token usage

#### Key Exclusion Manager
- Exclude specific keys from environment sync
- Pattern-based exclusion (regex support)
- Test exclusion patterns
- Enable/disable exclusions

#### Fallback Routing
- Cross-provider failover configuration
- Fallback chains (provider → fallback provider)
- Model mapping for fallbacks
- Max fallback depth: 2

#### Configuration Management
- Multi-environment support
- Import/export configuration
- Hot reload without restart
- File system browser
- Drag-and-drop priority ordering

#### Security
- Scrypt password hashing
- CSRF token protection
- Input validation (Joi schemas)
- Rate limiting on admin API
- Session-based authentication
- Security headers (CSP, X-Frame-Options, etc.)

#### Analytics
- Request count tracking
- Token usage estimation
- Cost estimation per provider/key
- Latency tracking
- Top keys by usage
- Model breakdown
- Date range filtering

#### Notifications
- Telegram bot integration
- Slack webhook support
- Configurable event triggers
- Test notification functionality

#### Prometheus Metrics
- `/metrics` endpoint for monitoring
- Request counters by provider/status
- Latency histograms
- Key rotation counters
- Error counters by type

### ⏳ Planned (See Roadmap)

- Analytics charts visualization (Task #27)
- Complete circuit breaker UI integration (Task #28)
- Settings tab reorganization (Task #33)
- Collapsible provider sections (Task #32)
- Comprehensive testing suite (Task #30)

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
- **Health checks**: Every 5 minutes (configurable)

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suite
node --test test/core/auth.test.js
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

### ✅ Completed (23 tasks)
- [x] Secure password storage with scrypt
- [x] Multi-environment configuration
- [x] Provider health monitoring
- [x] Telegram & Slack notifications
- [x] Auto-recovery of failed keys
- [x] Analytics tracking with cost estimation
- [x] Circuit breaker pattern
- [x] Fallback provider routing
- [x] Prometheus metrics endpoint
- [x] Docker containerization
- [x] Virtual API keys
- [x] Budget tracking per key
- [x] Response caching
- [x] CSRF protection & input validation
- [x] Key exclusion manager
- [x] Model selection per provider
- [x] Environment file priority management
- [x] Enhanced provider management UI
- [x] Load balancing strategies
- [x] Request timeout configuration
- [x] Key expiration tracking
- [x] RPM tracking per key
- [x] Configuration import/export

### 🚧 In Progress (10 tasks)
- [ ] Settings section enhancement (Task #22)
- [ ] API rate limiting improvements (Task #25)
- [ ] Enhanced auto-recovery UI (Task #26)
- [ ] Complete analytics dashboard with charts (Task #27)
- [ ] Complete circuit breaker integration (Task #28)
- [ ] Complete fallback routing UI (Task #29)
- [ ] Comprehensive testing suite (Task #30)
- [ ] Enhanced provider management (Task #31)
- [ ] Collapsible provider sections (Task #32)
- [ ] Move Settings to tab level (Task #33)

### 📋 Planned
- [ ] Screenshots for README (Task #34 - after UI completion)
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

---

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/AleksNeStu/keyproxy/issues)
- **Documentation**: [./docs](./docs)
- **Logs**: `./manage.ps1 logs` (Windows) or `./manage.sh logs` (Linux)

---

**Made with ❤️ by NestLab**
