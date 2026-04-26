# KeyProxy Quick Start

## 🚀 Access Admin Panel

1. Open: `http://localhost:8990/admin`
2. Login with password: **`admin123`**

## 🔑 Password Management

### Current Password
- **Admin Panel**: `admin123`
- **Storage**: `data/admin.hash` (encrypted)

### Reset Password
```powershell
# Stop service
.\scriptsmanage.ps1 stop

# Delete old hash
Remove-Item data\admin.hash -Force

# Add new password to .env
echo "ADMIN_PASSWORD=new_password" >> .env

# Start service (password will be auto-migrated)
.\scriptsmanage.ps1 start
```

**Full guide:** [Password Reset Guide](../troubleshooting/PASSWORD_RESET.md)

## 🔐 Security Notes

### What Requires Password?
- ✅ **Admin Panel** - Always requires password
- ❌ **API Endpoints** - No password by default

### API Authentication (Optional)
To require authentication for API endpoints, set `ACCESS_KEY` per provider:

```env
# Example: Require ACCESS_KEY for Gemini
GEMINI_GEMINI_ACCESS_KEY=secret123
```

Then include in requests:
```bash
curl -H "Authorization: Bearer [ACCESS_KEY:secret123]" \
  http://localhost:8990/gemini/v1/models
```

## 📊 Service Management

```powershell
# Check status
.\scriptsmanage.ps1 status

# View logs
.\scriptsmanage.ps1 logs

# Restart
.\scriptsmanage.ps1 restart

# Stop
.\scriptsmanage.ps1 stop

# Start
.\scriptsmanage.ps1 start
```

## 🌐 API Usage

### No Authentication (Default)
```bash
curl http://localhost:8990/tavily_mcp/?tavilyApiKey=ROTATO \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

### With ACCESS_KEY
```bash
curl http://localhost:8990/gemini/v1/models \
  -H "Authorization: Bearer [ACCESS_KEY:secret123]"
```

## 📚 Documentation

- [README.md](../../README.md) - Full documentation
- [Password Reset Guide](../troubleshooting/PASSWORD_RESET.md) - Password management
- [Environment Mapping](./ENVIRONMENT_MAPPING.md) - Environment variable mapping
- [Login Issues](../troubleshooting/LOGIN_ISSUES.md) - Troubleshoot login problems

## 🆘 Troubleshooting

### "Unauthorized" on Admin Panel
- Use password: `admin123`
- Or reset using instructions above

### "Invalid or missing ACCESS_KEY" on API
- Check if provider has `ACCESS_KEY` configured
- Add `[ACCESS_KEY:key]` to Authorization header
- Or remove `ACCESS_KEY` from `.env` to disable

### Service Not Running
```powershell
.\scriptsmanage.ps1 status
.\scriptsmanage.ps1 start
```

### Port Already in Use
```powershell
# Find process using port 8990
netstat -ano | findstr :8990

# Kill process (replace PID)
taskkill /PID <PID> /F

# Restart service
.\scriptsmanage.ps1 start
```
