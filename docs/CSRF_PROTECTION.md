# CSRF Protection Implementation

## Overview

This document describes the CSRF (Cross-Site Request Forgery) protection implemented in the KeyProxy admin panel.

## What is CSRF?

CSRF is an attack that forces an end user to execute unwanted actions on a web application in which they're currently authenticated. With a little help of social engineering (like sending a link via email/chat), an attacker may trick the users of a web application into executing actions of the attacker's choosing.

## Implementation Details

### Token Generation

- **Algorithm**: `crypto.randomBytes(32)` → 64-character hexadecimal string
- **Entropy**: 256 bits (cryptographically secure)
- **Format**: Hexadecimal (0-9, a-f)
- **Storage**: Server-side session memory

### Token Validation

- **Method**: Timing-safe comparison using `crypto.timingSafeEqual()`
- **Header**: `X-CSRF-Token` (case-insensitive)
- **Session Key**: `server.csrfToken`
- **Error Response**: 403 with `{ error: 'Invalid CSRF token' }`

### Token Lifecycle

1. **Login**: Token generated and returned in login response
2. **Storage**: Client stores in `localStorage` as `keyproxy_csrf_token`
3. **Validation**: Token required for all state-changing operations (POST/PUT/DELETE/PATCH)
4. **Rotation**: Token refreshed after each successful state-changing operation
5. **Logout**: Token cleared from server and client

## Protected Routes

All state-changing admin API routes require CSRF validation:

- `POST /admin/api/env` - Update environment variables
- `POST /admin/api/test` - Test API key
- `POST /admin/api/toggle-key` - Toggle API key
- `POST /admin/api/toggle-provider` - Toggle provider
- `POST /admin/api/change-password` - Change password
- `POST /admin/api/upgrade-password` - Upgrade password
- `POST /admin/api/telegram` - Update Telegram settings
- `POST /admin/api/reload` - Reload configuration
- `POST /admin/api/retry-config` - Update retry configuration
- `POST /admin/api/settings` - Update settings
- `POST /admin/api/env-files` - Add environment file
- `DELETE /admin/api/env-files` - Remove environment file
- `POST /admin/api/switch-env` - Switch environment file
- `POST /admin/api/reorder-env-files` - Reorder environment files
- `POST /admin/api/toggle-env-file-disabled` - Toggle environment file
- `POST /admin/api/health/check-all` - Health check all providers
- `POST /admin/api/health/reset` - Reset health status
- `POST /admin/api/notifications` - Update notifications
- `POST /admin/api/notifications/test` - Test notifications
- `POST /admin/api/analytics/reset` - Reset analytics
- `POST /admin/api/fallbacks` - Update fallbacks
- `POST /admin/api/circuit-breaker/*` - Circuit breaker operations
- `POST /admin/api/export-config` - Export configuration
- `POST /admin/api/import-config` - Import configuration
- `DELETE /admin/api/cache` - Clear cache
- `POST /admin/api/cache/config` - Update cache configuration
- `POST /admin/api/virtual-keys` - Create virtual key
- `DELETE /admin/api/virtual-keys/*` - Revoke virtual key
- `POST /admin/api/virtual-keys/*` - Toggle virtual key
- `POST /admin/api/budgets` - Set budget
- `DELETE /admin/api/budgets/*` - Remove budget
- `POST /admin/api/key-extend` - Extend key expiry
- `POST /admin/api/lb-strategy` - Update load balancing strategy
- `POST /admin/api/lb-weight` - Update load balancing weight
- `POST /admin/api/models` - Save models

## Exempt Routes

The following routes do NOT require CSRF validation:

- **GET requests**: All GET requests are exempt (read-only, idempotent)
- `POST /admin/login` - Login endpoint (no session exists yet)
- `GET /admin/api/csrf-token` - Token retrieval endpoint
- `GET /admin/api/auth` - Authentication check
- `GET /admin/api/login-status` - Login rate limit status

## Client-Side Implementation

### Token Management

