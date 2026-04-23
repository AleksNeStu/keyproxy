# Logging and Key Rotation Improvements

**Language Policy:** All code, comments, documentation, and communication in this repository MUST be in English.

## Overview

This document describes the improvements made to the KeyProxy logging system to provide better visibility into API key rotation and failure tracking.

## Problem Statement

Previously, the logs showed:
- Generic provider names (e.g., "ROTATO" from query parameters)
- No clear indication of which specific API key failed
- Limited context about why keys failed
- Poor visibility in both console and admin panel

Example of old log:
```
11:43:16 AM [iogda3fk5] GET /?tavilyApiKey=ROTATO (tavily_mcp) (405) 348ms key:tvly...sZqd ERROR: HTTP 405
```

## Improvements Made

### 1. Enhanced Console Logging

**Server-level logging** (`src/server.js`):
- Added visual indicators (✓ for success, ✗ for errors)
- Prominently displays which key was used successfully
- Shows all failed keys with their status codes
- Includes error reasons for better debugging

Example new format:
```
[11:43:16.234] [iogda3fk5] POST /tavily_mcp/search ✓ 200 348ms key:tvly...sZqd
[11:43:16.234] [abc123def] POST /tavily_mcp/search ✗ 429 156ms FAILED:[tvly...abc(HTTP 429), tvly...def(HTTP 429)]
```

**Provider-level logging** (`src/providers/BaseProvider.js`):
- Added emoji indicators for better visual scanning (✓, ✗, ⏳, ⚠, ❌)
- Shows attempt numbers during retries
- Logs detailed failure summary when all keys are exhausted
- Special handling for HTTP 405 errors with helpful hints

Example:
```
[TAVILY_MCP::tvly...abc] ✗ Status 429 triggers rotation - trying next key (attempt 1/3)
[TAVILY_MCP] ⏳ Waiting 1000ms before retry (attempt 1/3)
[TAVILY_MCP::tvly...def] ✓ Success (200)
```

When all keys fail:
```
[TAVILY_MCP] ⚠ All 3 keys tried. 3 rate limited.
[TAVILY_MCP] Failed keys summary:
  1. tvly...abc - HTTP 429: rate_limited
  2. tvly...def - HTTP 429: rate_limited
  3. tvly...xyz - HTTP 429: rate_limited
[TAVILY_MCP] ❌ All keys rate limited - returning 429
```

### 2. Improved Admin Panel Display

**Visual enhancements** (`public/admin.html`):
- Successful key usage shown in bright green with checkmark: `✓ key:tvly...abc`
- Failed keys shown in red with cross: `✗ FAILED: tvly...abc (HTTP 429), tvly...def (error)`
- When all keys fail, highlighted with red background: `⚠ ALL KEYS FAILED: ...`
- Better color coding and font weights for quick scanning

### 3. Enhanced Error Context

**Error reason tracking**:
- Captures actual error messages from API responses
- Truncates long error messages to 100 characters for readability
- Distinguishes between rate limits, network errors, and other failures

**HTTP 405 handling**:
- Detects "Method Not Allowed" errors
- Provides helpful hints about using correct HTTP methods
- Logs the attempted method and path for debugging

### 4. Key Information Flow

The key information flows through the system as follows:

1. **BaseProvider** creates `_keyInfo` object:
   ```javascript
   response._keyInfo = {
     keyUsed: maskedKey,        // The key that succeeded
     actualKey: apiKey,          // Full key for internal use
     failedKeys: [               // All keys that failed before success
       { key: maskedKey, status: 429, reason: 'rate_limited' },
       { key: maskedKey, status: null, reason: 'timeout' }
     ]
   };
   ```

2. **Proxy handler** extracts `keyInfo` and passes to logging:
   ```javascript
   const keyInfo = response._keyInfo || null;
   server.logApiRequest(requestId, method, apiPath, providerName, 
                       response.statusCode, responseTime, error, clientIp, keyInfo);
   ```

3. **Server** logs to console and stores in buffer:
   - Console: Human-readable format with visual indicators
   - Buffer: Structured JSON for admin panel
   - File: JSONL format for long-term storage

4. **Admin panel** displays with enhanced formatting:
   - Color-coded status indicators
   - Prominent key information
   - Detailed failure information

## Usage Examples

### Successful Request
```
[11:43:16.234] [abc123] POST /openai/v1/chat/completions ✓ 200 234ms key:sk-...abc
```

### Request with Key Rotation
```
[11:43:16.100] [def456] POST /gemini/v1/models/gemini-pro:generateContent ✗ 429 156ms FAILED:[AIza...abc(HTTP 429)] key:AIza...def
```

### All Keys Exhausted
```
[11:43:16.500] [ghi789] POST /tavily/search ✗ 429 892ms FAILED:[tvly...abc(HTTP 429), tvly...def(HTTP 429), tvly...xyz(HTTP 429)]
```

### HTTP 405 Error
```
[TAVILY_MCP::tvly...abc] ⚠ HTTP 405 Method Not Allowed - GET /search
[TAVILY_MCP::tvly...abc] Hint: This endpoint may require a different HTTP method (GET/POST/PUT/DELETE)
```

## Benefits

1. **Faster Debugging**: Immediately see which keys are failing and why
2. **Better Monitoring**: Visual indicators make it easy to spot issues in logs
3. **Improved UX**: Admin panel clearly shows key rotation status
4. **Actionable Insights**: Error messages include hints for common issues
5. **Audit Trail**: Complete history of which keys were tried and their results

## Configuration

No configuration changes required. The improvements work with existing settings:

- `KEYPROXY_RETRY_MAX_RETRIES`: Controls how many times to retry with different keys
- `KEYPROXY_RETRY_DELAY_MS`: Base delay between retries
- `KEYPROXY_RETRY_BACKOFF`: Exponential backoff multiplier
- `DEFAULT_STATUS_CODES`: Custom status codes that trigger key rotation

## Testing

To test the improvements:

1. **Successful rotation**: Use multiple keys, rate-limit one, verify rotation works
2. **All keys exhausted**: Rate-limit all keys, verify clear error message
3. **HTTP 405**: Send GET to POST-only endpoint, verify helpful hint
4. **Admin panel**: Check logs display with proper formatting and colors

## Future Enhancements

Potential future improvements:
- Real-time log streaming in admin panel
- Log filtering by provider, status code, or key
- Export logs to CSV/JSON
- Alerting when specific keys consistently fail
- Key health dashboard with success/failure rates
