/**
 * Main proxy route logic.
 * Handles API request proxying, route parsing, client creation,
 * virtual key validation, fallback routing.
 */

const { URL } = require('url');
const crypto = require('crypto');
const { sendError, sendResponse, isStreamingRequest } = require('./httpHelpers');

/**
 * Determine if a response status should trigger fallback routing.
 * Triggers on: 429 (rate limit), 5xx (server errors).
 * Does NOT trigger on 4xx client errors (except 429) — those are caller issues.
 */
function shouldTriggerFallback(statusCode) {
  return statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
}

/**
 * Attempt fallback routing through the full fallback chain.
 * Iterates through getFallback() until it returns null or a successful response is received.
 * The fallbackRouter already caps chain depth at maxDepth (2).
 *
 * @returns {{ success: boolean, response?: object, provider?: string, fallbackCount?: number }}
 */
async function tryFallbackChain(server, currentProvider, req, apiPath, body, headers, customStatusCodes, streaming, requestId) {
  if (!server.fallbackRouter) return { success: false };

  let provider = currentProvider;
  let fallbackCount = 0;

  while (fallbackCount < server.fallbackRouter.maxDepth) {
    const fallback = server.fallbackRouter.getFallback(provider);
    if (!fallback) break;

    const fbProvider = server.config.getProvider(fallback.provider);
    if (!fbProvider || fbProvider.disabled) break;

    console.log(`[REQ-${requestId}] Attempting fallback ${fallbackCount + 1}: ${provider} → ${fallback.provider}`);
    try {
      const fbClient = await getProviderClient(server, fallback.provider, fbProvider, false);
      if (!fbClient) break;

      const fbBody = server.fallbackRouter.prepareBody(body, fallback);
      const fbResponse = await fbClient.makeRequest(req.method, apiPath, fbBody, headers, customStatusCodes, streaming);

      if (fbResponse.statusCode < 400) {
        console.log(`[REQ-${requestId}] Fallback ${fallbackCount + 1} succeeded via ${fallback.provider} (${fbResponse.statusCode})`);
        return { success: true, response: fbResponse, provider: fallback.provider, fallbackCount: fallbackCount + 1 };
      }

      console.log(`[REQ-${requestId}] Fallback ${fallback.provider} returned ${fbResponse.statusCode}, trying next in chain`);
      provider = fallback.provider;
      fallbackCount++;
    } catch (fbErr) {
      console.log(`[REQ-${requestId}] Fallback ${fallback.provider} failed: ${fbErr.message}`);
      provider = fallback.provider;
      fallbackCount++;
    }
  }

  return { success: false, fallbackCount };
}

/**
 * Parse a request URL into provider route info.
 * Returns null for non-API routes.
 */
function parseRoute(server, url) {
  if (!url) return null;

  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;

  // Parse new provider format: /{provider}/* (no version required)
  const pathParts = pathname.split('/').filter(part => part.length > 0);
  if (pathParts.length >= 1) {
    const providerName = pathParts[0].toLowerCase();
    const provider = server.config.getProvider(providerName);

    if (provider) {
      // Extract the API path after /{provider}
      const apiPath = '/' + pathParts.slice(1).join('/') + urlObj.search;

      return {
        providerName: providerName,
        apiType: provider.apiType,
        path: apiPath,
        provider: provider
      };
    }
  }

  // Backward compatibility - Legacy Gemini routes: /gemini/*
  if (pathname.startsWith('/gemini/')) {
    const geminiPath = pathname.substring(7);

    return {
      providerName: 'gemini',
      apiType: 'gemini',
      path: geminiPath + urlObj.search,
      legacy: true
    };
  }

  // Backward compatibility - Legacy OpenAI routes: /openai/*
  if (pathname.startsWith('/openai/')) {
    const openaiPath = pathname.substring(7);

    return {
      providerName: 'openai',
      apiType: 'openai',
      path: openaiPath + urlObj.search,
      legacy: true
    };
  }

  return null;
}

/**
 * Get or create a provider client.
 */
