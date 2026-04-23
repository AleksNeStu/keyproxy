# Logging Improvements Documentation

**Repository Policy:** This is a PUBLIC repository. All content MUST be in English. Never commit sensitive files.

## Quick Links

- [Main Summary](#summary)
- [Before & After Examples](#before--after-examples)
- [Log Format Guide](#log-format-reference)
- [Troubleshooting](#troubleshooting)

---

## Summary

### What Was Fixed

The logging system has been enhanced to provide clear visibility into API key rotation and failure tracking.

**Problems Solved:**
1. ✅ Unclear which specific API key failed
2. ✅ No context about why keys failed
3. ✅ HTTP 405 errors without helpful hints
4. ✅ Poor visual presentation in logs

**Files Modified:**
- `src/server.js` - Enhanced console logging with visual indicators
- `src/providers/BaseProvider.js` - Detailed provider-level logging
- `public/admin.html` - Improved admin panel display

### Key Features

**Visual Indicators:**
- ✓ Success (green)
- ✗ Failure (red)
- ⏳ Waiting for retry
- ⚠ Warning (all keys tried, HTTP 405)
- ❌ Critical (all keys exhausted)

**Enhanced Information:**
- Which key succeeded
- Which keys failed and why
- HTTP status codes with context
- Response times
- Retry attempt numbers
- Error messages from API

---

## Before & After Examples

### Example 1: Successful Request

**Before:**
```
[REQ-abc123] POST /tavily_mcp/search from 127.0.0.1
[REQ-abc123] Response: 200 OK
```

**After:**
```
[TAVILY_MCP::tvly...abc] Trying key (1/3 tried for this request)
[TAVILY_MCP::tvly...abc] ✓ Success (200)
[11:43:16.234] [abc123] POST /tavily_mcp/search ✓ 200 234ms key:tvly...abc
```

### Example 2: Key Rotation (One Failed)

**Before:**
```
[REQ-def456] Response: 200 OK
```

**After:**
```
[TAVILY_MCP::tvly...abc] ✗ Status 429 triggers rotation - trying next key (attempt 1/3)
[TAVILY_MCP] ⏳ Waiting 1000ms before retry (attempt 1/3)
[TAVILY_MCP::tvly...def] ✓ Success (200)
[11:43:16.500] [def456] POST /tavily_mcp/search ✓ 200 892ms FAILED:[tvly...abc(HTTP 429)] key:tvly...def
```

### Example 3: All Keys Exhausted

**Before:**
```
[REQ-ghi789] Response: 429 Too Many Requests
```

**After:**
```
[TAVILY_MCP] ⚠ All 3 keys tried. 3 rate limited.
[TAVILY_MCP] Failed keys summary:
  1. tvly...abc - HTTP 429: Rate limit exceeded
  2. tvly...def - HTTP 429: Rate limit exceeded
  3. tvly...xyz - HTTP 429: Rate limit exceeded
[TAVILY_MCP] ❌ All keys rate limited - returning 429
[11:43:17.800] [ghi789] POST /tavily_mcp/search ✗ 429 3200ms FAILED:[tvly...abc(HTTP 429), tvly...def(HTTP 429), tvly...xyz(HTTP 429)]
```

### Example 4: HTTP 405 Error

**Before:**
```
[REQ-jkl012] Response: 405 Method Not Allowed
```

**After:**
```
[TAVILY_MCP::tvly...abc] ⚠ HTTP 405 Method Not Allowed - GET /search
[TAVILY_MCP::tvly...abc] Hint: This endpoint may require a different HTTP method (GET/POST/PUT/DELETE)
[11:43:16.100] [jkl012] GET /tavily_mcp/search ✗ 405 156ms key:tvly...abc ERROR: HTTP 405
```

---

## Log Format Reference

### Console Log Format

```
[HH:MM:SS.mmm] [requestId] METHOD /provider/endpoint STATUS responseTime key:xxx FAILED:[...]
```

**Components:**
- `[11:43:16.234]` - Timestamp
- `[abc123]` - Request ID (9 chars)
- `POST` - HTTP method
- `/tavily_mcp/search` - Provider and endpoint
- `✓ 200` - Status indicator and code
- `234ms` - Response time
- `key:tvly...abc` - Successful key
- `FAILED:[...]` - Failed keys (if any)

### Admin Panel Format

**Success:**
```
12:18:54 PM [abc123] POST /search (tavily_mcp) 200 234ms ✓ key:tvly...abc
```

**With rotation:**
```
12:18:54 PM [def456] POST /search (tavily_mcp) 200 892ms ✗ FAILED: tvly...abc (HTTP 429) ✓ key:tvly...def
```

**All failed:**
```
12:18:55 PM [ghi789] POST /search (tavily_mcp) 429 3200ms ⚠ ALL KEYS FAILED: tvly...abc(HTTP 429), tvly...def(HTTP 429)
```

### HTTP Status Codes

| Code | Meaning | Typical Cause |
|------|---------|---------------|
| 200 | OK | Success |
| 400 | Bad Request | Invalid request format |
| 401 | Unauthorized | Invalid API key |
| 403 | Forbidden | Key lacks permissions |
| 404 | Not Found | Invalid endpoint |
| 405 | Method Not Allowed | Wrong HTTP method |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Provider error |
| 502 | Bad Gateway | Network/proxy error |
| 503 | Service Unavailable | Provider down |

---

## Troubleshooting

### Issue: All keys showing 429

**Log pattern:**
```
✗ 429 FAILED:[key1(HTTP 429), key2(HTTP 429), key3(HTTP 429)]
```

**Solutions:**
- Wait for rate limit reset (usually 1 minute)
- Add more API keys
- Reduce request rate
- Check provider's rate limit documentation

### Issue: HTTP 405 errors

**Log pattern:**
```
✗ 405 key:xxx ERROR: HTTP 405
[PROVIDER::xxx] ⚠ HTTP 405 Method Not Allowed - GET /endpoint
```

**Solutions:**
- Check API documentation for correct HTTP method
- Usually means using GET instead of POST or vice versa
- Update client code to use correct method

### Issue: Keys timing out

**Log pattern:**
```
✗ 502 FAILED:[key1(timeout), key2(timeout)]
```

**Solutions:**
- Check network connectivity
- Increase timeout: `PROVIDER_TIMEOUT_MS=120000`
- Check if provider is experiencing issues
- Verify firewall/proxy settings

### Issue: Single key always fails

**Log pattern:**
```
✓ 200 FAILED:[key1(HTTP 401)] key:key2
```

**Solutions:**
- Key1 is invalid or expired
- Remove or replace key1
- Check key permissions/quotas

### Issue: Slow responses

**Log pattern:**
```
✓ 200 5000ms key:xxx
```

**Solutions:**
- 5000ms is slow (5 seconds)
- Check provider status
- Consider adding more keys for load balancing
- Check network latency

---

## Configuration

### Retry Settings

```bash
KEYPROXY_RETRY_MAX_RETRIES=3        # Max attempts per request
KEYPROXY_RETRY_DELAY_MS=1000        # Base delay between retries
KEYPROXY_RETRY_BACKOFF=2            # Exponential backoff multiplier
```

**Effect on logs:**
- More retries = more keys tried before giving up
- Longer delay = more time between rotation attempts
- Higher backoff = exponentially longer waits (1s, 2s, 4s, 8s...)

### Custom Status Codes

```bash
DEFAULT_STATUS_CODES=429,503        # Trigger rotation on these codes
```

**Effect on logs:**
- Determines which status codes trigger key rotation
- Default: only 429 (rate limit)
- Can add: 503 (service unavailable), 500 (server error), etc.

### Timeout Settings

```bash
OPENAI_PROVIDER_TIMEOUT_MS=60000    # 60 second timeout
```

**Effect on logs:**
- Requests exceeding timeout show as `(timeout)` in failed keys
- Longer timeout = more time before giving up on slow keys

---

## Best Practices

1. **Monitor for patterns** - If same key always fails, investigate
2. **Check response times** - >1000ms is slow, >5000ms is very slow
3. **Watch for 429s** - Indicates rate limit issues, add more keys
4. **Note HTTP 405s** - Usually client-side issue, fix request method
5. **Track rotation frequency** - Frequent rotation = need more keys
6. **Review failed key summaries** - Shows which keys are problematic
7. **Use request IDs** - Track specific requests through logs
8. **Check timestamps** - Identify peak usage times

---

## Technical Details

### Key Information Flow

1. **BaseProvider** creates `_keyInfo` object:
   ```javascript
   response._keyInfo = {
     keyUsed: maskedKey,        // The key that succeeded
     actualKey: apiKey,          // Full key for internal use
     failedKeys: [               // All keys that failed
       { key: maskedKey, status: 429, reason: 'rate_limited' }
     ]
   };
   ```

2. **Proxy handler** extracts and passes to logging:
   ```javascript
   const keyInfo = response._keyInfo || null;
   server.logApiRequest(requestId, method, apiPath, providerName, 
                       response.statusCode, responseTime, error, clientIp, keyInfo);
   ```

3. **Server** logs to console and stores:
   - Console: Human-readable with visual indicators
   - Buffer: Structured JSON for admin panel
   - File: JSONL format for long-term storage

4. **Admin panel** displays with enhanced formatting

### Error Context Extraction

```javascript
// Extract error message from API response
let errorReason = 'rate_limited';
if (!streaming && response.data) {
  try {
    const errorData = JSON.parse(response.data);
    if (errorData.error && errorData.error.message) {
      errorReason = errorData.error.message.substring(0, 100);
    }
  } catch (e) {}
}
failedKeys.push({ key: maskedKey, status: response.statusCode, reason: errorReason });
```

---

## No Breaking Changes

All improvements are backward compatible:
- Existing log format still works
- No configuration changes required
- No API changes
- Gracefully handles old log entries
- Works automatically after server restart

---

## Repository Rules Compliance

✅ **All content in English** - No Russian or other languages  
✅ **Public repository safe** - No sensitive data in documentation  
✅ **Clear documentation** - Easy to understand and follow  
✅ **Best practices** - Follows project coding standards  

**Sensitive files excluded via .gitignore:**
- `.kiro/` - Agent configuration
- `.env` - Environment variables
- `data/` - Runtime data
- `logs/` - Log files
- `key-history.json` - API key usage

---

## Additional Resources

For more detailed information, see:
- Root documentation files for complete technical details
- `src/server.js` - Server logging implementation
- `src/providers/BaseProvider.js` - Provider logging implementation
- `public/admin.html` - Admin panel display logic

---

**Questions or Issues?** All improvements work automatically after server restart! 🎉
