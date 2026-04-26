# Password Reset Guide for KeyProxy

## Problem
After recent changes, KeyProxy admin panel requires password authentication. This is **normal and secure behavior**.

## Important Notes

### What Requires Password?
- ✅ **Admin Panel** (`http://localhost:8990/admin`) - Requires password for security
- ❌ **API Endpoints** (`http://localhost:8990/{provider}/*`) - Do NOT require password (unless `ACCESS_KEY` is configured)

### Current Password
The current admin password is: **`admin123`**

## How to Reset Password

### Method 1: Using .env File (Recommended)

1. Stop KeyProxy service:
   ```powershell
   .\scriptsmanage.ps1 stop
   ```

2. Delete the password hash file:
   ```powershell
   Remove-Item data\admin.hash -Force
   ```

3. Add new password to `.env`:
   ```env
   ADMIN_PASSWORD=your_new_password
   ```

4. Start KeyProxy:
   ```powershell
   .\scriptsmanage.ps1 start
   ```

5. The password will be automatically migrated to secure hash file and removed from `.env`

### Method 2: Using Admin Panel (If You Know Current Password)

1. Login to admin panel: `http://localhost:8990/admin`
2. Navigate to Settings
3. Use "Change Password" feature

### Method 3: Disable Admin Panel (NOT RECOMMENDED)

To completely disable admin panel authentication:

1. Stop KeyProxy
2. Delete `data/admin.hash`
3. Remove `ADMIN_PASSWORD` from all `.env` files
4. Start KeyProxy

**Warning:** This makes your admin panel publicly accessible!

## ACCESS_KEY vs ADMIN_PASSWORD

### ADMIN_PASSWORD
- Controls access to **admin panel** only
- Stored in `data/admin.hash` (encrypted with scrypt)
- Required for managing configuration

### ACCESS_KEY
- Controls access to **API endpoints** per provider
- Format: `{API_TYPE}_{PROVIDER}_ACCESS_KEY` in `.env`
- Passed in Authorization header: `[ACCESS_KEY:your_key]`
- Optional - if not set, API is publicly accessible

Example:
```env
# Require ACCESS_KEY for Gemini provider
GEMINI_GEMINI_ACCESS_KEY=secret123

# Now all requests to /gemini/* must include:
# Authorization: Bearer [ACCESS_KEY:secret123]
```

## Troubleshooting

### "Invalid or missing ACCESS_KEY" Error
This means the provider requires `ACCESS_KEY` in the request header.

**Solution:**
1. Check provider configuration in admin panel
2. Add `[ACCESS_KEY:your_key]` to Authorization header
3. Or remove `{API_TYPE}_{PROVIDER}_ACCESS_KEY` from `.env` to disable

### "Unauthorized" Error on Admin Panel
This means you need to login with admin password.

**Solution:**
1. Use current password: `admin123`
2. Or reset password using Method 1 above

## Security Best Practices

1. **Always use strong passwords** for admin panel
2. **Use ACCESS_KEY** for production API endpoints
3. **Never commit** `data/admin.hash` or passwords to git
4. **Rotate passwords** regularly
5. **Use HTTPS** in production (configure reverse proxy)

## Current Configuration

- Admin Panel: `http://localhost:8990/admin`
- Password: `admin123` (stored in `data/admin.hash`)
- API Endpoints: No ACCESS_KEY required (publicly accessible)
- Configured Providers: 13 (zhipuai, gemini, groq, mistral, brave, tavily, tavily_mcp, exa, searchapi, firecrawl, context7, onref, jina)
