# KeyProxy Login Troubleshooting

## Problem
Nothing happens after entering the password on the admin panel login page.

## Diagnostics

### Step 1: Use the Test Page

1. Open: `http://localhost:8990/test-login`
2. Password is pre-filled: `admin123`
3. Click "Test Login"
4. Check the result:
   - ✅ "Login Successful" — login works
   - ❌ Error shown — password or server issue

5. If login succeeds, click "Test Auth Status"
6. Check the result:
   - ✅ "Authentication Verified" — cookies work
   - ❌ "Not Authenticated" — cookie issue

### Step 2: Check Browser Console

1. Open admin panel: `http://localhost:8990/admin`
2. Open DevTools (F12)
3. Go to the "Console" tab
4. Enter password `admin123` and click "Login"
5. Check for JavaScript errors

### Step 3: Check Cookies

1. In DevTools go to "Application" (Chrome) or "Storage" (Firefox)
2. Find "Cookies" → `http://localhost:8990`
3. After login, `adminSession` cookie should appear
4. If missing — cookie is not being set

## Common Issues

### Issue 1: JavaScript Error in Console

**Symptoms:**
- Errors visible in browser console
- "Login" button does not respond

**Fix:**
1. Verify `admin.html` loads completely
2. Check for script loading errors
3. Clear browser cache (Ctrl+Shift+Delete)

### Issue 2: Cookie Not Set

**Symptoms:**
- Login returns `success: true`
- But `adminSession` cookie does not appear in DevTools
- Page does not switch to admin panel after login

**Fix:**
1. Check browser settings — cookies must be allowed
2. Try a different browser
3. Check if antivirus/firewall is blocking cookies

### Issue 3: Wrong Password

**Symptoms:**
- Login returns "Invalid password"
- Or "Too many failed attempts"

**Fix:**
1. Make sure you are using: `admin123`
2. If password does not work, reset it:
   ```powershell
   .\scriptsmanage.ps1 stop
   Remove-Item data\admin.hash -Force
   echo "ADMIN_PASSWORD=admin123" >> .env
   .\scriptsmanage.ps1 start
   ```

### Issue 4: Service Not Updated

**Symptoms:**
- Code changes are not applied
- Old behavior persists

**Fix:**
```powershell
.\scriptsmanage.ps1 restart
```

## Test via PowerShell

```powershell
$body = @{ password = 'admin123' } | ConvertTo-Json
$response = Invoke-WebRequest -Uri 'http://localhost:8990/admin/login' `
    -Method POST `
    -Headers @{ 'Content-Type' = 'application/json' } `
    -Body $body `
    -UseBasicParsing

Write-Host "Status: $($response.StatusCode)"
Write-Host "Content: $($response.Content)"
```

Expected result:
```
Status: 200
Content: {"success":true,"passwordUpgradeAvailable":false}
```

## Check Server Logs

```powershell
.\scriptsmanage.ps1 logs
```

Look for:
- `[SECURITY] Login attempt` — login attempt
- `[SECURITY] Successful admin login` — successful login
- `[SECURITY] Failed login attempt` — failed attempt
