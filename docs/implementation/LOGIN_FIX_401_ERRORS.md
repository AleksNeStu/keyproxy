# Login Fix: 401 Unauthorized Errors

## Problem

Users were unable to login to the admin panel and received repeated 401 Unauthorized errors for:
- `http://localhost:8990/admin/api/rpm`
- `http://localhost:8990/admin/api/key-expiry`

## Root Cause

The authentication system uses **HTTP-only cookies** (`adminSession` cookie) to maintain user sessions. However, the frontend was not sending cookies with fetch requests because:

1. **Missing `credentials: 'include'` in fetch requests** - By default, fetch() does not send cookies with requests
2. **Missing `Access-Control-Allow-Credentials` CORS header** - Server wasn't explicitly allowing credentials in cross-origin requests

## Authentication Flow

```
1. User logs in → POST /admin/login
2. Server validates password
3. Server generates session token and CSRF token
4. Server sets adminSession cookie (HttpOnly, Secure, SameSite=Strict)
5. Server returns CSRF token in response body
6. Client stores CSRF token in localStorage
7. Client makes authenticated requests with:
   - adminSession cookie (automatic via credentials: 'include')
   - X-CSRF-Token header (for state-changing operations)
```

## Solution

### Frontend Changes (public/admin.html)

1. **Added credentials to login request:**
```javascript
const response = await fetch('/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'include' // Required to send/receive cookies
});
```

2. **Added credentials to global fetch interceptor:**
```javascript
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
    // Always include credentials to send cookies
    options.credentials = options.credentials || 'include';
    
    // Add CSRF token to state-changing requests
    if (options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase())) {
        const token = getCsrfToken();
        if (token) {
            options.headers = options.headers || {};
            options.headers['X-CSRF-Token'] = token;
        }
    }
    
    return originalFetch(url, options);
};
```

### Backend Changes (src/server.js)

Added `Access-Control-Allow-Credentials` header to CORS configuration:

```javascript
res.setHeader('Access-Control-Allow-Origin', corsOrigin);
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token');
res.setHeader('Access-Control-Allow-Credentials', 'true'); // Required for cookies
res.setHeader('Access-Control-Max-Age', '86400');
```

## Impact

- ✅ Login now works correctly
- ✅ Session cookies are sent with all requests
- ✅ `/admin/api/rpm` endpoint returns data instead of 401
- ✅ `/admin/api/key-expiry` endpoint returns data instead of 401
- ✅ All authenticated endpoints now work properly
- ✅ CSRF protection remains intact

## Testing

To verify the fix:

1. Clear browser cookies and localStorage
2. Navigate to `http://localhost:8990/admin`
3. Login with admin password
4. Check browser DevTools → Network tab:
   - Login request should set `Set-Cookie: adminSession=...`
   - Subsequent requests should include `Cookie: adminSession=...`
5. Verify no 401 errors in console
6. Verify RPM badges and key expiry badges load correctly

## Security Notes

- **HttpOnly cookies** prevent XSS attacks from stealing session tokens
- **Secure flag** ensures cookies only sent over HTTPS (in production)
- **SameSite=Strict** prevents CSRF attacks via cookie
- **CSRF tokens** provide additional protection for state-changing operations
- **credentials: 'include'** is safe because we control both frontend and backend

## Related Files

- `public/admin.html` - Frontend authentication and fetch interceptor
- `src/server.js` - CORS configuration
- `src/routes/adminAuth.js` - Authentication logic
- `src/middleware/csrf.js` - CSRF token validation

## References

- [MDN: Fetch API - credentials](https://developer.mozilla.org/en-US/docs/Web/API/fetch#credentials)
- [MDN: Access-Control-Allow-Credentials](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials)
- [OWASP: Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
