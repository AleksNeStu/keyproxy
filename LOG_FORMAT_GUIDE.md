# Log Format Quick Reference Guide

**Language Policy:** All repository content MUST be in English only.

## Visual Indicators

| Symbol | Meaning | Context |
|--------|---------|---------|
| ✓ | Success | Request succeeded, key worked |
| ✗ | Failure | Request failed, key didn't work |
| ⏳ | Waiting | Delay before retry |
| ⚠ | Warning | All keys tried, or HTTP 405 |
| ❌ | Critical | All keys exhausted |

## Console Log Format

### Main Request Log
```
[HH:MM:SS.mmm] [requestId] METHOD /provider/endpoint STATUS responseTime key:xxx FAILED:[...]
```

**Example:**
```
[11:43:16.234] [abc123] POST /tavily_mcp/search ✓ 200 234ms key:tvly...abc
```

**Components:**
- `[11:43:16.234]` - Timestamp (hours:minutes:seconds.milliseconds)
- `[abc123]` - Unique request ID (9 characters)
- `POST` - HTTP method
- `/tavily_mcp/search` - Provider and endpoint path
- `✓ 200` - Success indicator and HTTP status code
- `234ms` - Response time in milliseconds
- `key:tvly...abc` - Masked API key that succeeded
- `FAILED:[...]` - List of keys that failed (if any)

### Provider-Level Logs

#### Trying a Key
```
[PROVIDER::key...abc] Trying key (1/3 tried for this request)
```

#### Success
```
[PROVIDER::key...abc] ✓ Success (200)
```

#### Rotation Triggered
```
[PROVIDER::key...abc] ✗ Status 429 triggers rotation - trying next key (attempt 1/3)
[PROVIDER::key...abc] Rate limited for this request (1/1 rate limited)
```

#### Waiting for Retry
```
[PROVIDER] ⏳ Waiting 1000ms before retry (attempt 1/3)
```

#### All Keys Tried
```
[PROVIDER] ⚠ All 3 keys tried. 3 rate limited.
[PROVIDER] Failed keys summary:
  1. key...abc - HTTP 429: Rate limit exceeded
  2. key...def - HTTP 429: Rate limit exceeded
  3. key...xyz - HTTP 429: Rate limit exceeded
[PROVIDER] ❌ All keys rate limited - returning 429
```

#### HTTP 405 Error
```
[PROVIDER::key...abc] ⚠ HTTP 405 Method Not Allowed - GET /endpoint
[PROVIDER::key...abc] Hint: This endpoint may require a different HTTP method (GET/POST/PUT/DELETE)
```

## Admin Panel Format

### Color Coding

| Color | Meaning | Example |
|-------|---------|---------|
| Green | Success | `✓ key:tvly...abc` |
| Red | Failure | `✗ FAILED: tvly...abc (HTTP 429)` |
| Red background | All failed | `⚠ ALL KEYS FAILED: ...` |
| Gray | Timestamp | `12:18:54 PM` |
| Blue | Request ID | `[abc123]` |
| Cyan | Provider | `(tavily_mcp)` |

### Log Entry Format
```
timestamp [requestId] METHOD endpoint (provider) status responseTime keyInfo error
```

**Examples:**

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

## Failed Keys Format

### In Console Logs
```
FAILED:[key1(status1), key2(status2), key3(reason)]
```

**Examples:**
- `FAILED:[tvly...abc(HTTP 429)]` - One key failed with 429
- `FAILED:[tvly...abc(HTTP 429), tvly...def(HTTP 429)]` - Two keys failed
- `FAILED:[tvly...abc(timeout)]` - Key failed due to timeout
- `FAILED:[tvly...abc(HTTP 500)]` - Key failed with server error

### In Admin Panel
```
✗ FAILED: key1 (HTTP 429), key2 (error), key3 (timeout)
```

## HTTP Status Codes

| Code | Meaning | Typical Cause |
|------|---------|---------------|
| 200 | OK | Request succeeded |
| 400 | Bad Request | Invalid request format |
| 401 | Unauthorized | Invalid API key |
| 403 | Forbidden | Key lacks permissions |
| 404 | Not Found | Invalid endpoint |
| 405 | Method Not Allowed | Wrong HTTP method (GET vs POST) |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Provider-side error |
| 502 | Bad Gateway | Network/proxy error |
| 503 | Service Unavailable | Provider down or disabled |

## Common Patterns