async function getProviderClient(server, providerName, provider, legacy = false) {
  // Handle legacy clients
  if (legacy) {
    if (providerName === 'gemini' && server.geminiClient) {
      return server.geminiClient;
    }
    if (providerName === 'openai' && server.openaiClient) {
      return server.openaiClient;
    }
    return null;
  }

  // Check if we already have a client for this provider
  if (server.providerClients.has(providerName)) {
    return server.providerClients.get(providerName);
  }

  // Create new client for this provider
  if (!provider) {
    return null;
  }

  try {
    // Use only enabled keys for rotation
    const enabledKeys = provider.keys; // Already filtered by config parser
    if (enabledKeys.length === 0) {
      console.log(`[SERVER] Provider '${providerName}' has no enabled keys`);
      return null;
    }
    const WindowsEnv = require('../destinations/windowsEnv');
    const systemEnvName = server.config.isProviderSyncEnabled(providerName)
      ? WindowsEnv.deriveEnvName(providerName)
      : null;
    const lbStrategyKey = `${provider.apiType.toUpperCase()}_${providerName.toUpperCase().replace(/-/g, '_')}_LB_STRATEGY`;
    const lbStrategy = server.config.envVars[lbStrategyKey] || 'round-robin';
    const ttlKey = `${provider.apiType.toUpperCase()}_${providerName.toUpperCase().replace(/-/g, '_')}_KEY_TTL_HOURS`;
    const ttlMs = parseFloat(server.config.envVars[ttlKey]) ? parseFloat(server.config.envVars[ttlKey]) * 3600000 : 0;
    const keyRotator = new server.KeyRotator(enabledKeys, provider.apiType, systemEnvName, server.historyManager, lbStrategy, ttlMs, providerName);
    keyRotator.onRotation = (provName, statusCode) => {
      server.metrics.incCounter('keyproxy_key_rotations_total', { provider: provName });
    };
    // Sync provider keys into history (add fresh entries, remove stale ones)
    const allKeys = provider.allKeys ? provider.allKeys.map(k => k.key) : enabledKeys;
    server.historyManager.syncProviderKeys(providerName, allKeys);
    const retryConfig = server.config.getRetryConfig(providerName);
    const timeoutKey = `${provider.apiType.toUpperCase()}_${providerName.toUpperCase().replace(/-/g, '_')}_TIMEOUT_MS`;
    const timeoutMs = parseInt(server.config.envVars[timeoutKey]) || 60000;
    let client;

    if (provider.apiType === 'openai') {
      client = new server.OpenAIClient(keyRotator, provider.baseUrl, providerName, retryConfig, timeoutMs, server.budgetTracker, provider);
    } else if (provider.apiType === 'gemini') {
      client = new server.GeminiClient(keyRotator, provider.baseUrl, providerName, retryConfig, timeoutMs, server.budgetTracker);
    } else {
      return null;
    }

    server.providerClients.set(providerName, client);
    console.log(`[SERVER] Created client for provider '${providerName}' (${provider.apiType})`);
    return client;
  } catch (error) {
    console.error(`[SERVER] Failed to create client for provider '${providerName}': ${error.message}`);
    return null;
  }
}

/**
 * Extract virtual key token from request headers.
 */
function extractVirtualKey(req) {
  // Check Authorization: Bearer vk-xxx
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer vk-')) {
    return auth.substring(7);
  }
  // Check x-api-key: vk-xxx
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey.startsWith('vk-')) {
    return apiKey;
  }
  return null;
}

/**
 * Extract custom status codes from the Authorization header.
 */
function parseStatusCodesFromAuth(server, authHeader) {
  // Extract [STATUS_CODES:...] from the Authorization header
  const match = authHeader?.match(/\[STATUS_CODES:([^\]]+)\]/i);
  let statusCodeStr;

  if (match) {
    statusCodeStr = match[1];
  } else {
    // Fallback to global default if configured, otherwise return null to trigger default 429 logic
    statusCodeStr = server.config?.envVars?.DEFAULT_STATUS_CODES;
    if (!statusCodeStr) return null;
  }

  const codes = new Set();

  // Parse each part (e.g., "429", "400-420", "500+", "400=+")
  const parts = statusCodeStr.split(',').map(s => s.trim());

  for (const part of parts) {
    if (part.includes('-')) {
      // Range: 400-420
      const [start, end] = part.split('-').map(n => parseInt(n.trim()));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          codes.add(i);
        }
      }
    } else if (part.endsWith('=+')) {
      // Equal or greater: 400=+
      const base = parseInt(part.slice(0, -2).trim());
      if (!isNaN(base)) {
        for (let i = base; i <= 599; i++) {
          codes.add(i);
        }
      }
    } else if (part.endsWith('+')) {
      // Greater than: 400+
      const base = parseInt(part.slice(0, -1).trim());
      if (!isNaN(base)) {
        for (let i = base + 1; i <= 599; i++) {
          codes.add(i);
        }
      }
    } else {
      // Single code: 429
      const code = parseInt(part.trim());
      if (!isNaN(code)) {
        codes.add(code);
      }
    }
  }

  return codes.size > 0 ? codes : null;
}

