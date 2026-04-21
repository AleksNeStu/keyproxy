const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Auth = require('./core/auth');
const MetricsCollector = require('./core/metrics');
const AnalyticsTracker = require('./core/analytics');
const FallbackRouter = require('./core/fallbackRouter');
const CircuitBreaker = require('./core/circuitBreaker');
const ConfigExporter = require('./core/configExporter');
const { SlidingWindowCounter } = require('./core/rateTracker');
const TelegramBot = require('./core/telegramBot');

class ProxyServer {
  constructor(config, geminiClient = null, openaiClient = null) {
    this.config = config;
    this.geminiClient = geminiClient;
    this.openaiClient = openaiClient;
    this.providerClients = new Map(); // Map of provider_name -> client instance
    this.server = null;
    this.adminSessionToken = null;
    this.logBuffer = []; // Store logs in RAM only (last 100 entries)
    this.responseStorage = new Map(); // Store response data for viewing

    // File logging - debounced write
    this.pendingLogEntries = [];
    this.logFlushTimer = null;
    this.logFlushDelay = 5000; // 5 second debounce
    this.logFilePath = path.join(process.cwd(), 'logs.jsonl');

    // Rate limiting for login
    this.failedLoginAttempts = 0;
    this.loginBlockedUntil = null;

    // Store required classes for reinitialization
    this.KeyRotator = require('./core/keyRotator');
    this.GeminiClient = require('./providers/gemini');
    this.OpenAIClient = require('./providers/openai');
    this.HealthMonitor = require('./core/healthCheck');
    this.Notifier = require('./core/notifier');

    // Key rotation history (persistent across restarts)
    const KeyHistoryManager = require('./core/keyHistory');
    this.historyManager = new KeyHistoryManager();

    // Prometheus metrics collector
    this.metrics = new MetricsCollector();

    // Analytics tracker (usage, cost estimation)
    this.analytics = new AnalyticsTracker();

    // Fallback router (cross-provider failover)
    this.fallbackRouter = null; // Initialized in start() after config loads

    // Circuit breaker (per-provider)
    const cbThreshold = parseInt(config.envVars?.KEYPROXY_CB_THRESHOLD) || 5;
    const cbTimeoutMs = (parseInt(config.envVars?.KEYPROXY_CB_TIMEOUT_SEC) || 30) * 1000;
    this.circuitBreaker = new CircuitBreaker(cbThreshold, cbTimeoutMs);

    // Config exporter/importer
    this.configExporter = new ConfigExporter(config);

    // Per-key RPM tracker (sliding window)
    this.rpmTracker = new SlidingWindowCounter();
    this._rpmPruneTimer = setInterval(() => this.rpmTracker.prune(), 60000);

    // Telegram bot (started after server.listen in start())
    this.telegramBot = new TelegramBot(this);
  }

  start() {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.server.listen(this.config.getPort(), () => {
      console.log(`Multi-API proxy server running on port ${this.config.getPort()}`);
      
      const providers = this.config.getProviders();
      for (const [providerName, config] of providers.entries()) {
        console.log(`Provider '${providerName}' (${config.apiType}): /${providerName}/* → ${config.baseUrl}`);
      }
      
      // Backward compatibility logging
      if (this.config.hasGeminiKeys()) {
        console.log(`Legacy Gemini endpoints: /gemini/*`);
      }
      if (this.config.hasOpenaiKeys()) {
        console.log(`Legacy OpenAI endpoints: /openai/*`);
      }
      
      if (this.config.hasAdminPassword()) {
        console.log(`Admin panel available at: http://localhost:${this.config.getPort()}/admin`);
      }

      // Start Telegram bot after server is listening
      this.initTelegramBot();

      // Start health monitor
      this.healthMonitor = new this.HealthMonitor(this);
      this.healthMonitor.start();

      // Initialize notifier
      this.notifier = new this.Notifier(this);
      this.notifier.configure({
        slackWebhookUrl: this.config.envVars.SLACK_WEBHOOK_URL,
        slackNotifyOn: this.config.envVars.SLACK_NOTIFY_ON,
        telegramNotifyOn: this.config.envVars.TELEGRAM_NOTIFY_ON
      });

      // Initialize fallback router
      this.fallbackRouter = new FallbackRouter(this.config);
    });

    this.server.on('error', (error) => {
      console.error('Server error:', error);
    });
  }