### Pattern 1: Successful Request (No Rotation)
```
[11:43:16.234] [abc123] POST /tavily_mcp/search ✓ 200 234ms key:tvly...abc
```
**Meaning:** Request succeeded on first try with key `tvly...abc`

---

### Pattern 2: Successful After One Rotation
```
[11:43:16.500] [def456] POST /tavily_mcp/search ✓ 200 892ms FAILED:[tvly...abc(HTTP 429)] key:tvly...def
```
**Meaning:** 
- First key `tvly...abc` failed with 429
- Second key `tvly...def` succeeded
- Total time: 892ms (includes retry delay)

---

### Pattern 3: All Keys Exhausted
```
[11:43:17.800] [ghi789] POST /tavily_mcp/search ✗ 429 3200ms FAILED:[tvly...abc(HTTP 429), tvly...def(HTTP 429), tvly...xyz(HTTP 429)]
```
**Meaning:**
- All 3 keys tried
- All failed with 429
- Total time: 3200ms (includes all retry delays)
- Request returned 429 to client

---

### Pattern 4: HTTP 405 Error
```
[11:43:16.100] [jkl012] GET /tavily_mcp/search ✗ 405 156ms key:tvly...abc ERROR: HTTP 405
```
**Meaning:**
- Used GET method on POST-only endpoint
- Key `tvly...abc` was used
- No rotation (405 doesn't trigger rotation by default)
- Check console for hint about correct method

---

### Pattern 5: Network Error
```
[11:43:16.200] [mno345] POST /tavily_mcp/search ✗ 502 5000ms FAILED:[tvly...abc(timeout), tvly...def(timeout)]
```
**Meaning:**
- Two keys tried
- Both timed out (network issue)
- Request returned 502 to client

## Troubleshooting Guide

### Issue: All keys showing 429
**Log pattern:**
```
✗ 429 FAILED:[key1(HTTP 429), key2(HTTP 429), key3(HTTP 429)]
```
**Solution:**
- Wait for rate limit to reset (usually 1 minute)
- Add more API keys
- Reduce request rate
- Check provider's rate limit documentation

---

### Issue: HTTP 405 errors
**Log pattern:**
```
✗ 405 key:xxx ERROR: HTTP 405
[PROVIDER::xxx] ⚠ HTTP 405 Method Not Allowed - GET /endpoint
```
**Solution:**
- Check API documentation for correct HTTP method
- Usually means using GET instead of POST or vice versa
- Update client code to use correct method

---

### Issue: Keys timing out
**Log pattern:**
```
✗ 502 FAILED:[key1(timeout), key2(timeout)]
```
**Solution:**
- Check network connectivity
- Increase timeout: `PROVIDER_TIMEOUT_MS=120000`
- Check if provider is experiencing issues
- Verify firewall/proxy settings

---

### Issue: Single key always fails
**Log pattern:**
```
✓ 200 FAILED:[key1(HTTP 401)] key:key2
```
**Solution:**
- Key1 is invalid or expired
- Remove or replace key1
- Check key permissions/quotas

---

### Issue: Slow responses
**Log pattern:**
```
✓ 200 5000ms key:xxx
```
**Solution:**
- 5000ms is slow (5 seconds)
- Check provider status
- Consider adding more keys for load balancing
- Check network latency

## Configuration Impact

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

## Best Practices

1. **Monitor for patterns** - If same key always fails, investigate
2. **Check response times** - >1000ms is slow, >5000ms is very slow
3. **Watch for 429s** - Indicates rate limit issues, add more keys
4. **Note HTTP 405s** - Usually client-side issue, fix request method
5. **Track rotation frequency** - Frequent rotation = need more keys
6. **Review failed key summaries** - Shows which keys are problematic
7. **Use request IDs** - Track specific requests through logs
8. **Check timestamps** - Identify peak usage times

## Quick Diagnosis Checklist

- [ ] Check status code (200 = good, 4xx/5xx = problem)
- [ ] Look for ✓ or ✗ indicator
- [ ] Check if key rotation occurred (FAILED:[...])
- [ ] Review response time (>1000ms = slow)
- [ ] Read error message if present
- [ ] Check console for detailed provider logs
- [ ] Verify correct HTTP method for 405 errors
- [ ] Count failed keys vs total keys
- [ ] Note error reasons (rate_limited, timeout, etc.)
- [ ] Check if pattern repeats across requests