/**
 * Extract [ACCESS_KEY:...] from the Authorization header.
 */
function parseAccessKeyFromAuth(authHeader) {
  const match = authHeader?.match(/\[ACCESS_KEY:([^\]]+)\]/i);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Validate ACCESS_KEY for a provider.
 */
function validateAccessKey(server, providerName, authHeader) {
  const providerConfig = server.config.getProvider(providerName);
  if (!providerConfig || !providerConfig.accessKey) {
    return true;
  }

  const providedAccessKey = parseAccessKeyFromAuth(authHeader);
  if (!providedAccessKey) {
    return false;
  }

  return providedAccessKey === providerConfig.accessKey;
}

/**
 * Remove [STATUS_CODES:...] and [ACCESS_KEY:...] from the auth header.
 */
function cleanAuthHeader(authHeader) {
  if (!authHeader) return authHeader;

  const cleaned = authHeader
    .replace(/\[STATUS_CODES:[^\]]+\]/gi, '')
    .replace(/\[ACCESS_KEY:[^\]]+\]/gi, '')
    .trim();

  // If after cleaning we're left with just "Bearer" or "Bearer ", return null
  if (cleaned === 'Bearer' || cleaned === 'Bearer ') {
    return null;
  }

  return cleaned;
}

/**
 * Extract relevant headers for a given API type.
 */
function extractRelevantHeaders(headers, apiType) {
  const relevantHeaders = {};
  let headersToInclude;

  if (apiType === 'gemini') {
    headersToInclude = [
      'content-type',
      'accept',
      'user-agent',
      'x-goog-user-project'
    ];
  } else if (apiType === 'openai') {
    headersToInclude = [
      'content-type',
      'accept',
      'user-agent',
      'openai-organization',
      'openai-project'
    ];
  }

  for (const [key, value] of Object.entries(headers)) {
    if (headersToInclude.includes(key.toLowerCase())) {
      relevantHeaders[key] = value;
    }
  }

  return relevantHeaders;
}

/**
 * Record budget spend for a request.
 */
function recordBudgetSpend(server, apiKey, requestBody, responseBody, apiType) {
  if (!apiKey) return;
  const { estimateTokens, extractModel, estimateCost } = require('../core/pricing');
  const model = extractModel(requestBody, null);
  const inputTokens = estimateTokens(requestBody);
  const outputTokens = estimateTokens(responseBody);
  const cost = estimateCost(apiType, model, inputTokens, outputTokens);
  if (cost.totalCost > 0) {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
    server.budgetTracker.recordSpend(keyHash, cost.totalCost);
  }
}

/**
 * Main proxy request handler.
 * Processes API proxying with key rotation, circuit breaking, caching, fallbacks.
 */