```javascript
// Fetch CSRF token
async function fetchCsrfToken() {
    const response = await fetch('/admin/api/csrf-token');
    const data = await response.json();
    csrfToken = data.csrfToken;
    localStorage.setItem('keyproxy_csrf_token', csrfToken);
}

// Get CSRF token
function getCsrfToken() {
    if (!csrfToken) {
        csrfToken = localStorage.getItem('keyproxy_csrf_token');
    }
    return csrfToken;
}

// Clear CSRF token (on logout)
function clearCsrfToken() {
    csrfToken = null;
    localStorage.removeItem('keyproxy_csrf_token');
}
```

### Request Interceptor

The admin panel uses a fetch interceptor to automatically add CSRF tokens to all state-changing requests:

```javascript
const originalFetch = window.fetch;
window.fetch = function(url, options = {}) {
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

### Error Handling

When CSRF validation fails (403 response), the client:

1. Logs the error to console
2. Attempts to fetch a new CSRF token
3. Retries the request with the new token
4. If token fetch fails, reloads the page

## Security Considerations

### Token Strength

- **Entropy**: 256 bits (32 bytes × 8 bits)
- **Collision Resistance**: Negligible (2^256 possible values)
- **Prediction Resistance**: Cryptographically secure random generation

### Session Binding

- Token stored in server-side session memory
- Cannot be stolen via XSS (HttpOnly session cookie)
- Token rotation prevents replay attacks

### Timing Attack Prevention

- Uses `crypto.timingSafeEqual()` for token comparison
- Prevents attackers from determining valid tokens through timing analysis

### CORS Protection

- Session cookie has `SameSite=Strict` attribute
- Prevents CSRF from external sites even if token is compromised

## Testing

### Unit Tests

Run the CSRF test suite:

```bash
node test/csrf.test.js
```

Tests cover:
- Token generation (format, uniqueness)
- Token validation (matching, mismatching, invalid formats)
- Token extraction from headers
- Edge cases (null tokens, invalid lengths, invalid hex)

### Integration Testing

To test CSRF protection manually:

1. **Without CSRF token**:
   ```bash
   curl -X POST http://localhost:3000/admin/api/env \
     -H "Content-Type: application/json" \
     -d '{"test": "data"}' \
     --cookie "adminSession=valid-session-token"
   ```
   Expected: `403 {"error":"Invalid CSRF token"}`

2. **With valid CSRF token**:
   ```bash
   curl -X POST http://localhost:3000/admin/api/env \
     -H "Content-Type: application/json" \
     -H "X-CSRF-Token: valid-csrf-token" \
     -d '{"test": "data"}' \
     --cookie "adminSession=valid-session-token"
   ```
   Expected: `200 OK` (or appropriate response)

## Troubleshooting

### Common Issues

**Issue**: "Invalid CSRF token" errors

**Solutions**:
1. Clear browser localStorage (`keyproxy_csrf_token`)
2. Log out and log back in
3. Check browser console for detailed error messages
4. Verify server logs for CSRF validation failures

**Issue**: CSRF token not working after page refresh

**Solutions**:
1. Ensure `/admin/api/csrf-token` endpoint is accessible
2. Check that authentication is working (session cookie)
3. Verify fetch interceptor is properly configured

### Debug Logging

Server-side CSRF validation failures are logged:

```
[SECURITY] CSRF validation failed for POST /admin/api/env
```

Enable additional logging by checking console output in browser DevTools.

## Migration Guide

### For Existing Admin Panels

If you have custom admin panels or API clients:

1. **Fetch CSRF token after login**:
   ```javascript
   const response = await fetch('/admin/login', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ password: '...' })
   });
   const data = await response.json();
   const csrfToken = data.csrfToken; // Store this
   ```

2. **Include CSRF token in requests**:
   ```javascript
   fetch('/admin/api/env', {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'X-CSRF-Token': csrfToken // Include this
     },
     body: JSON.stringify({ ... })
   });
   ```

3. **Handle CSRF errors**:
   ```javascript
   if (response.status === 403) {
     const data = await response.json();
     if (data.error === 'Invalid CSRF token') {
       // Fetch new token and retry
     }
   }
   ```

## References

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [MDN: SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite)
- [Node.js crypto documentation](https://nodejs.org/api/crypto.html)

## Changelog

### Version 1.0.0 (2025-01-23)

- Initial implementation of CSRF protection
- Token generation and validation
- Server-side middleware
- Client-side fetch interceptor
- Comprehensive test suite
- Documentation
