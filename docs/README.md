# KeyProxy Documentation

Welcome to the KeyProxy documentation. This guide will help you get started, configure, and troubleshoot your KeyProxy installation.

## 📖 Getting Started

- **[Quick Start Guide](./guides/QUICK_START.md)** - Get up and running in 5 minutes
- **[Environment Mapping](./guides/ENVIRONMENT_MAPPING.md)** - Configure API keys and providers
- **[Desktop Shortcuts](./guides/DESKTOP_SHORTCUTS.md)** - Set up Windows desktop shortcuts

## 🔧 Troubleshooting

- **[Password Reset](./troubleshooting/PASSWORD_RESET.md)** - Reset admin panel password
- **[Login Issues](./troubleshooting/LOGIN_ISSUES.md)** - Troubleshoot login problems

## 🏗️ Architecture

KeyProxy is a multi-provider API key orchestrator that:
- Automatically rotates API keys on rate limits or failures
- Synchronizes active keys to multiple destinations (System Env, Files, Web Proxy)
- Provides real-time monitoring via admin panel
- Supports 13+ providers (OpenAI, Gemini, Tavily, Firecrawl, etc.)

## 🔐 Security

- Admin panel requires password authentication (default: `admin123`)
- Passwords stored encrypted using scrypt in `data/admin.hash`
- API endpoints can optionally require `ACCESS_KEY` per provider
- Never commit `.env` files or `data/` directory to version control

## 📦 Installation

### Windows
```powershell
.\manage.ps1 install
```

### Linux
```bash
sudo ./manage.sh install
```

## 🛠️ Service Management

### Windows
```powershell
.\manage.ps1 status    # Check status
.\manage.ps1 start     # Start service
.\manage.ps1 stop      # Stop service
.\manage.ps1 restart   # Restart service
.\manage.ps1 logs      # View logs
```

### Linux
```bash
sudo ./manage.sh status
sudo ./manage.sh start
sudo ./manage.sh stop
sudo ./manage.sh restart
sudo ./manage.sh logs
```

## 🌐 Admin Panel

Access the admin panel at: **http://localhost:8990/admin**

Features:
- Real-time key usage monitoring
- Provider configuration
- Key rotation history
- Request logs and analytics
- Health status dashboard

## 📝 Configuration

KeyProxy uses a two-tier configuration system:

1. **Local `.env`** (project root) - Service settings, port, local overrides
2. **Global `.env`** (parent directory) - API keys, provider configurations

See [Environment Mapping Guide](./guides/ENVIRONMENT_MAPPING.md) for details.

## 🆘 Support

If you encounter issues:
1. Check the [Troubleshooting](./troubleshooting/) guides
2. Review service logs: `.\manage.ps1 logs`
3. Verify service status: `.\manage.ps1 status`
4. Check admin panel: http://localhost:8990/admin

## 📄 License

MIT License. See [LICENSE](../LICENSE) for details.