async function handleProxyRequest(server, req, res, body) {
  const requestId = Math.random().toString(36).substring(2, 11);
  const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const startTime = Date.now();
  let fallbackAttempted = false;

  res._requestId = requestId;

  const isApiCall = parseRoute(server, req.url) !== null;
  console.log(`[REQ-${requestId}] ${req.method} ${req.url} from ${clientIp}`);

  const routeInfo = parseRoute(server, req.url);

  if (!routeInfo) {
    console.log(`[REQ-${requestId}] Invalid path: ${req.url}`);
    console.log(`[REQ-${requestId}] Response: 400 Bad Request - Invalid API path`);

    if (isApiCall) {
      const responseTime = Date.now() - startTime;
      server.logApiRequest(requestId, req.method, req.url, 'unknown', 400, responseTime, 'Invalid API path', clientIp);
    }

    sendError(res, 400, 'Invalid API path. Use /{provider}/* format');
    return;
  }

  const { providerName, apiType, path: apiPath, provider, legacy } = routeInfo;

  // Virtual key authentication check
  const vkToken = extractVirtualKey(req);
  if (vkToken) {
    const vkConfig = server.virtualKeyManager.validate(vkToken);
    if (!vkConfig) {
      console.log(`[REQ-${requestId}] Virtual key rejected`);
      sendError(res, 401, 'Invalid or expired virtual key');
      return;
    }
    if (vkConfig.allowedProviders.length > 0 && !vkConfig.allowedProviders.includes(providerName)) {
      console.log(`[REQ-${requestId}] Virtual key not authorized for provider '${providerName}'`);
      sendError(res, 403, `Virtual key not authorized for '${providerName}'`);
      return;
    }
    if (vkConfig.allowedModels.length > 0) {
      try {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        if (parsed.model && !vkConfig.allowedModels.some(m => parsed.model.includes(m) || m.includes(parsed.model))) {
          sendError(res, 403, `Virtual key not authorized for model '${parsed.model}'`);
          return;
        }
      } catch {}
    }
    req._virtualKey = vkConfig;
    console.log(`[REQ-${requestId}] Virtual key '${vkConfig.name}' authenticated`);
  }

  // Check if provider is disabled
  if (provider && provider.disabled) {
    console.log(`[REQ-${requestId}] Provider '${providerName}' is disabled`);
    if (isApiCall) {
      const responseTime = Date.now() - startTime;
      server.logApiRequest(requestId, req.method, apiPath, providerName, 503, responseTime, `Provider '${providerName}' is disabled`, clientIp);
    }
    sendError(res, 503, `Provider '${providerName}' is currently disabled`);
    return;
  }

  // Model filtering — reject requests with models not in the allowed list
  if (provider && provider.allowedModels && provider.allowedModels.length > 0) {
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      if (parsed.model) {
        const requestedModel = parsed.model;
        const isAllowed = provider.allowedModels.some(m =>
          requestedModel === m || requestedModel.startsWith(m + '-') || m.startsWith(requestedModel + '-')
        );
        if (!isAllowed) {
          console.log(`[REQ-${requestId}] Model '${requestedModel}' not in allowed list for '${providerName}'`);
          if (isApiCall) {
            const responseTime = Date.now() - startTime;
            server.logApiRequest(requestId, req.method, apiPath, providerName, 403, responseTime, `Model '${requestedModel}' not allowed`, clientIp);
          }
          sendError(res, 403, `Model '${requestedModel}' is not allowed for provider '${providerName}'. Allowed models: ${provider.allowedModels.join(', ')}`);
          return;
        }
      }
    } catch {}
  }

  console.log(`[REQ-${requestId}] Proxying to provider '${providerName}' (${apiType.toUpperCase()}): ${apiPath}`);

  // Get the appropriate header based on API type
  const authHeader = apiType === 'gemini'
    ? req.headers['x-goog-api-key']
    : req.headers['authorization'];

  // Parse custom status codes and access key from header
  const customStatusCodes = parseStatusCodesFromAuth(server, authHeader);

  // Validate ACCESS_KEY for this provider
  if (!validateAccessKey(server, providerName, authHeader)) {
    console.log(`[REQ-${requestId}] Response: 401 Unauthorized - Invalid or missing ACCESS_KEY for provider '${providerName}'`);

    if (isApiCall) {
      const responseTime = Date.now() - startTime;
      server.logApiRequest(requestId, req.method, apiPath, providerName, 401, responseTime, 'Invalid or missing ACCESS_KEY', clientIp);
    }

    sendError(res, 401, `Invalid or missing ACCESS_KEY for provider '${providerName}'`);
    return;
  }

  // Clean the auth header before passing to API
  const headers = extractRelevantHeaders(req.headers, apiType);
  if (authHeader) {
    const cleanedAuth = cleanAuthHeader(authHeader);
    if (cleanedAuth) {
      if (apiType === 'gemini') {
        headers['x-goog-api-key'] = cleanedAuth;
      } else {
        headers['authorization'] = cleanedAuth;
      }
    }
  }

  let response;

  // Circuit breaker check
  const cbCheck = server.circuitBreaker.check(providerName);
  if (!cbCheck.allowed) {
    console.log(`[REQ-${requestId}] Circuit breaker OPEN for '${providerName}' - returning 503`);
    sendError(res, 503, `Provider '${providerName}' circuit breaker is open. Retry later.`);
    return;
  }

  // Get or create client for this provider
  const client = await getProviderClient(server, providerName, provider, legacy);
  if (!client) {
    console.log(`[REQ-${requestId}] Response: 503 Service Unavailable - Provider '${providerName}' not configured`);

    if (isApiCall) {
      const responseTime = Date.now() - startTime;
      server.logApiRequest(requestId, req.method, apiPath, providerName, 503, responseTime, `Provider '${providerName}' not configured`, clientIp);
    }

    sendError(res, 503, `Provider '${providerName}' not configured`);
    return;
  }

  // Pass custom status codes to client if provided
  if (customStatusCodes) {
    console.log(`[REQ-${requestId}] Using custom status codes for rotation: ${Array.from(customStatusCodes).join(', ')}`);
  }

  // Detect streaming request
  const streaming = isStreamingRequest(body);
  if (streaming) {
    console.log(`[REQ-${requestId}] Streaming request detected`);
  }

  // Cache lookup (non-streaming, GET/POST only)
  if (!streaming && (req.method === 'POST' || req.method === 'GET') && server.responseCache.enabled) {
    const cached = server.responseCache.get(providerName, req.method, apiPath, body);
    if (cached) {
      console.log(`[REQ-${requestId}] Cache HIT for ${providerName}`);
      const responseTime = Date.now() - startTime;
      server.logApiRequest(requestId, req.method, apiPath, providerName, cached.statusCode, responseTime, null, clientIp);
      server.metrics.incCounter('keyproxy_requests_total', { provider: providerName, status: String(cached.statusCode) });
      server.metrics.incCounter('keyproxy_cache_hits_total', { provider: providerName });
      const cacheHeaders = { ...cached.headers, 'X-Cache': 'HIT', 'X-Cache-Age': Math.round((Date.now() - cached.cachedAt) / 1000) + 's' };
      res.writeHead(cached.statusCode, cacheHeaders);
      res.end(cached.data);
      return;
    }
    console.log(`[REQ-${requestId}] Cache MISS for ${providerName}`);
  }

  // Apply X-KeyProxy-Original-Host override for injection routing
  const originalHost = req.headers['x-keyproxy-original-host'];
  if (originalHost) {
    client._baseUrlOverride = `https://${originalHost}`;
  }

  try {
    response = await client.makeRequest(req.method, apiPath, body, headers, customStatusCodes, streaming);
  } catch (error) {
    const isTimeout = error.message && error.message.toLowerCase().includes('timeout');
    const statusCode = isTimeout ? 504 : 502;
    const statusText = isTimeout ? 'Gateway Timeout' : 'Bad Gateway';

    console.log(`[REQ-${requestId}] ${statusText}: ${error.message}`);

    // Record failure in circuit breaker
    server.circuitBreaker.recordFailure(providerName);

    // Attempt fallback chain for timeouts and network errors
    if (!fallbackAttempted) {
      fallbackAttempted = true;
      const fbResult = await tryFallbackChain(server, providerName, req, apiPath, body, headers, customStatusCodes, streaming, requestId);
      if (fbResult.success && fbResult.response) {
        const fbResponse = fbResult.response;
        const fbKeyInfo = fbResponse._keyInfo || null;
        const fbProviderConfig = server.config.getProvider(fbResult.provider);
        const fbResponseTime = Date.now() - startTime;

        server.metrics.incCounter('keyproxy_requests_total', { provider: fbResult.provider, status: String(fbResponse.statusCode) });
        server.metrics.incCounter('keyproxy_fallback_requests_total', { from: providerName, to: fbResult.provider });
        server.analytics.recordRequest({
          provider: fbResult.provider, statusCode: fbResponse.statusCode, latencyMs: fbResponseTime,
          requestBody: body, responseBody: fbResponse.data, apiKey: fbKeyInfo?.actualKey, apiType: fbProviderConfig?.apiType
        });
        if (isApiCall) {
          server.logApiRequest(requestId, req.method, apiPath, fbResult.provider, fbResponse.statusCode, fbResponseTime, null, clientIp, fbKeyInfo);
          server.metrics.observeHistogram('keyproxy_request_duration_seconds', { provider: fbResult.provider }, fbResponseTime / 1000);
        }
        server.logApiResponse(requestId, fbResponse, body);
        sendResponse(res, fbResponse);
        return;
      }
    }

    if (isApiCall) {
      const responseTime = Date.now() - startTime;
      server.logApiRequest(requestId, req.method, apiPath, providerName, statusCode, responseTime, error.message, clientIp);
      server.metrics.incCounter('keyproxy_requests_total', { provider: providerName, status: String(statusCode) });
      server.metrics.incCounter('keyproxy_errors_total', { provider: providerName, type: 'server' });
      server.metrics.observeHistogram('keyproxy_request_duration_seconds', { provider: providerName }, responseTime / 1000);
    }

    sendError(res, statusCode, `${statusText}: ${error.message}`);
    return;
  } finally {
    delete client._baseUrlOverride;
  }

  // Extract key info from response
  const keyInfo = response._keyInfo || null;

  if (streaming && response.stream) {
    // Streaming response - pipe directly to client
    const streamHeaders = { ...response.headers };
    streamHeaders['access-control-allow-origin'] = '*';

    res.writeHead(response.statusCode, streamHeaders);

    // Collect streamed chunks while piping to client (cap at 512KB to avoid memory issues)
    const MAX_CAPTURE = 512 * 1024;
    const streamChunks = [];
    let capturedSize = 0;
    let truncated = false;

    response.stream.on('data', (chunk) => {
      if (!truncated) {
        capturedSize += chunk.length;
        if (capturedSize <= MAX_CAPTURE) {
          streamChunks.push(chunk);
        } else {
          truncated = true;
        }
      }
    });

    response.stream.pipe(res);

    response.stream.on('end', () => {
      let streamedData = Buffer.concat(streamChunks).toString('utf8');
      if (truncated) {
        streamedData += `\n\n[... truncated at 512KB — total streamed: ${(capturedSize / 1024).toFixed(1)}KB]`;
      }
      server.storeResponseData(requestId, {
        method: req.method,
        endpoint: apiPath,
        apiType: apiType.toUpperCase(),
        status: response.statusCode,
        statusText: require('./httpHelpers').getStatusText(response.statusCode),
        contentType: response.headers['content-type'] || 'text/event-stream',
        responseData: streamedData,
        requestBody: body,
        streaming: true,
        keyInfo: keyInfo
      });

      if (isApiCall) {
        const responseTime = Date.now() - startTime;
        const error = response.statusCode >= 400 ? `HTTP ${response.statusCode}` : null;
        server.logApiRequest(requestId, req.method, apiPath, providerName, response.statusCode, responseTime, error, clientIp, keyInfo);
        server.metrics.incCounter('keyproxy_requests_total', { provider: providerName, status: String(response.statusCode) });
        server.metrics.observeHistogram('keyproxy_request_duration_seconds', { provider: providerName }, responseTime / 1000);
        if (response.statusCode >= 400) {
          server.metrics.incCounter('keyproxy_errors_total', { provider: providerName, type: response.statusCode >= 500 ? 'server' : 'client' });
        }
        server.analytics.recordRequest({
          provider: providerName, statusCode: response.statusCode, latencyMs: responseTime,
          requestBody: body, responseBody: streamedData, apiKey: keyInfo?.actualKey, apiType
        });
        // Circuit breaker tracking for streaming responses
        if (response.statusCode >= 500 || response.statusCode === 429) {
          server.circuitBreaker.recordFailure(providerName);
        } else {
          server.circuitBreaker.recordSuccess(providerName);
        }

        if (keyInfo?.actualKey) server.rpmTracker.record(keyInfo.actualKey);
        recordBudgetSpend(server, keyInfo?.actualKey, body, streamedData, apiType);
      }
      console.log(`[REQ-${requestId}] Streaming response completed`);
    });

    response.stream.on('error', (err) => {
      console.log(`[REQ-${requestId}] Streaming error: ${err.message}`);
      server.circuitBreaker.recordFailure(providerName);
      if (!res.headersSent) {
        sendError(res, 502, 'Streaming error');
      }
    });
  } else {
    // Non-streaming response
    if (isApiCall) {
      const responseTime = Date.now() - startTime;
      const error = response.statusCode >= 400 ? `HTTP ${response.statusCode}` : null;
      server.logApiRequest(requestId, req.method, apiPath, providerName, response.statusCode, responseTime, error, clientIp, keyInfo);
      server.metrics.incCounter('keyproxy_requests_total', { provider: providerName, status: String(response.statusCode) });
      server.metrics.observeHistogram('keyproxy_request_duration_seconds', { provider: providerName }, responseTime / 1000);

      // Circuit breaker tracking
      if (response.statusCode >= 500 || response.statusCode === 429) {
        server.circuitBreaker.recordFailure(providerName);
      } else {
        server.circuitBreaker.recordSuccess(providerName);
      }

      if (response.statusCode >= 400) {
        server.metrics.incCounter('keyproxy_errors_total', { provider: providerName, type: response.statusCode >= 500 ? 'server' : 'client' });
      }
      server.analytics.recordRequest({
        provider: providerName, statusCode: response.statusCode, latencyMs: responseTime,
        requestBody: body, responseBody: response.data, apiKey: keyInfo?.actualKey, apiType
      });
      if (keyInfo?.actualKey) server.rpmTracker.record(keyInfo.actualKey);
      recordBudgetSpend(server, keyInfo?.actualKey, body, response.data, apiType);
    }

    // Notify on all keys exhausted (only for 429 with full key exhaustion)
    if (keyInfo && keyInfo.failedKeys && response.statusCode === 429) {
      const providerClient = server.providerClients.get(providerName);
      if (providerClient && providerClient.keyRotator && providerClient.keyRotator.apiKeys.length > 0 &&
          keyInfo.failedKeys.length >= providerClient.keyRotator.apiKeys.length) {
        if (server.notifier) {
          server.notifier.send(`All keys exhausted for provider '${providerName}' (${keyInfo.failedKeys.length}/${providerClient.keyRotator.apiKeys.length})`, 'failures');
        }
      }
    }

    // Attempt fallback chain on 429 (rate limit) or 5xx (server errors)
    if (!fallbackAttempted && shouldTriggerFallback(response.statusCode)) {
      fallbackAttempted = true;
      const triggerReason = response.statusCode === 429 ? 'rate limit' : `server error ${response.statusCode}`;
      console.log(`[REQ-${requestId}] Triggering fallback due to ${triggerReason} from ${providerName}`);

      const fbResult = await tryFallbackChain(server, providerName, req, apiPath, body, headers, customStatusCodes, streaming, requestId);
      if (fbResult.success && fbResult.response) {
        const fbResponse = fbResult.response;
        const fbKeyInfo = fbResponse._keyInfo || null;
        const fbProviderConfig = server.config.getProvider(fbResult.provider);
        const fbResponseTime = Date.now() - startTime;

        server.metrics.incCounter('keyproxy_requests_total', { provider: fbResult.provider, status: String(fbResponse.statusCode) });
        server.metrics.incCounter('keyproxy_fallback_requests_total', { from: providerName, to: fbResult.provider });
        server.analytics.recordRequest({
          provider: fbResult.provider, statusCode: fbResponse.statusCode, latencyMs: fbResponseTime,
          requestBody: body, responseBody: fbResponse.data, apiKey: fbKeyInfo?.actualKey, apiType: fbProviderConfig?.apiType
        });
        if (keyInfo?.actualKey) server.rpmTracker.record(keyInfo.actualKey);
        recordBudgetSpend(server, fbKeyInfo?.actualKey, body, fbResponse.data, apiType);
        server.logApiResponse(requestId, fbResponse, body);
        sendResponse(res, fbResponse);
        return;
      }
    }

    server.logApiResponse(requestId, response, body);

    // Cache successful non-streaming responses
    if (!streaming && response.statusCode < 400 && server.responseCache.enabled) {
      server.responseCache.set(providerName, req.method, apiPath, body, response);
      res.setHeader('X-Cache', 'MISS');
    }

    sendResponse(res, response);
  }
}

module.exports = {
  parseRoute,
  getProviderClient,
  extractVirtualKey,
  parseStatusCodesFromAuth,
  parseAccessKeyFromAuth,
  validateAccessKey,
  cleanAuthHeader,
  extractRelevantHeaders,
  recordBudgetSpend,
  handleProxyRequest
};