  async handleRequest(req, res) {
    const requestId = Math.random().toString(36).substring(2, 11);
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const startTime = Date.now();
    let fallbackAttempted = false;

    // Set CORS headers for all responses - accept all origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only log to file for API calls, always log to console
    const isApiCall = this.parseRoute(req.url) !== null;
    console.log(`[REQ-${requestId}] ${req.method} ${req.url} from ${clientIp}`);

    try {
      const body = await this.readRequestBody(req);

      // Serve static files from public directory
      if (req.url === '/tailwind-3.4.17.js' && (req.method === 'GET' || req.method === 'HEAD')) {
        try {
          const filePath = path.join(process.cwd(), 'public', 'tailwind-3.4.17.js');
          console.log(`[STATIC] Serving file from: ${filePath}`);

          if (req.method === 'HEAD') {
            // For HEAD requests, just send headers without body
            const stats = fs.statSync(filePath);
            res.writeHead(200, {
              'Content-Type': 'application/javascript',
              'Content-Length': stats.size,
              'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
            });
            res.end();
          } else {
            // For GET requests, send the file content
            const fileContent = fs.readFileSync(filePath, 'utf8');
            res.writeHead(200, {
              'Content-Type': 'application/javascript',
              'Content-Length': Buffer.byteLength(fileContent),
              'Cache-Control': 'public, max-age=31536000' // Cache for 1 year
            });
            res.end(fileContent);
          }
          console.log(`[STATIC] Successfully served: ${req.url}`);
          return;
        } catch (error) {
          console.log(`[STATIC] Error serving file: ${error.message}`);
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('File not found');
          return;
        }
      }

      // Handle root route - redirect to admin
      if (req.url === '/' || req.url === '') {
        res.writeHead(302, { 'Location': '/admin' });
        res.end();
        return;
      }

      // Prometheus metrics endpoint (unauthenticated, read-only)
      if (req.url === '/metrics' && req.method === 'GET') {
        this.updateMetrics();
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(this.metrics.render());
        return;
      }

      // Handle admin routes
      if (req.url.startsWith('/admin')) {
        await this.handleAdminRequest(req, res, body);
        return;
      }

      // Handle common browser requests that aren't API calls
      if (req.url === '/favicon.ico' || req.url === '/robots.txt') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      
      const routeInfo = this.parseRoute(req.url);
      
      if (!routeInfo) {
        console.log(`[REQ-${requestId}] Invalid path: ${req.url}`);
        console.log(`[REQ-${requestId}] Response: 400 Bad Request - Invalid API path`);
        
        if (isApiCall) {
          const responseTime = Date.now() - startTime;
          this.logApiRequest(requestId, req.method, req.url, 'unknown', 400, responseTime, 'Invalid API path', clientIp);
        }
        
        this.sendError(res, 400, 'Invalid API path. Use /{provider}/* format');
        return;
      }

      const { providerName, apiType, path, provider, legacy } = routeInfo;

      // Check if provider is disabled
      if (provider && provider.disabled) {
        console.log(`[REQ-${requestId}] Provider '${providerName}' is disabled`);
        if (isApiCall) {
          const responseTime = Date.now() - startTime;
          this.logApiRequest(requestId, req.method, path, providerName, 503, responseTime, `Provider '${providerName}' is disabled`, clientIp);
        }
        this.sendError(res, 503, `Provider '${providerName}' is currently disabled`);
        return;
      }

      console.log(`[REQ-${requestId}] Proxying to provider '${providerName}' (${apiType.toUpperCase()}): ${path}`);

      // Get the appropriate header based on API type
      const authHeader = apiType === 'gemini'
        ? req.headers['x-goog-api-key']
        : req.headers['authorization'];

      // Parse custom status codes and access key from header
      const customStatusCodes = this.parseStatusCodesFromAuth(authHeader);

      // Validate ACCESS_KEY for this provider
      if (!this.validateAccessKey(providerName, authHeader)) {
        console.log(`[REQ-${requestId}] Response: 401 Unauthorized - Invalid or missing ACCESS_KEY for provider '${providerName}'`);

        if (isApiCall) {
          const responseTime = Date.now() - startTime;
          this.logApiRequest(requestId, req.method, path, providerName, 401, responseTime, 'Invalid or missing ACCESS_KEY', clientIp);
        }

        this.sendError(res, 401, `Invalid or missing ACCESS_KEY for provider '${providerName}'`);
        return;
      }
      
      // Clean the auth header before passing to API
      const headers = this.extractRelevantHeaders(req.headers, apiType);
      if (authHeader) {
        const cleanedAuth = this.cleanAuthHeader(authHeader);
        if (cleanedAuth) {
          if (apiType === 'gemini') {
            headers['x-goog-api-key'] = cleanedAuth;
          } else {
            headers['authorization'] = cleanedAuth;
          }
        }
        // Important: don't set undefined/null as it would override the client's API key
      }

      let response;

      // Circuit breaker check
      const cbCheck = this.circuitBreaker.check(providerName);
      if (!cbCheck.allowed) {
        console.log(`[REQ-${requestId}] Circuit breaker OPEN for '${providerName}' - returning 503`);
        this.sendError(res, 503, `Provider '${providerName}' circuit breaker is open. Retry later.`);
        return;
      }

      // Get or create client for this provider
      const client = await this.getProviderClient(providerName, provider, legacy);
      if (!client) {
        console.log(`[REQ-${requestId}] Response: 503 Service Unavailable - Provider '${providerName}' not configured`);

        if (isApiCall) {
          const responseTime = Date.now() - startTime;
          this.logApiRequest(requestId, req.method, path, providerName, 503, responseTime, `Provider '${providerName}' not configured`, clientIp);
        }

        this.sendError(res, 503, `Provider '${providerName}' not configured`);
        return;
      }

      // Pass custom status codes to client if provided
      if (customStatusCodes) {
        console.log(`[REQ-${requestId}] Using custom status codes for rotation: ${Array.from(customStatusCodes).join(', ')}`);
      }

      // Detect streaming request
      const isStreaming = this.isStreamingRequest(body);
      if (isStreaming) {
        console.log(`[REQ-${requestId}] Streaming request detected`);
      }

      response = await client.makeRequest(req.method, path, body, headers, customStatusCodes, isStreaming);

      // Extract key info from response
      const keyInfo = response._keyInfo || null;

      if (isStreaming && response.stream) {
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
          this.storeResponseData(requestId, {
            method: req.method,
            endpoint: path,
            apiType: apiType.toUpperCase(),
            status: response.statusCode,
            statusText: this.getStatusText(response.statusCode),
            contentType: response.headers['content-type'] || 'text/event-stream',
            responseData: streamedData,
            requestBody: body,
            streaming: true,
            keyInfo: keyInfo
          });

          if (isApiCall) {
            const responseTime = Date.now() - startTime;
            const error = response.statusCode >= 400 ? `HTTP ${response.statusCode}` : null;
            this.logApiRequest(requestId, req.method, path, providerName, response.statusCode, responseTime, error, clientIp, keyInfo);
            this.metrics.incCounter('keyproxy_requests_total', { provider: providerName, status: String(response.statusCode) });
            this.metrics.observeHistogram('keyproxy_request_duration_seconds', { provider: providerName }, responseTime / 1000);
            if (response.statusCode >= 400) {
              this.metrics.incCounter('keyproxy_errors_total', { provider: providerName, type: response.statusCode >= 500 ? 'server' : 'client' });
            }
            this.analytics.recordRequest({
              provider: providerName, statusCode: response.statusCode, latencyMs: responseTime,
              requestBody: body, responseBody: streamedData, apiKey: keyInfo?.actualKey, apiType
            });
            if (keyInfo?.actualKey) this.rpmTracker.record(keyInfo.actualKey);
          }
          console.log(`[REQ-${requestId}] Streaming response completed`);
        });

        response.stream.on('error', (err) => {
          console.log(`[REQ-${requestId}] Streaming error: ${err.message}`);
          if (!res.headersSent) {
            this.sendError(res, 502, 'Streaming error');
          }
        });
      } else {
        // Non-streaming response
        if (isApiCall) {
          const responseTime = Date.now() - startTime;
          const error = response.statusCode >= 400 ? `HTTP ${response.statusCode}` : null;
          this.logApiRequest(requestId, req.method, path, providerName, response.statusCode, responseTime, error, clientIp, keyInfo);
          this.metrics.incCounter('keyproxy_requests_total', { provider: providerName, status: String(response.statusCode) });
          this.metrics.observeHistogram('keyproxy_request_duration_seconds', { provider: providerName }, responseTime / 1000);

          // Circuit breaker tracking
          if (response.statusCode >= 500 || response.statusCode === 429) {
            this.circuitBreaker.recordFailure(providerName);
          } else {
            this.circuitBreaker.recordSuccess(providerName);
          }

          if (response.statusCode >= 400) {
            this.metrics.incCounter('keyproxy_errors_total', { provider: providerName, type: response.statusCode >= 500 ? 'server' : 'client' });
          }
          this.analytics.recordRequest({
            provider: providerName, statusCode: response.statusCode, latencyMs: responseTime,
            requestBody: body, responseBody: response.data, apiKey: keyInfo?.actualKey, apiType
          });
          if (keyInfo?.actualKey) this.rpmTracker.record(keyInfo.actualKey);
        }

        // Notify on all keys exhausted
        if (keyInfo && keyInfo.failedKeys && response.statusCode === 429) {
          const client = this.providerClients.get(providerName);
          if (client && client.keyRotator && client.keyRotator.apiKeys.length > 0 &&
              keyInfo.failedKeys.length >= client.keyRotator.apiKeys.length) {
            if (this.notifier) {
              this.notifier.send(`All keys exhausted for provider '${providerName}' (${keyInfo.failedKeys.length}/${client.keyRotator.apiKeys.length})`, 'failures');
            }

            // Try fallback provider if configured
            if (this.fallbackRouter && !fallbackAttempted) {
              fallbackAttempted = true;
              const fallback = this.fallbackRouter.getFallback(providerName);
              if (fallback) {
                const fbProvider = this.config.getProvider(fallback.provider);
                if (fbProvider && !fbProvider.disabled) {
                  console.log(`[REQ-${requestId}] Attempting fallback: ${providerName} → ${fallback.provider}`);
                  try {
                    const fbClient = await this.getProviderClient(fallback.provider, fbProvider, false);
                    if (fbClient) {
                      const fbBody = this.fallbackRouter.prepareBody(body, fallback);
                      const fbResponse = await fbClient.makeRequest(req.method, path, fbBody, headers, customStatusCodes, isStreaming);
                      const fbKeyInfo = fbResponse._keyInfo || null;

                      if (fbResponse.statusCode < 400) {
                        console.log(`[REQ-${requestId}] Fallback succeeded via ${fallback.provider} (${fbResponse.statusCode})`);
                        this.metrics.incCounter('keyproxy_requests_total', { provider: fallback.provider, status: String(fbResponse.statusCode) });
                        this.metrics.incCounter('keyproxy_fallback_requests_total', { from: providerName, to: fallback.provider });
                        const fbResponseTime = Date.now() - startTime;
                        this.analytics.recordRequest({
                          provider: fallback.provider, statusCode: fbResponse.statusCode, latencyMs: fbResponseTime,
                          requestBody: fbBody, responseBody: fbResponse.data, apiKey: fbKeyInfo?.actualKey, apiType: fbProvider.apiType
                        });
                        this.logApiResponse(requestId, fbResponse, fbBody);
                        this.sendResponse(res, fbResponse);
                        return;
                      }
                      console.log(`[REQ-${requestId}] Fallback ${fallback.provider} returned ${fbResponse.statusCode}, serving original response`);
                    }
                  } catch (fbErr) {
                    console.log(`[REQ-${requestId}] Fallback ${fallback.provider} failed: ${fbErr.message}`);
                  }
                }
              }
            }
          }
        }

        this.logApiResponse(requestId, response, body);
        this.sendResponse(res, response);
      }
    } catch (error) {
      console.log(`[REQ-${requestId}] Request handling error: ${error.message}`);

      const isTimeout = error.message?.includes('timeout');
      const statusCode = isTimeout ? 504 : 500;
      const statusText = isTimeout ? 'Gateway Timeout' : 'Internal Server Error';
      console.log(`[REQ-${requestId}] Response: ${statusCode} ${statusText}`);

      if (isApiCall) {
        const responseTime = Date.now() - startTime;
        this.logApiRequest(requestId, req.method, req.url, 'unknown', statusCode, responseTime, error.message, clientIp);
        this.metrics.incCounter('keyproxy_errors_total', { provider: 'unknown', type: isTimeout ? 'timeout' : 'internal' });
      }

      this.sendError(res, statusCode, isTimeout ? 'Gateway timeout — upstream did not respond in time' : 'Internal server error');
    }
  }

  readRequestBody(req) {
    return new Promise((resolve) => {
      let body = '';
      
      req.on('data', (chunk) => {
        body += chunk;
      });
      
      req.on('end', () => {
        resolve(body || null);
      });
    });
  }

  parseRoute(url) {
    if (!url) return null;
    
    const urlObj = new URL(url, 'http://localhost');
    const path = urlObj.pathname;
    
    // Parse new provider format: /{provider}/* (no version required)
    const pathParts = path.split('/').filter(part => part.length > 0);
    if (pathParts.length >= 1) {
      const providerName = pathParts[0].toLowerCase();
      const provider = this.config.getProvider(providerName);

      if (provider) {
        // Extract the API path after /{provider}
        const apiPath = '/' + pathParts.slice(1).join('/') + urlObj.search;

        return {
          providerName: providerName,
          apiType: provider.apiType,
          path: apiPath, // Use path as-is, no adjustment needed
          provider: provider
        };
      }
    }
    
    // Backward compatibility - Legacy Gemini routes: /gemini/*
    if (path.startsWith('/gemini/')) {
      const geminiPath = path.substring(7); // Remove '/gemini'

      return {
        providerName: 'gemini',
        apiType: 'gemini',
        path: geminiPath + urlObj.search,
        legacy: true
      };
    }
    
    // Backward compatibility - Legacy OpenAI routes: /openai/*
    if (path.startsWith('/openai/')) {
      const openaiPath = path.substring(7); // Remove '/openai'

      return {
        providerName: 'openai',
        apiType: 'openai',
        path: openaiPath + urlObj.search,
        legacy: true
      };
    }
    
    return null;
  }


  async getProviderClient(providerName, provider, legacy = false) {
    // Handle legacy clients
    if (legacy) {
      if (providerName === 'gemini' && this.geminiClient) {
        return this.geminiClient;
      }
      if (providerName === 'openai' && this.openaiClient) {
        return this.openaiClient;
      }
      return null;
    }

    // Check if we already have a client for this provider
    if (this.providerClients.has(providerName)) {
      return this.providerClients.get(providerName);
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
      const WindowsEnv = require('./destinations/windowsEnv');
      const syncEnvVar = `${provider.apiType.toUpperCase()}_${providerName.toUpperCase()}_SYNC_ENV`;
      const systemEnvName = this.config.envVars[syncEnvVar]?.toLowerCase() === 'true'
        ? WindowsEnv.deriveEnvName(providerName)
        : null;
      const keyRotator = new this.KeyRotator(enabledKeys, provider.apiType, systemEnvName, this.historyManager);
      keyRotator.onRotation = (provName, statusCode) => {
        this.metrics.incCounter('keyproxy_key_rotations_total', { provider: provName });
      };
      // Sync provider keys into history (add fresh entries, remove stale ones)
      const allKeys = provider.allKeys ? provider.allKeys.map(k => k.key) : enabledKeys;
      this.historyManager.syncProviderKeys(providerName, allKeys);
      const retryConfig = this.config.getRetryConfig(providerName);
      const timeoutKey = `${provider.apiType.toUpperCase()}_${providerName.toUpperCase().replace(/-/g, '_')}_TIMEOUT_MS`;
      const timeoutMs = parseInt(this.config.envVars[timeoutKey]) || 60000;
      let client;

      if (provider.apiType === 'openai') {
        client = new this.OpenAIClient(keyRotator, provider.baseUrl, providerName, retryConfig, timeoutMs);
      } else if (provider.apiType === 'gemini') {
        client = new this.GeminiClient(keyRotator, provider.baseUrl, providerName, retryConfig, timeoutMs);
      } else {
        return null;
      }

      this.providerClients.set(providerName, client);
      console.log(`[SERVER] Created client for provider '${providerName}' (${provider.apiType})`);
      return client;
    } catch (error) {
      console.error(`[SERVER] Failed to create client for provider '${providerName}': ${error.message}`);
      return null;
    }
  }

  parseStatusCodesFromAuth(authHeader) {
    // Extract [STATUS_CODES:...] from the Authorization header
    const match = authHeader?.match(/\[STATUS_CODES:([^\]]+)\]/i);
    let statusCodeStr;
    
    if (match) {
      statusCodeStr = match[1];
    } else {
      // Fallback to global default if configured, otherwise return null to trigger default 429 logic
      statusCodeStr = this.config?.envVars?.DEFAULT_STATUS_CODES;
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
          // Add codes from base to 599 (reasonable upper limit for HTTP status codes)
          for (let i = base; i <= 599; i++) {
            codes.add(i);
          }
        }
      } else if (part.endsWith('+')) {
        // Greater than: 400+
        const base = parseInt(part.slice(0, -1).trim());
        if (!isNaN(base)) {
          // Add codes from base+1 to 599
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

  parseAccessKeyFromAuth(authHeader) {
    // Extract [ACCESS_KEY:...] from the Authorization header
    const match = authHeader?.match(/\[ACCESS_KEY:([^\]]+)\]/i);
    if (!match) return null;
    return match[1].trim();
  }

  validateAccessKey(provider, authHeader) {
    const providerConfig = this.config.getProvider(provider);
    if (!providerConfig || !providerConfig.accessKey) {
      // No access key required for this provider
      return true;
    }

    const providedAccessKey = this.parseAccessKeyFromAuth(authHeader);
    if (!providedAccessKey) {
      return false;
    }

    return providedAccessKey === providerConfig.accessKey;
  }

  cleanAuthHeader(authHeader) {
    // Remove [STATUS_CODES:...] and [ACCESS_KEY:...] from the auth header before passing to the actual API
    if (!authHeader) return authHeader;

    const cleaned = authHeader
      .replace(/\[STATUS_CODES:[^\]]+\]/gi, '')
      .replace(/\[ACCESS_KEY:[^\]]+\]/gi, '')
      .trim();

    // If after cleaning we're left with just "Bearer" or "Bearer ", return null
    // This allows the client to add its own API key
    if (cleaned === 'Bearer' || cleaned === 'Bearer ') {
      return null;
    }

    return cleaned;
  }

  extractRelevantHeaders(headers, apiType) {
    const relevantHeaders = {};
    let headersToInclude;

    if (apiType === 'gemini') {
      headersToInclude = [
        'content-type',
        'accept',
        'user-agent',
        'x-goog-user-project'
        // Don't include x-goog-api-key here - we handle it separately
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

  sendResponse(res, response) {
    res.writeHead(response.statusCode, response.headers);
    res.end(response.data);
  }

  sendError(res, statusCode, message) {
    console.log(`[SERVER] Sending error response: ${statusCode} - ${message}`);

    const errorResponse = {
      error: {
        code: statusCode,
        message: message,
        status: statusCode === 400 ? 'INVALID_ARGUMENT' : 'INTERNAL'
      }
    };

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(errorResponse));
  }

  /**
   * Detect if a request body contains stream: true
   */
  isStreamingRequest(body) {
    if (!body) return false;
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      return parsed.stream === true;
    } catch {
      return false;
    }
  }

  logApiResponse(requestId, response, requestBody = null) {
    const contentLength = response.headers['content-length'] || (response.data ? response.data.length : 0);
    const contentType = response.headers['content-type'] || 'unknown';
    
    // Store response data for viewing
    this.storeResponseData(requestId, {
      method: 'API_CALL',
      endpoint: 'proxied_request',
      apiType: 'LLM_API',
      status: response.statusCode,
      statusText: this.getStatusText(response.statusCode),
      contentType: contentType,
      responseData: response.data,
      requestBody: requestBody
    });
    
    // Log basic response info to console only (structured logging handled in handleRequest)
    const responseMsg = `[REQ-${requestId}] Response: ${response.statusCode} ${this.getStatusText(response.statusCode)}`;
    const contentMsg = `[REQ-${requestId}] Content-Type: ${contentType}, Size: ${contentLength} bytes`;
    
    console.log(responseMsg);
    console.log(contentMsg);
    
    // For error responses, log the error details to console
    if (response.statusCode >= 400) {
      try {
        const errorData = JSON.parse(response.data);
        if (errorData.error) {
          const errorMsg = `[REQ-${requestId}] Error: ${errorData.error.message || errorData.error.code || 'Unknown error'}`;
          console.log(errorMsg);
        }
      } catch (e) {
        // If response is not JSON, log first 200 chars of response
        const errorText = response.data ? response.data.toString().substring(0, 200) : 'No error details';
        const errorMsg = `[REQ-${requestId}] Error details: ${errorText}`;
        console.log(errorMsg);
      }
    }
    
    // For successful responses, log basic success info to console
    if (response.statusCode >= 200 && response.statusCode < 300) {
      const successMsg = `[REQ-${requestId}] Request completed successfully`;
      console.log(successMsg);
    }
  }

  getStatusText(statusCode) {
    const statusTexts = {
      200: 'OK',
      201: 'Created',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };
    return statusTexts[statusCode] || 'Unknown Status';
  }

  async handleAdminRequest(req, res, body) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = parsedUrl.pathname;
    const params = Object.fromEntries(parsedUrl.searchParams);
    
    // Check if admin password is configured
    const adminPassword = this.getAdminPassword();
    if (!adminPassword) {
      this.sendError(res, 503, 'Admin panel not configured');
      return;
    }
    
    // Serve main admin page
    if (path === '/admin' || path === '/admin/') {
      this.serveAdminPanel(res);
      return;
    }
    
    // Check authentication status
    if (path === '/admin/api/auth' && req.method === 'GET') {
      const isAuthenticated = this.isAdminAuthenticated(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ authenticated: isAuthenticated }));
      return;
    }
    
    // Check login rate limit status
    if (path === '/admin/api/login-status' && req.method === 'GET') {
      const now = Date.now();
      const isBlocked = this.loginBlockedUntil && now < this.loginBlockedUntil;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        blocked: isBlocked,
        blockedUntil: this.loginBlockedUntil,
        remainingSeconds: isBlocked ? Math.ceil((this.loginBlockedUntil - now) / 1000) : 0,
        failedAttempts: this.failedLoginAttempts
      }));
      return;
    }

    // Handle login
    if (path === '/admin/login' && req.method === 'POST') {
      await this.handleAdminLogin(req, res, body);
      return;
    }
    
    // Handle logout
    if (path === '/admin/logout' && req.method === 'POST') {
      this.adminSessionToken = null;
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Set-Cookie': 'adminSession=; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/admin'
      });
      res.end(JSON.stringify({ success: true }));
      return;
    }
    
    // All other admin routes require authentication
    if (!this.isAdminAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    
    // Admin API routes
    if (path === '/admin/api/env' && req.method === 'GET') {
      await this.handleGetEnvVars(res);
    } else if (path === '/admin/api/env-file' && req.method === 'GET') {
      await this.handleGetEnvFile(res);
    } else if (path === '/admin/api/env' && req.method === 'POST') {
      await this.handleUpdateEnvVars(res, body);
    } else if (path === '/admin/api/test' && req.method === 'POST') {
      await this.handleTestApiKey(res, body);
    } else if (path === '/admin/api/logs' && req.method === 'GET') {
      await this.handleGetLogs(res);
    } else if (path.startsWith('/admin/api/response/') && req.method === 'GET') {
      await this.handleGetResponse(res, path);
    } else if (path === '/admin/api/reorder-keys' && req.method === 'POST') {
      await this.handleReorderKeys(res, body);
    } else if (path === '/admin/api/key-usage' && req.method === 'GET') {
      await this.handleGetKeyUsage(res);
    } else if (path === '/admin/api/key-history' && req.method === 'GET') {
      await this.handleGetKeyHistory(res);
    } else if (path.startsWith('/admin/api/key-history/') && req.method === 'GET') {
      await this.handleGetKeyHistory(res, path.split('/').pop());
    } else if (path.startsWith('/admin/api/key-history/reset/') && req.method === 'POST') {
      await this.handleResetKeyHistory(res, path.split('/').pop());
    } else if (path === '/admin/api/toggle-key' && req.method === 'POST') {
      await this.handleToggleKey(res, body);
    } else if (path === '/admin/api/toggle-provider' && req.method === 'POST') {
      await this.handleToggleProvider(res, body);
    } else if (path === '/admin/api/toggle-sync-env' && req.method === 'POST') {
      await this.handleToggleSyncEnv(res, body);
    } else if (path === '/admin/api/upgrade-password' && req.method === 'POST') {
      await this.handleUpgradePassword(res);
    } else if (path === '/admin/api/change-password' && req.method === 'POST') {
      await this.handleChangePassword(res, body);
    } else if (path === '/admin/api/telegram' && req.method === 'GET') {
      await this.handleGetTelegramSettings(res);
    } else if (path === '/admin/api/telegram' && req.method === 'POST') {
      await this.handleUpdateTelegramSettings(res, body);
    } else if (path === '/admin/api/reload' && req.method === 'POST') {
      await this.handleReloadConfig(res);
    } else if (path === '/admin/api/retry-config' && req.method === 'GET') {
      await this.handleGetRetryConfig(res);
    } else if (path === '/admin/api/retry-config' && req.method === 'POST') {
      await this.handleUpdateRetryConfig(res, body);
    } else if (path === '/admin/api/settings' && req.method === 'POST') {
      await this.handleUpdateSettings(res, body);
    } else if (path === '/admin/api/env-files' && req.method === 'GET') {
      await this.handleGetEnvFiles(res);
    } else if (path === '/admin/api/env-files' && req.method === 'POST') {
      await this.handleAddEnvFile(res, body);
    } else if (path === '/admin/api/env-files' && req.method === 'DELETE') {
      await this.handleRemoveEnvFile(res, body);
    } else if (path === '/admin/api/switch-env' && req.method === 'POST') {
      await this.handleSwitchEnv(res, body);
    } else if (path === '/admin/api/reorder-env-files' && req.method === 'POST') {
      await this.handleReorderEnvFiles(res, body);
    } else if (path === '/admin/api/recovery-status' && req.method === 'GET') {
      await this.handleGetRecoveryStatus(res);
    } else if (path === '/admin/api/health' && req.method === 'GET') {
      await this.handleGetHealth(res);
    } else if (path === '/admin/api/health/check-all' && req.method === 'POST') {
      await this.handleHealthCheckAll(res);
    } else if (path === '/admin/api/health/reset' && req.method === 'POST') {
      await this.handleHealthReset(res, body);
    } else if (path === '/admin/api/notifications' && req.method === 'GET') {
      await this.handleGetNotifications(res);
    } else if (path === '/admin/api/notifications' && req.method === 'POST') {
      await this.handleUpdateNotifications(res, body);
    } else if (path === '/admin/api/notifications/test' && req.method === 'POST') {
      await this.handleTestNotification(res, body);
    } else if (path === '/admin/api/analytics' && req.method === 'GET') {
      await this.handleGetAnalytics(res, params);
    } else if (path === '/admin/api/analytics/reset' && req.method === 'POST') {
      await this.handleResetAnalytics(res);
    } else if (path === '/admin/api/fallbacks' && req.method === 'GET') {
      await this.handleGetFallbacks(res);
    } else if (path === '/admin/api/fallbacks' && req.method === 'POST') {
      await this.handleSetFallback(res, body);
    } else if (path === '/admin/api/circuit-breaker' && req.method === 'GET') {
      await this.handleGetCircuitBreaker(res);
    } else if (path.startsWith('/admin/api/circuit-breaker/') && req.method === 'POST') {
      await this.handleCircuitBreakerAction(res, path, body);
    } else if (path === '/admin/api/export-config' && req.method === 'POST') {
      await this.handleExportConfig(res, body);
    } else if (path === '/admin/api/import-config' && req.method === 'POST') {
      await this.handleImportConfig(res, body);
    } else if (path === '/admin/api/rpm' && req.method === 'GET') {
      await this.handleGetRpm(res);
    } else if (path === '/admin/api/select-env' && (req.method === 'GET' || req.method === 'POST')) {
      await this.handleSelectEnv(res);
    } else if (path === '/admin/api/fs-list' && req.method === 'GET') {
      await this.handleFsList(res, params.path);
    } else if (path === '/admin/api/fs-drives' && req.method === 'GET') {
      await this.handleFsDrives(res);
    } else {
      this.sendError(res, 404, 'Not found');
    }
  }
  
  generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
  }
  
  parseCookies(cookieHeader) {
    const cookies = {};
    if (cookieHeader) {
      cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.trim().split('=');
        if (parts.length === 2) {
          cookies[parts[0]] = parts[1];
        }
      });
    }
    return cookies;
  }
  
  isAdminAuthenticated(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    return cookies.adminSession === this.adminSessionToken && this.adminSessionToken !== null;
  }

  async handleAdminLogin(req, res, body) {
    try {
      // Check if login is currently blocked
      if (this.loginBlockedUntil && Date.now() < this.loginBlockedUntil) {
        const remainingSeconds = Math.ceil((this.loginBlockedUntil - Date.now()) / 1000);
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Too many failed login attempts. Please wait ${remainingMinutes} minute(s).`,
          blockedUntil: this.loginBlockedUntil,
          remainingSeconds: remainingSeconds
        }));
        return;
      }

      const data = JSON.parse(body);
      const adminPassword = this.getAdminPassword();

      if (Auth.verifyPassword(data.password, adminPassword)) {
        // Successful login - reset counters
        this.failedLoginAttempts = 0;
        this.loginBlockedUntil = null;
        this.adminSessionToken = this.generateSessionToken();

        // Set session cookie (expires in 24 hours)
        const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
        const upgradeAvailable = !Auth.isHash(adminPassword) && !Auth.loadHashFromFile();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `adminSession=${this.adminSessionToken}; HttpOnly; Expires=${expires}; Path=/admin`
        });
        res.end(JSON.stringify({ success: true, passwordUpgradeAvailable: upgradeAvailable }));
      } else {
        // Failed login - increment counter
        this.failedLoginAttempts++;
        const attemptsRemaining = 5 - this.failedLoginAttempts;

        // Block if reached 5 attempts
        if (this.failedLoginAttempts >= 5) {
          this.loginBlockedUntil = Date.now() + (5 * 60 * 1000); // 5 minutes
          console.log('[SECURITY] Login blocked due to 5 failed attempts. Blocked until:', new Date(this.loginBlockedUntil).toISOString());
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Too many failed login attempts. Please wait 5 minutes.',
            blockedUntil: this.loginBlockedUntil,
            remainingSeconds: 300
          }));
        } else {
          console.log(`[SECURITY] Failed login attempt ${this.failedLoginAttempts}/5`);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Invalid password. ${attemptsRemaining} attempt(s) remaining.`,
            attemptsRemaining: attemptsRemaining
          }));
        }
      }
    } catch (error) {
      this.sendError(res, 400, 'Invalid request');
    }
  }
  
  async handleGetEnvVars(res) {
    try {
      const envVars = this.config.getEffectiveEnvVars();
      const localEnvPath = path.join(process.cwd(), '.env');
      const rootEnvPath = envVars.EXTERNAL_ENV_PATH 
        ? path.resolve(process.cwd(), envVars.EXTERNAL_ENV_PATH) 
        : path.resolve(process.cwd(), '../../.env');
      const envPath = fs.existsSync(rootEnvPath) ? rootEnvPath : localEnvPath;

      // Don't send sensitive config to UI
      const safeEnv = { 
        vars: { ...envVars },
        envPath: envPath 
      };
      
      delete safeEnv.vars.ADMIN_PASSWORD;
      delete safeEnv.vars.TELEGRAM_BOT_TOKEN;
      delete safeEnv.vars.TELEGRAM_ALLOWED_USERS;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(safeEnv));
    } catch (error) {
      this.sendError(res, 500, 'Failed to retrieve effective environment variables');
    }
  }


  async handleGetEnvFile(res) {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(envContent);
    } catch (error) {
      this.sendError(res, 500, 'Failed to read .env file');
    }
  }

  getAdminPassword() {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);
      return Auth.getAdminPassword(envVars.ADMIN_PASSWORD);
    } catch (error) {
      return Auth.getAdminPassword(null);
    }
  }
  
  
  async handleUpdateEnvVars(res, body) {
    try {
      const envVars = JSON.parse(body);
      const envPath = path.join(process.cwd(), '.env');

      // Read current env to preserve admin password and disabled states
      const currentEnvContent = fs.readFileSync(envPath, 'utf8');
      const currentEnvVars = this.config.parseEnvFile(currentEnvContent);

      // Merge with new vars but preserve admin password
      const finalEnvVars = { ...envVars };
      if (currentEnvVars.ADMIN_PASSWORD) {
        finalEnvVars.ADMIN_PASSWORD = currentEnvVars.ADMIN_PASSWORD;
      }

      // Preserve _DISABLED, TELEGRAM_, and DEFAULT_STATUS_CODES entries from current env if not in new vars
      for (const [key, value] of Object.entries(currentEnvVars)) {
        if ((key.endsWith('_DISABLED') || key.startsWith('TELEGRAM_') || key === 'DEFAULT_STATUS_CODES' || key === 'KEEP_ALIVE_MINUTES') && !(key in finalEnvVars)) {
          finalEnvVars[key] = value;
        }
      }

      this.writeEnvFile(finalEnvVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to update environment variables');
    }
  }
  
  async handleUpdateSettings(res, body) {
    try {
      const settings = JSON.parse(body);
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      const envVars = this.config.parseEnvFile(envContent);

      if (settings.EXTERNAL_ENV_PATH !== undefined) {
        if (settings.EXTERNAL_ENV_PATH.trim() === '') {
          delete envVars.EXTERNAL_ENV_PATH;
        } else {
          envVars.EXTERNAL_ENV_PATH = settings.EXTERNAL_ENV_PATH;
        }
      }

      this.writeEnvFile(envVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to update settings: ' + error.message);
    }
  }

  async handleReloadConfig(res) {
    try {
      this.config.loadConfig();
      this.reinitializeClients();
      const providers = [];
      for (const [name, config] of this.config.getProviders().entries()) {
        providers.push({ name, apiType: config.apiType, keyCount: config.keys.length, baseUrl: config.baseUrl });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, providers }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to reload config: ' + error.message);
    }
  }

  async handleGetRetryConfig(res) {
    try {
      const globalConfig = this.config.getRetryConfig();
      const perProvider = {};
      for (const [name] of this.config.getProviders().entries()) {
        perProvider[name] = this.config.getRetryConfig(name);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ global: globalConfig, perProvider }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get retry config: ' + error.message);
    }
  }

  async handleUpdateRetryConfig(res, body) {
    try {
      const data = JSON.parse(body);
      const envPath = path.join(process.cwd(), '.env');
      let envContent = '';
      if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
      }
      const envVars = this.config.parseEnvFile(envContent);

      // Global settings
      if (data.global) {
        if (data.global.maxRetries !== undefined) envVars.KEYPROXY_MAX_RETRIES = String(data.global.maxRetries);
        if (data.global.retryDelayMs !== undefined) envVars.KEYPROXY_RETRY_DELAY_MS = String(data.global.retryDelayMs);
        if (data.global.retryBackoff !== undefined) envVars.KEYPROXY_RETRY_BACKOFF = String(data.global.retryBackoff);
      }

      // Per-provider overrides
      if (data.perProvider) {
        // Clear existing per-provider retry settings
        for (const key of Object.keys(envVars)) {
          if (key.endsWith('_MAX_RETRIES') && !key.startsWith('KEYPROXY_')) delete envVars[key];
          if (key.endsWith('_RETRY_DELAY_MS') && !key.startsWith('KEYPROXY_')) delete envVars[key];
          if (key.endsWith('_RETRY_BACKOFF') && !key.startsWith('KEYPROXY_')) delete envVars[key];
        }
        for (const [prov, settings] of Object.entries(data.perProvider)) {
          const provUpper = prov.toUpperCase();
          if (settings.maxRetries !== undefined && settings.maxRetries !== null) {
            envVars[`${provUpper}_MAX_RETRIES`] = String(settings.maxRetries);
          }
          if (settings.retryDelayMs !== undefined && settings.retryDelayMs !== null) {
            envVars[`${provUpper}_RETRY_DELAY_MS`] = String(settings.retryDelayMs);
          }
          if (settings.retryBackoff !== undefined && settings.retryBackoff !== null) {
            envVars[`${provUpper}_RETRY_BACKOFF`] = String(settings.retryBackoff);
          }
        }
      }

      this.writeEnvFile(envVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to update retry config: ' + error.message);
    }
  }

  async handleSelectEnv(res) {
    try {
      const { exec } = require('child_process');
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = "Env files (*.env)|*.env|All files (*.*)|*.*"
$f.Title = "Select global .env file"
$result = $f.ShowDialog($form)
if ($result -eq 'OK') { Write-Output $f.FileName }
$form.Dispose()
`;
      const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
      
      exec(`powershell -NoProfile -STA -EncodedCommand ${encoded}`, (error, stdout) => {
        const selectedPath = stdout ? stdout.trim() : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: selectedPath || null }));
      });
    } catch (error) {
      this.sendError(res, 500, 'Failed to launch file picker: ' + error.message);
    }
  }

  async handleTestApiKey(res, body) {
    try {
      const { apiType, apiKey, baseUrl } = JSON.parse(body);
      let testResult = { success: false, error: 'Unknown API type' };
      
      if (apiType === 'gemini') {
        // Test Gemini API key with custom base URL if provided
        testResult = await this.testGeminiKey(apiKey, baseUrl);
      } else if (apiType === 'openai') {
        // Test OpenAI API key with custom base URL if provided
        testResult = await this.testOpenaiKey(apiKey, baseUrl);
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(testResult));
    } catch (error) {
      this.sendError(res, 500, 'Failed to test API key');
    }
  }
  
  async testGeminiKey(apiKey, baseUrl = null) {
    const testId = Math.random().toString(36).substring(2, 11);
    const testBaseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1';
    const startTime = Date.now();
    
    // Determine the correct path based on base URL
    let testPath = '/models';
    let fullUrl;
    
    if (testBaseUrl.includes('/v1') || testBaseUrl.includes('/v1beta')) {
      // Base URL already includes version, just append models
      fullUrl = `${testBaseUrl.endsWith('/') ? testBaseUrl.slice(0, -1) : testBaseUrl}/models?key=${apiKey}`;
    } else {
      // Base URL doesn't include version, add /v1/models
      fullUrl = `${testBaseUrl.endsWith('/') ? testBaseUrl.slice(0, -1) : testBaseUrl}/v1/models?key=${apiKey}`;
      testPath = '/v1/models';
    }
    
    try {
      const testResponse = await fetch(fullUrl);
      const responseText = await testResponse.text();
      const contentType = testResponse.headers.get('content-type') || 'unknown';
      const responseTime = Date.now() - startTime;
      
      // Store response data for viewing
      this.storeResponseData(testId, {
        method: 'GET',
        endpoint: testPath,
        apiType: 'Gemini',
        status: testResponse.status,
        statusText: testResponse.statusText,
        contentType: contentType,
        responseData: responseText,
        requestBody: null
      });
      
      // Log with structured format
      const error = !testResponse.ok ? `API test failed: ${testResponse.status} ${testResponse.statusText}` : null;
      this.logApiRequest(testId, 'GET', testPath, 'gemini', testResponse.status, responseTime, error, 'admin-test');
      
      console.log(`[TEST-${testId}] GET ${testPath} (Gemini) → ${testResponse.status} ${testResponse.statusText} | ${contentType} ${responseText.length}b`);
      
      return { 
        success: testResponse.ok, 
        error: error
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      console.log(`[TEST-${testId}] GET ${testPath} (Gemini) → ERROR: ${error.message}`);
      this.logApiRequest(testId, 'GET', testPath, 'gemini', null, responseTime, error.message, 'admin-test');
      
      return { success: false, error: error.message };
    }
  }
  
  async testOpenaiKey(apiKey, baseUrl = null) {
    const testId = Math.random().toString(36).substring(2, 11);
    const testBaseUrl = baseUrl || 'https://api.openai.com/v1';
    const startTime = Date.now();
    
    // Providers that use API keys in headers but do NOT have a standard /models endpoint
    const unsupportedModelsEndpoints = ['firecrawl.dev', 'context7.com', 'ref.tools', 'tavily.com'];
    if (unsupportedModelsEndpoints.some(domain => testBaseUrl.includes(domain))) {
      return { 
        success: true, 
        error: `Skip /models test: This provider does not support standard endpoint probing, but API key is loaded for proxy.`
      };
    }

    // Construct the full URL - just append /models to the base URL
    const fullUrl = `${testBaseUrl.endsWith('/') ? testBaseUrl.slice(0, -1) : testBaseUrl}/models`;
    
    // Determine display path for logging
    let testPath = '/models';

    if (testBaseUrl.includes('/openai/v1')) {
      testPath = '/openai/v1/models';
    } else if (testBaseUrl.includes('/v1')) {
      testPath = '/v1/models';
    }
    
    try {
      const testResponse = await fetch(fullUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      
      const responseText = await testResponse.text();
      const contentType = testResponse.headers.get('content-type') || 'unknown';
      const responseTime = Date.now() - startTime;
      
      // Store response data for viewing
      this.storeResponseData(testId, {
        method: 'GET',
        endpoint: testPath,
        apiType: 'OpenAI',
        status: testResponse.status,
        statusText: testResponse.statusText,
        contentType: contentType,
        responseData: responseText,
        requestBody: null
      });
      
      // Log with structured format
      const error = !testResponse.ok ? `API test failed: ${testResponse.status} ${testResponse.statusText}` : null;
      this.logApiRequest(testId, 'GET', testPath, 'openai', testResponse.status, responseTime, error, 'admin-test');
      
      console.log(`[TEST-${testId}] GET ${testPath} (OpenAI) → ${testResponse.status} ${testResponse.statusText} | ${contentType} ${responseText.length}b`);
      
      return { 
        success: testResponse.ok, 
        error: error
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      console.log(`[TEST-${testId}] GET ${testPath} (OpenAI) → ERROR: ${error.message}`);
      this.logApiRequest(testId, 'GET', testPath, 'openai', null, responseTime, error.message, 'admin-test');
      
      return { success: false, error: error.message };
    }
  }
  
  async handleGetLogs(res) {
    try {
      // Return logs from memory buffer only (last 100 entries)
      const recentLogs = this.logBuffer.slice(-100).map(log => {
        // Handle both old string format and new object format
        if (typeof log === 'string') {
          // Parse old string format: "2024-01-15T10:30:45.123Z [REQ-abc123] POST /endpoint"
          const match = log.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+(.*)$/);
          if (match) {
            return {
              timestamp: match[1],
              requestId: 'legacy',
              method: 'UNKNOWN',
              endpoint: 'unknown',
              provider: 'unknown',
              status: null,
              responseTime: null,
              error: null,
              clientIp: null,
              message: match[2] // Keep original message for backward compatibility
            };
          }
          return {
            timestamp: new Date().toISOString(),
            requestId: 'unknown',
            method: 'UNKNOWN',
            endpoint: 'unknown',
            provider: 'unknown',
            status: null,
            responseTime: null,
            error: null,
            clientIp: null,
            message: log
          };
        }
        return log; // Already an object
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        logs: recentLogs,
        totalEntries: recentLogs.length,
        format: 'json' // Indicate the new format
      }));
    } catch (error) {
      console.error('Failed to get logs:', error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        error: 'Failed to retrieve logs',
        logs: []
      }));
    }
  }
  
  
  logApiRequest(requestId, method, endpoint, provider, status = null, responseTime = null, error = null, clientIp = null, keyInfo = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: requestId || 'unknown',
      method: method || 'UNKNOWN',
      endpoint: endpoint || 'unknown',
      provider: provider || 'unknown',
      status: status,
      responseTime: responseTime,
      error: error,
      clientIp: clientIp,
      keyUsed: keyInfo ? keyInfo.keyUsed : null,
      failedKeys: keyInfo ? keyInfo.failedKeys : []
    };
    
    // Add to buffer (keep last 100 entries in RAM only)
    this.logBuffer.push(logEntry);
    if (this.logBuffer.length > 100) {
      this.logBuffer.shift();
    }

    // Queue for file write (debounced)
    this.pendingLogEntries.push(logEntry);
    if (this.logFlushTimer) clearTimeout(this.logFlushTimer);
    this.logFlushTimer = setTimeout(() => this.flushLogs(), this.logFlushDelay);
  }

  flushLogs(sync = false) {
    if (this.pendingLogEntries.length === 0) return;

    const entries = this.pendingLogEntries;
    this.pendingLogEntries = [];
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer);
      this.logFlushTimer = null;
    }

    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

    if (sync) {
      try {
        fs.appendFileSync(this.logFilePath, lines);
      } catch (err) {
        console.log(`[LOG] Failed to write to log file: ${err.message}`);
      }
    } else {
      fs.appendFile(this.logFilePath, lines, (err) => {
        if (err) {
          console.log(`[LOG] Failed to write to log file: ${err.message}`);
        }
      });
    }
  }

  
  // Helper method for backward compatibility - converts old string calls to new structured calls
  logApiRequestLegacy(message) {
    // Parse message to extract structured data
    const timestamp = new Date().toISOString();
    
    // Extract request ID if present
    const reqIdMatch = message.match(/\[REQ-([^\]]+)\]/);
    const requestId = reqIdMatch ? reqIdMatch[1] : 'unknown';
    
    // Extract method and endpoint
    const methodMatch = message.match(/(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)/);
    const method = methodMatch ? methodMatch[1] : 'UNKNOWN';
    const endpoint = methodMatch ? methodMatch[2] : 'unknown';
    
    // Extract provider
    let provider = 'unknown';
    if (message.includes('OpenAI')) provider = 'openai';
    else if (message.includes('Gemini')) provider = 'gemini';
    else if (message.includes('groq')) provider = 'groq';
    else if (message.includes('openrouter')) provider = 'openrouter';
    
    // Extract status code
    const statusMatch = message.match(/(\d{3})\s+/);
    const status = statusMatch ? parseInt(statusMatch[1]) : null;
    
    // Extract error information
    const error = message.includes('error') || message.includes('Error') || status >= 400 ? message : null;
    
    this.logApiRequest(requestId, method, endpoint, provider, status, null, error, null);
  }


  storeResponseData(testId, responseData) {
    // Store response data for viewing (keep last 100 responses)
    this.responseStorage.set(testId, responseData);
    if (this.responseStorage.size > 100) {
      const firstKey = this.responseStorage.keys().next().value;
      this.responseStorage.delete(firstKey);
    }
  }

  async handleGetResponse(res, path) {
    try {
      const testId = path.split('/').pop(); // Extract testId from path
      const responseData = this.responseStorage.get(testId);
      
      if (!responseData) {
        this.sendError(res, 404, 'Response not found');
        return;
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get response data');
    }
  }

  /**
   * Reorder keys for a provider
   * Body: { apiType: string, providerName: string, keys: string[] }
   */
  async handleReorderKeys(res, body) {
    try {
      const { apiType, providerName, keys } = JSON.parse(body);
      if (!apiType || !providerName || !Array.isArray(keys)) {
        this.sendError(res, 400, 'Missing apiType, providerName, or keys array');
        return;
      }

      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;

      // Preserve disabled state: build new key string with ~ prefix for disabled keys
      const currentValue = envVars[envKey] || '';
      const currentParsed = this.config.parseApiKeysWithState(currentValue);
      const disabledSet = new Set(currentParsed.allKeys.filter(k => k.disabled).map(k => k.key));

      const newKeysStr = keys.map(k => disabledSet.has(k) ? `~${k}` : k).join(',');
      envVars[envKey] = newKeysStr;

      // Write updated env
      this.writeEnvFile(envVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to reorder keys: ' + error.message);
    }
  }

  /**
   * Get key usage statistics for all providers (includes history status)
   */
  async handleGetKeyUsage(res) {
    try {
      const usage = {};

      // Get usage from provider clients
      for (const [providerName, client] of this.providerClients.entries()) {
        if (client.keyRotator) {
          usage[providerName] = client.keyRotator.getKeyUsageStats(providerName);
        }
      }

      // Legacy clients
      if (this.geminiClient && this.geminiClient.keyRotator && !usage['gemini']) {
        usage['gemini'] = this.geminiClient.keyRotator.getKeyUsageStats('gemini');
      }
      if (this.openaiClient && this.openaiClient.keyRotator && !usage['openai']) {
        usage['openai'] = this.openaiClient.keyRotator.getKeyUsageStats('openai');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(usage));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get key usage');
    }
  }

  /**
   * Get key rotation history for all providers or a specific one
   */
  async handleGetKeyHistory(res, providerName = null) {
    try {
      const history = providerName
        ? { [providerName]: this.historyManager.getProviderHistory(providerName) }
        : this.historyManager.getAllHistory();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get key history');
    }
  }

  /**
   * Reset key rotation history for a specific provider
   */
  async handleResetKeyHistory(res, providerName) {
    try {
      this.historyManager.resetProvider(providerName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to reset key history');
    }
  }

  /**
   * Toggle a key's disabled state
   * Body: { apiType: string, providerName: string, keyIndex: number, disabled: boolean }
   */
  async handleToggleKey(res, body) {
    try {
      const { apiType, providerName, keyIndex, disabled } = JSON.parse(body);
      if (!apiType || !providerName || keyIndex === undefined) {
        this.sendError(res, 400, 'Missing apiType, providerName, or keyIndex');
        return;
      }

      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
      const currentValue = envVars[envKey] || '';
      const parsed = this.config.parseApiKeysWithState(currentValue);

      if (keyIndex < 0 || keyIndex >= parsed.allKeys.length) {
        this.sendError(res, 400, 'Invalid key index');
        return;
      }

      parsed.allKeys[keyIndex].disabled = disabled;

      // Rebuild key string
      const newKeysStr = parsed.allKeys.map(k => k.disabled ? `~${k.key}` : k.key).join(',');
      envVars[envKey] = newKeysStr;

      this.writeEnvFile(envVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to toggle key: ' + error.message);
    }
  }

  /**
   * Toggle a provider's disabled state
   * Body: { apiType: string, providerName: string, disabled: boolean }
   */
  async handleToggleProvider(res, body) {
    try {
      const { apiType, providerName, disabled } = JSON.parse(body);
      if (!apiType || !providerName) {
        this.sendError(res, 400, 'Missing apiType or providerName');
        return;
      }

      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_DISABLED`;

      if (disabled) {
        envVars[envKey] = 'true';
      } else {
        delete envVars[envKey];
      }

      this.writeEnvFile(envVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to toggle provider: ' + error.message);
    }
  }

  async handleToggleSyncEnv(res, body) {
    try {
      const { apiType, providerName, enabled } = JSON.parse(body);
      if (!apiType || !providerName) {
        this.sendError(res, 400, 'Missing apiType or providerName');
        return;
      }

      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_SYNC_ENV`;

      if (enabled) {
        envVars[envKey] = 'true';
      } else {
        delete envVars[envKey];
      }

      this.writeEnvFile(envVars);
      this.config.loadConfig();
      this.reinitializeClients();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to toggle sync env: ' + error.message);
    }
  }

  async handleUpgradePassword(res) {
    try {
      const adminPassword = this.getAdminPassword();
      if (!adminPassword) {
        this.sendError(res, 400, 'No admin password configured');
        return;
      }

      const hash = Auth.isHash(adminPassword)
        ? adminPassword
        : Auth.hashPassword(adminPassword);

      Auth.saveHashToFile(hash);
      Auth.removePasswordFromEnv(path.join(process.cwd(), '.env'));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to upgrade password: ' + error.message);
    }
  }

  async handleChangePassword(res, body) {
    try {
      const { currentPassword, newPassword } = JSON.parse(body);
      if (!currentPassword || !newPassword) {
        this.sendError(res, 400, 'Missing currentPassword or newPassword');
        return;
      }

      if (newPassword.length < 6) {
        this.sendError(res, 400, 'New password must be at least 6 characters');
        return;
      }

      const adminPassword = this.getAdminPassword();
      if (!Auth.verifyPassword(currentPassword, adminPassword)) {
        this.sendError(res, 401, 'Current password is incorrect');
        return;
      }

      const hashed = Auth.hashPassword(newPassword);
      Auth.saveHashToFile(hashed);
      Auth.removePasswordFromEnv(path.join(process.cwd(), '.env'));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to change password: ' + error.message);
    }
  }

  async handleGetEnvFiles(res) {
    try {
      const data = this.config.getEnvFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get env files: ' + error.message);
    }
  }

  async handleAddEnvFile(res, body) {
    try {
      const { name, path: filePath } = JSON.parse(body);
      if (!name || !filePath) {
        this.sendError(res, 400, 'Missing name or path');
        return;
      }
      if (!fs.existsSync(filePath)) {
        this.sendError(res, 400, 'File does not exist: ' + filePath);
        return;
      }
      this.config.addEnvFile(name, filePath);
      const data = this.config.getEnvFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...data }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to add env file: ' + error.message);
    }
  }

  async handleRemoveEnvFile(res, body) {
    try {
      const { name } = JSON.parse(body);
      if (!name) {
        this.sendError(res, 400, 'Missing name');
        return;
      }
      this.config.removeEnvFile(name);
      const data = this.config.getEnvFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...data }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to remove env file: ' + error.message);
    }
  }

  async handleSwitchEnv(res, body) {
    try {
      const { name } = JSON.parse(body);
      if (!name) {
        this.sendError(res, 400, 'Missing env name');
        return;
      }
      this.config.setActiveEnv(name);
      this.reinitializeClients();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        providers: this.getProviderStats()
      }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to switch env: ' + error.message);
    }
  }

  getProviderStats() {
    const providers = [];
    for (const [name, config] of this.config.providers.entries()) {
      providers.push({
        name,
        apiType: config.apiType,
        keyCount: config.keys.length,
        baseUrl: config.baseUrl,
        disabled: config.disabled || false
      });
    }
    return providers;
  }

  async handleReorderEnvFiles(res, body) {
    try {
      const { names } = JSON.parse(body);
      if (!Array.isArray(names)) {
        this.sendError(res, 400, 'Missing names array');
        return;
      }
      this.config.reorderEnvFiles(names);
      const data = this.config.getEnvFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...data }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to reorder env files: ' + error.message);
    }
  }

  async handleGetRecoveryStatus(res) {
    try {
      if (!this.healthMonitor) {
        this.sendError(res, 503, 'Health monitor not initialized');
        return;
      }
      const recoveryStatus = {};
      const providers = this.config.providers;
      for (const [name, config] of providers.entries()) {
        if (config.disabled) continue;
        const allKeys = config.allKeys ? config.allKeys.map(k => k.key) : config.keys;
        const exhausted = this.historyManager.getExhaustedKeys(
          name,
          this.healthMonitor.recoveryCooldownMs,
          allKeys
        );
        if (exhausted.length > 0) {
          recoveryStatus[name] = exhausted.map(e => ({
            hash: e.hash,
            rotatedOutAt: e.rotatedOutAt,
            rotationReason: e.rotationReason,
            cooldownSec: Math.round(this.healthMonitor.recoveryCooldownMs / 1000)
          }));
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        enabled: this.healthMonitor.recoveryEnabled,
        cooldownSec: Math.round(this.healthMonitor.recoveryCooldownMs / 1000),
        providers: recoveryStatus
      }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get recovery status: ' + error.message);
    }
  }

  async handleGetHealth(res) {
    try {
      if (!this.healthMonitor) {
        this.sendError(res, 503, 'Health monitor not initialized');
        return;
      }
      const summary = this.healthMonitor.getSummary();
      const statuses = this.healthMonitor.getAllStatuses();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary, providers: statuses }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get health: ' + error.message);
    }
  }

  async handleHealthCheckAll(res) {
    try {
      if (!this.healthMonitor) {
        this.sendError(res, 503, 'Health monitor not initialized');
        return;
      }
      await this.healthMonitor.checkAll();
      const summary = this.healthMonitor.getSummary();
      const statuses = this.healthMonitor.getAllStatuses();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary, providers: statuses }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to check health: ' + error.message);
    }
  }

  async handleHealthReset(res, body) {
    try {
      const { provider } = JSON.parse(body || '{}');
      if (!provider) {
        this.sendError(res, 400, 'Missing provider name');
        return;
      }
      if (this.historyManager) {
        this.historyManager.resetProvider(provider);
      }
      // Refresh status
      if (this.healthMonitor) {
        this.healthMonitor.statusCache.delete(provider);
        this.healthMonitor.checkProvider(provider);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to reset provider: ' + error.message);
    }
  }

  async handleGetNotifications(res) {
    const envVars = this.config.envVars;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      slackWebhookUrl: envVars.SLACK_WEBHOOK_URL || '',
      slackNotifyOn: envVars.SLACK_NOTIFY_ON || '',
      telegramNotifyOn: envVars.TELEGRAM_NOTIFY_ON || ''
    }));
  }

  async handleUpdateNotifications(res, body) {
    try {
      const { slackWebhookUrl, slackNotifyOn, telegramNotifyOn } = JSON.parse(body);
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      if (slackWebhookUrl !== undefined) envVars.SLACK_WEBHOOK_URL = slackWebhookUrl;
      if (slackNotifyOn !== undefined) envVars.SLACK_NOTIFY_ON = slackNotifyOn;
      if (telegramNotifyOn !== undefined) envVars.TELEGRAM_NOTIFY_ON = telegramNotifyOn;

      this.writeEnvFile(envVars);
      this.config.loadConfig();

      if (this.notifier) {
        this.notifier.configure({
          slackWebhookUrl: this.config.envVars.SLACK_WEBHOOK_URL,
          slackNotifyOn: this.config.envVars.SLACK_NOTIFY_ON,
          telegramNotifyOn: this.config.envVars.TELEGRAM_NOTIFY_ON
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to update notifications: ' + error.message);
    }
  }

  async handleTestNotification(res, body) {
    try {
      const { channel } = JSON.parse(body || '{}');
      if (!this.notifier) {
        this.sendError(res, 503, 'Notifier not initialized');
        return;
      }
      const result = await this.notifier.testChannel(channel);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: result }));
    } catch (error) {
      this.sendError(res, 500, 'Test failed: ' + error.message);
    }
  }

  async handleGetAnalytics(res, params) {
    try {
      const range = params?.range || '7d';
      const data = this.analytics.query(range);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (error) {
      this.sendError(res, 500, 'Analytics query failed: ' + error.message);
    }
  }

  async handleResetAnalytics(res) {
    try {
      this.analytics.reset();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Reset failed: ' + error.message);
    }
  }

  async handleGetFallbacks(res) {
    try {
      const chains = this.fallbackRouter ? this.fallbackRouter.getAllChains() : {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(chains));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get fallbacks: ' + error.message);
    }
  }

  async handleSetFallback(res, body) {
    try {
      const { provider, fallbackProvider, fallbackModel } = JSON.parse(body || '{}');
      if (!provider || !fallbackProvider) {
        this.sendError(res, 400, 'provider and fallbackProvider required');
        return;
      }
      if (this.fallbackRouter) {
        this.fallbackRouter.setFallback(provider, fallbackProvider, fallbackModel || null);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to set fallback: ' + error.message);
    }
  }

  async handleGetCircuitBreaker(res) {
    try {
      const states = this.circuitBreaker.getAllStates();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(states));
    } catch (error) {
      this.sendError(res, 500, 'Failed to get circuit breaker states: ' + error.message);
    }
  }

  async handleCircuitBreakerAction(res, urlPath, body) {
    try {
      const parts = urlPath.split('/');
      const provider = parts[4];
      const action = parts[5];

      if (!provider || !action) {
        this.sendError(res, 400, 'Provider and action required');
        return;
      }

      if (action === 'force-close') {
        this.circuitBreaker.forceClose(provider);
      } else if (action === 'force-open') {
        this.circuitBreaker.forceOpen(provider);
      } else {
        this.sendError(res, 400, 'Unknown action: ' + action);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } catch (error) {
      this.sendError(res, 500, 'Circuit breaker action failed: ' + error.message);
    }
  }

  async handleExportConfig(res, body) {
    try {
      const { includeSecrets } = JSON.parse(body || '{}');
      const data = this.configExporter.exportConfig(!!includeSecrets);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data, null, 2));
    } catch (error) {
      this.sendError(res, 500, 'Export failed: ' + error.message);
    }
  }

  async handleImportConfig(res, body) {
    try {
      const { config: importData, mode } = JSON.parse(body || '{}');
      if (!importData) {
        this.sendError(res, 400, 'Config data required');
        return;
      }
      const result = this.configExporter.importConfig(importData, mode || 'merge');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      this.sendError(res, 500, 'Import failed: ' + error.message);
    }
  }

  async handleGetRpm(res) {
    try {
      const rpmData = this.rpmTracker.getAllRpm();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rpmData));
    } catch (error) {
      this.sendError(res, 500, 'RPM query failed: ' + error.message);
    }
  }

  async handleFsList(res, queryPath) {
    try {
      let targetPath = queryPath;
      if (!targetPath || targetPath === 'undefined') {
        targetPath = process.cwd();
      }

      // Basic safety: resolve the path
      targetPath = path.resolve(targetPath);

      if (!fs.existsSync(targetPath)) {
        this.sendError(res, 404, 'Path not found');
        return;
      }

      const stats = fs.statSync(targetPath);
      if (!stats.isDirectory()) {
        this.sendError(res, 400, 'Path is not a directory');
        return;
      }

      const items = fs.readdirSync(targetPath, { withFileTypes: true });
      const result = items.map(item => {
        const fullPath = path.join(targetPath, item.name);
        const isDir = item.isDirectory();
        let extra = { isDirectory: isDir };
        
        try {
          if (!isDir) {
            const s = fs.statSync(fullPath);
            extra.size = s.size;
            extra.mtime = s.mtime;
          }
        } catch (e) {}

        return {
          name: item.name,
          path: fullPath,
          ...extra
        };
      });

      // Sort: directories first, then files
      result.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        currentPath: targetPath,
        parentPath: path.dirname(targetPath),
        items: result
      }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to list directory: ' + error.message);
    }
  }

  async handleFsDrives(res) {
    try {
      const { exec } = require('child_process');
      if (process.platform === 'win32') {
        exec('wmic logicaldisk get name', (error, stdout) => {
          if (error) {
            this.sendError(res, 500, 'Failed to list drives');
            return;
          }
          const drives = stdout.split('\r\n')
            .map(line => line.trim())
            .filter(line => line && line !== 'Name' && /^[A-Z]:$/.test(line))
            .map(drive => ({ name: drive, path: drive + '\\' }));
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ drives }));
        });
      } else {
        // Simple root for Linux/Mac
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ drives: [{ name: '/', path: '/' }] }));
      }
    } catch (error) {
      this.sendError(res, 500, 'Failed to list drives: ' + error.message);
    }
  }

  sendError(res, code, message) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  writeEnvFile(envVars) {
    const envPath = path.join(process.cwd(), '.env');

    let envContent = '# API Key KeyProxyr Configuration\n';
    envContent += `# Last updated: ${new Date().toISOString()}\n\n`;

    const basicConfig = {};
    const providers = {};
    const otherConfig = {};

    Object.entries(envVars).forEach(([key, value]) => {
      if (key === 'BASE_URL' && (!value || value.trim() === '')) return;

      if (key === 'PORT' || key === 'ADMIN_PASSWORD') {
        basicConfig[key] = value;
      } else if (key.endsWith('_API_KEYS') || key.endsWith('_BASE_URL') || key.endsWith('_ACCESS_KEY') || key.endsWith('_DEFAULT_MODEL') || key.endsWith('_MODEL_HISTORY') || key.endsWith('_DISABLED')) {
        const match = key.match(/^(.+?)_(.+?)_(API_KEYS|BASE_URL|ACCESS_KEY|DEFAULT_MODEL|MODEL_HISTORY|DISABLED)$/);
        if (match) {
          const apiType = match[1];
          const provName = match[2];
          const keyType = match[3];
          const providerKey = `${apiType}_${provName}`;

          if (!providers[providerKey]) {
            providers[providerKey] = { apiType, providerName: provName, keys: '', baseUrl: '', accessKey: '', defaultModel: '', modelHistory: '', disabled: '' };
          }

          if (keyType === 'API_KEYS') providers[providerKey].keys = value;
          else if (keyType === 'BASE_URL') providers[providerKey].baseUrl = value;
          else if (keyType === 'ACCESS_KEY') providers[providerKey].accessKey = value;
          else if (keyType === 'DEFAULT_MODEL') providers[providerKey].defaultModel = value;
          else if (keyType === 'MODEL_HISTORY') providers[providerKey].modelHistory = value;
          else if (keyType === 'DISABLED') providers[providerKey].disabled = value;
        } else {
          otherConfig[key] = value;
        }
      } else {
        otherConfig[key] = value;
      }
    });

    if (Object.keys(basicConfig).length > 0) {
      envContent += '# Basic Configuration\n';
      for (const [key, value] of Object.entries(basicConfig)) {
        envContent += `${key}=${value}\n`;
      }
      envContent += '\n';
    }

    const writeProviders = (list, comment) => {
      if (list.length > 0) {
        envContent += `# ${comment}\n`;
        for (const p of list) {
          if (p.keys) envContent += `${p.apiType}_${p.providerName}_API_KEYS=${p.keys}\n`;
          if (p.baseUrl) envContent += `${p.apiType}_${p.providerName}_BASE_URL=${p.baseUrl}\n`;
          if (p.accessKey) envContent += `${p.apiType}_${p.providerName}_ACCESS_KEY=${p.accessKey}\n`;
          if (p.defaultModel) envContent += `${p.apiType}_${p.providerName}_DEFAULT_MODEL=${p.defaultModel}\n`;
          if (p.modelHistory) envContent += `${p.apiType}_${p.providerName}_MODEL_HISTORY=${p.modelHistory}\n`;
          if (p.disabled && p.disabled === 'true') envContent += `${p.apiType}_${p.providerName}_DISABLED=true\n`;
          envContent += '\n';
        }
      }
    };

    const allProviders = Object.values(providers).sort((a, b) => a.providerName.toLowerCase().localeCompare(b.providerName.toLowerCase()));
    writeProviders(allProviders.filter(p => p.apiType === 'OPENAI'), 'OpenAI Compatible Providers');
    writeProviders(allProviders.filter(p => p.apiType === 'GEMINI'), 'Gemini Providers');
    writeProviders(allProviders.filter(p => p.apiType !== 'OPENAI' && p.apiType !== 'GEMINI'), 'Other Providers');

    if (Object.keys(otherConfig).length > 0) {
      envContent += '# Additional Configuration\n';
      for (const [key, value] of Object.entries(otherConfig)) {
        envContent += `${key}=${value}\n`;
      }
    }

    fs.writeFileSync(envPath, envContent);
  }

  serveAdminPanel(res) {
    try {
      const htmlPath = path.join(process.cwd(), 'public', 'admin.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (error) {
      this.sendError(res, 500, 'Admin panel not found');
    }
  }

  /**
   * Reinitialize API clients with updated configuration
   * Called after environment variables are updated via admin panel
   */
  reinitializeClients() {
    console.log('[SERVER] Reinitializing API clients with updated configuration...');
    
    // Clear all provider clients
    this.providerClients.clear();
    
    // Reinitialize legacy clients for backward compatibility
    if (this.config.hasGeminiKeys()) {
      const geminiKeyRotator = new this.KeyRotator(this.config.getGeminiApiKeys(), 'gemini', null, this.historyManager);
      this.geminiClient = new this.GeminiClient(geminiKeyRotator, this.config.getGeminiBaseUrl(), 'gemini', this.config.getRetryConfig('gemini'));
      console.log('[SERVER] Legacy Gemini client reinitialized');
    } else {
      this.geminiClient = null;
      console.log('[SERVER] Legacy Gemini client disabled (no keys available)');
    }

    if (this.config.hasOpenaiKeys()) {
      const openaiKeyRotator = new this.KeyRotator(this.config.getOpenaiApiKeys(), 'openai', null, this.historyManager);
      this.openaiClient = new this.OpenAIClient(openaiKeyRotator, this.config.getOpenaiBaseUrl(), 'openai', this.config.getRetryConfig('openai'));
      console.log('[SERVER] Legacy OpenAI client reinitialized');
    } else {
      this.openaiClient = null;
      console.log('[SERVER] Legacy OpenAI client disabled (no keys available)');
    }
    
    console.log(`[SERVER] ${this.config.getProviders().size} providers available for dynamic initialization`);
  }

  async initTelegramBot() {
    try {
      const envPath = path.join(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) return;
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      const token = envVars.TELEGRAM_BOT_TOKEN;
      const allowedUsers = envVars.TELEGRAM_ALLOWED_USERS
        ? envVars.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      // Apply keep-alive setting
      const kaMinutes = envVars.KEEP_ALIVE_MINUTES ? parseInt(envVars.KEEP_ALIVE_MINUTES) : 10;
      this.telegramBot.setKeepAliveInterval(kaMinutes);

      if (token) {
        await this.telegramBot.start(token, allowedUsers);
      }
    } catch (err) {
      console.log(`[TELEGRAM] Init error: ${err.message}`);
    }
  }

  async handleGetTelegramSettings(res) {
    try {
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      const keepAliveRaw = envVars.KEEP_ALIVE_MINUTES;
      const keepAliveMinutes = keepAliveRaw != null ? parseInt(keepAliveRaw) : 10;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        botToken: envVars.TELEGRAM_BOT_TOKEN || '',
        allowedUsers: envVars.TELEGRAM_ALLOWED_USERS || '',
        defaultStatusCodes: envVars.DEFAULT_STATUS_CODES || '429',
        keepAliveMinutes,
        botRunning: this.telegramBot.polling
      }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to read telegram settings');
    }
  }

  async handleUpdateTelegramSettings(res, body) {
    try {
      const { botToken, allowedUsers, defaultStatusCodes, keepAliveMinutes } = JSON.parse(body);
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const envVars = this.config.parseEnvFile(envContent);

      if (botToken !== undefined) {
        if (botToken) {
          envVars.TELEGRAM_BOT_TOKEN = botToken;
        } else {
          delete envVars.TELEGRAM_BOT_TOKEN;
        }
      }
      if (allowedUsers !== undefined) {
        if (allowedUsers) {
          envVars.TELEGRAM_ALLOWED_USERS = allowedUsers;
        } else {
          delete envVars.TELEGRAM_ALLOWED_USERS;
        }
      }
      if (defaultStatusCodes !== undefined) {
        // Parse, deduplicate, sort numerically
        const codes = defaultStatusCodes
          .split(',')
          .map(s => s.trim())
          .filter(s => /^\d+$/.test(s))
          .map(Number)
          .filter((v, i, a) => a.indexOf(v) === i)
          .sort((a, b) => a - b);
        if (codes.length > 0) {
          envVars.DEFAULT_STATUS_CODES = codes.join(',');
        } else {
          delete envVars.DEFAULT_STATUS_CODES;
        }
      }
      if (keepAliveMinutes !== undefined) {
        const val = parseInt(keepAliveMinutes);
        if (val > 0) {
          envVars.KEEP_ALIVE_MINUTES = String(val);
        } else {
          delete envVars.KEEP_ALIVE_MINUTES;
        }
      }

      this.writeEnvFile(envVars);

      // Restart bot with new settings
      const token = envVars.TELEGRAM_BOT_TOKEN;
      const users = envVars.TELEGRAM_ALLOWED_USERS
        ? envVars.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean)
        : [];

      // Apply keep-alive setting
      const kaMinutes = envVars.KEEP_ALIVE_MINUTES ? parseInt(envVars.KEEP_ALIVE_MINUTES) : 0;
      this.telegramBot.setKeepAliveInterval(kaMinutes);

      if (token) {
        await this.telegramBot.start(token, users);
      } else {
        await this.telegramBot.stop();
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        botRunning: this.telegramBot.polling,
        defaultStatusCodes: envVars.DEFAULT_STATUS_CODES || '429',
        keepAliveMinutes: kaMinutes
      }));
    } catch (error) {
      this.sendError(res, 500, 'Failed to update telegram settings: ' + error.message);
    }
  }

  updateMetrics() {
    const providers = this.config.getProviders();
    this.metrics.setGauge('keyproxy_providers_total', {}, providers.size);

    for (const [name, config] of providers.entries()) {
      const totalKeys = config.allKeys ? config.allKeys.length : config.keys.length;
      const enabledKeys = config.keys.length;
      const disabledKeys = totalKeys - enabledKeys;
      const disabled = config.disabled || false;

      this.metrics.setGauge('keyproxy_keys_total', { provider: name, state: 'enabled' }, enabledKeys);
      this.metrics.setGauge('keyproxy_keys_total', { provider: name, state: 'disabled' }, disabledKeys);

      if (this.historyManager) {
        let exhausted = 0;
        let active = 0;
        for (const key of config.keys) {
          const status = this.historyManager.getKeyStatus(name, key);
          if (status.status === 'exhausted') exhausted++;
          else if (status.status === 'active') active++;
        }
        this.metrics.setGauge('keyproxy_keys_by_status', { provider: name, status: 'exhausted' }, exhausted);
        this.metrics.setGauge('keyproxy_keys_by_status', { provider: name, status: 'active' }, active);
      }

      this.metrics.setGauge('keyproxy_provider_enabled', { provider: name }, disabled ? 0 : 1);
    }
  }

  stop() {
    this.flushLogs(true); // Sync write before shutdown
    if (this.historyManager) this.historyManager.flushSync(); // Persist history before shutdown
    if (this.healthMonitor) this.healthMonitor.stop();
    if (this.telegramBot) this.telegramBot.stop();
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = ProxyServer;
