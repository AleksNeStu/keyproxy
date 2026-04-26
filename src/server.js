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
const ResponseCache = require('./core/cache');
const VirtualKeyManager = require('./core/virtualKeys');
const BudgetTracker = require('./core/budgetTracker');
const TelegramBot = require('./core/telegramBot');
const { refreshCsrfToken, getCsrfToken } = require('./middleware/csrf');
const { validateBody, limitBodySize } = require('./middleware/validation');
const { addSecurityHeaders, sanitizeInput, adminApiLimiter, adminReadLimiter, adminWriteLimiter, adminFileOpsLimiter, adminHighRiskLimiter } = require('./middleware/securityHeaders');
const globalMiddleware = require('./middleware/globalMiddleware');

// Route modules
const { sendError, sendResponse, readRequestBody, getStatusText } = require('./routes/httpHelpers');
const { isAdminAuthenticated, handleAdminLogin, handleAdminLogout, handleAuthCheck, handleChangePassword, handleUpgradePassword } = require('./routes/adminAuth');
const { handleGetEnvVars, handleGetEnvFile, handleUpdateEnvVars, handleUpdateSettings, handleReloadConfig, handleGetRetryConfig, handleUpdateRetryConfig, handleGetGeneralSettings, handleUpdateGeneralSettings, handleGetEnvFiles, handleAddEnvFile, handleRemoveEnvFile, handleSwitchEnv, handleReorderEnvFiles, handleToggleEnvFileDisabled, handleSelectEnv } = require('./routes/adminEnv');
const { handleToggleKey, handleReorderKeys, handleGetKeyUsage, handleGetKeyHistory, handleResetKeyHistory, handleTestKeyRecovery, handleGetRpm } = require('./routes/adminKeys');
const { handleToggleProvider, handleToggleSyncEnv, handleToggleGlobalSync, handleGetHealth, handleHealthCheckAll, handleHealthReset, handleGetRecoveryStatus, handleRecoveryScan, handleRecoveryProbe, handleTestApiKey, handleTestAllKeys, handleGetKeySources, handleGetSyncExclusive, handleToggleSyncExclusive } = require('./routes/adminProviders');
const { handleGetNotifications, handleUpdateNotifications, handleTestNotification, handleGetTelegramSettings, handleUpdateTelegramSettings } = require('./routes/adminNotifications');
const { handleGetStatus } = require('./routes/adminStatus');
const { handleGetAnalytics, handleResetAnalytics, handleGetFallbacks, handleSetFallback, handleGetCircuitBreaker, handleCircuitBreakerAction, handleGetCacheStats, handleClearCache, handleCacheConfig, handleListVirtualKeys, handleCreateVirtualKey, handleRevokeVirtualKey, handleToggleVirtualKey, handleGetBudgets, handleGetAvailableKeys, handleSetBudget, handleRemoveBudget, handleGetKeyExpiry, handleExtendKey, handleExportConfig, handleImportConfig, handleFsList, handleFsDrives, handleGetLbStrategy, handleSetLbStrategy, handleSetLbWeight } = require('./routes/adminAdvanced');
const { handleFetchModels, handleSaveModels } = require('./routes/adminModels');
const { handleGetExclusions, handleAddExclusion, handleRemoveExclusion, handleToggleExclusion, handleTestExclusion } = require('./routes/adminExclusions');
const { handleGetEnvSources, handleAddEnvSource, handleRemoveEnvSource, handlePreviewEnvSource, handlePullEnvSource } = require('./routes/adminEnvSources');
const { handleGetAgentContext } = require('./routes/adminMcp');
const KeyExclusionManager = require('./core/exclusions');
const AgentContextGenerator = require('./core/mcpInstructions');
const destinationManager = require('./destinations/manager');
const { parseRoute, handleProxyRequest } = require('./routes/proxy');

class ProxyServer {
  constructor(config, geminiClient = null, openaiClient = null) {
    this.config = config;
    this.geminiClient = geminiClient;
    this.openaiClient = openaiClient;
    this.providerClients = new Map(); // Map of provider_name -> client instance
    this.server = null;
    this.adminSessionToken = null;
    this.csrfToken = null; // CSRF token for authenticated session
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
    this._metricsCleanupTimer = setInterval(() => this.metrics.cleanup(), 300000); // every 5 min

    // Response cache
    const cacheEnabled = config.envVars?.KEYPROXY_CACHE_ENABLED !== 'false';
    const cacheTtl = parseInt(config.envVars?.KEYPROXY_CACHE_TTL_SEC) || 300;
    const cacheMax = parseInt(config.envVars?.KEYPROXY_CACHE_MAX_ENTRIES) || 1000;
    this.responseCache = new ResponseCache(cacheMax, cacheTtl * 1000);
    this.responseCache.enabled = cacheEnabled;

    // Virtual API key manager
    this.virtualKeyManager = new VirtualKeyManager();

    // Budget tracker
    this.budgetTracker = new BudgetTracker();

    // Telegram bot (started after server.listen in start())
    this.telegramBot = new TelegramBot(this);

    // Key exclusion manager (destination sync filtering)
    this.exclusionManager = new KeyExclusionManager();
    destinationManager.setExclusionManager(this.exclusionManager);
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

      // Startup auto-check keys if enabled
      if (this.config.envVars.KEYPROXY_AUTO_CHECK_KEYS === 'true') {
        this.runStartupKeyCheck().catch(err => console.log('[STARTUP] Key check failed:', err.message));
      }
    });

    this.server.on('error', (error) => {
      console.error('Server error:', error);
    });
  }

  async handleRequest(req, res) {
    // Sanitize input (remove null bytes, excessive whitespace)
    sanitizeInput(req, res, () => {});

    // Serve static files from public directory
    if (req.url === '/tailwind-3.4.17.js' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const filePath = path.join(process.cwd(), 'public', 'tailwind-3.4.17.js');
        console.log(`[STATIC] Serving file from: ${filePath}`);

        if (req.method === 'HEAD') {
          const stats = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end();
        } else {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': Buffer.byteLength(fileContent),
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end(fileContent);
        }
        console.log(`[STATIC] Successfully served: ${req.url}`);
      } catch (error) {
        console.log(`[STATIC] Error serving file: ${error.message}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
    }

    // Serve Chart.js locally
    if (req.url === '/chart.min.js' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const filePath = path.join(process.cwd(), 'public', 'chart.min.js');
        console.log(`[STATIC] Serving file from: ${filePath}`);

        if (req.method === 'HEAD') {
          const stats = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end();
        } else {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': Buffer.byteLength(fileContent),
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end(fileContent);
        }
        console.log(`[STATIC] Successfully served: ${req.url}`);
      } catch (error) {
        console.log(`[STATIC] Error serving file: ${error.message}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
    }

    // Handle preflight OPTIONS requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const body = await readRequestBody(req);

    // Serve static files from public directory
    if (req.url === '/tailwind-3.4.17.js' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const filePath = path.join(process.cwd(), 'public', 'tailwind-3.4.17.js');
        console.log(`[STATIC] Serving file from: ${filePath}`);

        if (req.method === 'HEAD') {
          const stats = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end();
        } else {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': Buffer.byteLength(fileContent),
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end(fileContent);
        }
        console.log(`[STATIC] Successfully served: ${req.url}`);
      } catch (error) {
        console.log(`[STATIC] Error serving file: ${error.message}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
    }

    // Serve Chart.js locally
    if (req.url === '/chart.min.js' && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const filePath = path.join(process.cwd(), 'public', 'chart.min.js');
        console.log(`[STATIC] Serving file from: ${filePath}`);

        if (req.method === 'HEAD') {
          const stats = fs.statSync(filePath);
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end();
        } else {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript',
            'Content-Length': Buffer.byteLength(fileContent),
            'Cache-Control': 'public, max-age=31536000'
          });
          res.end(fileContent);
        }
        console.log(`[STATIC] Successfully served: ${req.url}`);
      } catch (error) {
        console.log(`[STATIC] Error serving file: ${error.message}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
    }

    // Serve MCP intercept module
    if (req.url.startsWith('/inject/') && req.method === 'GET') {
      try {
        const fileName = req.url.replace('/inject/', '').replace(/\.\./g, '');
        const filePath = path.join(process.cwd(), 'src', 'inject', fileName);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Length': Buffer.byteLength(content),
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff'
          });
          res.end(content);
          return;
        }
      } catch (e) {
        console.log(`[INJECT] Error serving file: ${e.message}`);
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    // Serve admin panel (BEFORE handleAdminRequest)
    if ((req.url === '/admin' || req.url === '/admin.html') && req.method === 'GET') {
      try {
        const htmlPath = path.join(process.cwd(), 'public', 'admin.html');

        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(htmlContent),
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';",
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'SAMEORIGIN'
        });
        res.end(htmlContent);
        console.log(`[ADMIN] Successfully served admin panel`);
      } catch (error) {
        console.log(`[ADMIN] Error serving admin panel: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading admin panel');
      }
      return;
    }

    // Serve test page for debugging
    if (req.url === '/test' || req.url === '/test-simple.html') {
      try {
        const htmlPath = path.join(process.cwd(), 'public', 'test-simple.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(htmlContent)
        });
        res.end(htmlContent);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading test page');
      }
      return;
    }

    // Serve minimal admin page (no Tailwind/Chart.js - for debugging)
    if (req.url === '/admin-minimal.html') {
      try {
        const htmlPath = path.join(process.cwd(), 'public', 'admin-minimal.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(htmlContent),
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(htmlContent);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error loading minimal admin page');
      }
      return;
    }

    // Serve test login page
    if (req.url === '/test-login' || req.url === '/test-login.html') {
      try {
        const filePath = path.join(process.cwd(), 'public', 'test-login.html');
        const fileContent = fs.readFileSync(filePath, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Content-Length': Buffer.byteLength(fileContent)
        });
        res.end(fileContent);
      } catch (error) {
        console.log(`[STATIC] Error serving test-login.html: ${error.message}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      }
      return;
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

    // Check if this is a valid API route before proxying
    const routeInfo = parseRoute(this, req.url);
    if (!routeInfo) {
      sendError(res, 400, 'Invalid API path. Use /{provider}/* format');
      return;
    }

    // Delegate to proxy handler
    await handleProxyRequest(this, req, res, body);
  }

  async handleAdminRequest(req, res, body) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const adminPath = parsedUrl.pathname;
    const params = Object.fromEntries(parsedUrl.searchParams);

    // Check if admin password is configured
    const adminPassword = this.getAdminPassword();
    if (!adminPassword) {
      sendError(res, 503, 'Admin panel not configured');
      return;
    }

    // Apply rate limiting to admin API with endpoint categorization
    if (adminPath.startsWith('/admin/api/') && adminPath !== '/admin/api/login-status') {
      // Determine which limiter to use based on endpoint and method
      const isReadOperation = req.method === 'GET';
      const isFileOperation = adminPath.includes('/fs-') ||
                              adminPath.includes('/export-config') ||
                              adminPath.includes('/import-config');
      const isHighRiskOperation = adminPath.includes('/reload') ||
                                  adminPath.includes('/import-config');

      let selectedLimiter;
      if (isHighRiskOperation && !isReadOperation) {
        selectedLimiter = adminHighRiskLimiter;
      } else if (isFileOperation && !isReadOperation) {
        selectedLimiter = adminFileOpsLimiter;
      } else if (!isReadOperation) {
        selectedLimiter = adminWriteLimiter;
      } else {
        selectedLimiter = adminReadLimiter;
      }

      // Apply selected rate limiter
      const rateLimitResult = await new Promise((resolve) => {
        selectedLimiter(req, res, () => resolve({ allowed: true }));
      });

      if (res.writableEnded) return; // Rate limit rejected the request
    }

    // Apply body size limiting for POST/PUT/PATCH requests
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && adminPath.startsWith('/admin/api/')) {
      const sizeLimitResult = await new Promise((resolve) => {
        limitBodySize(1024 * 1024)(req, res, () => resolve({ allowed: true }));
      });
      if (res.writableEnded) return; // Size limit rejected the request
    }

    // Serve main admin page
    if (adminPath === '/admin' || adminPath === '/admin/') {
      this.serveAdminPanel(res);
      return;
    }

    // Check authentication status
    if (adminPath === '/admin/api/auth' && req.method === 'GET') {
      return handleAuthCheck(this, req, res);
    }

    // CSRF token endpoint (authenticated)
    if (adminPath === '/admin/api/csrf-token' && req.method === 'GET') {
      if (!isAdminAuthenticated(this, req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const currentToken = getCsrfToken(this);
      if (!currentToken) {
        // Generate new token if none exists
        const newToken = refreshCsrfToken(this);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ csrfToken: newToken }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ csrfToken: currentToken }));
      }
      return;
    }

    // Check login rate limit status
    if (adminPath === '/admin/api/login-status' && req.method === 'GET') {
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
    if (adminPath === '/admin/login' && req.method === 'POST') {
      return handleAdminLogin(this, req, res, body);
    }

    // Handle logout
    if (adminPath === '/admin/logout' && req.method === 'POST') {
      return handleAdminLogout(this, req, res);
    }

    // All other admin routes require authentication
    if (!isAdminAuthenticated(this, req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // CSRF validation for state-changing operations (POST/PUT/DELETE/PATCH)
    const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (stateChangingMethods.includes(req.method)) {
      const headerToken = req.headers['x-csrf-token'] || req.headers['X-CSRF-Token'];
      const sessionToken = this.csrfToken;

      if (!sessionToken || !headerToken) {
        console.log(`[SECURITY] CSRF token missing for ${req.method} ${adminPath}`);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid CSRF token' }));
        return;
      }

      // Validate token using timing-safe comparison
      try {
        const sessionBuffer = Buffer.from(sessionToken, 'hex');
        const headerBuffer = Buffer.from(headerToken, 'hex');

        if (sessionToken.length !== 64 || headerToken.length !== 64 ||
            !crypto.timingSafeEqual(sessionBuffer, headerBuffer)) {
          console.log(`[SECURITY] CSRF validation failed for ${req.method} ${adminPath}`);
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid CSRF token' }));
          return;
        }
      } catch (error) {
        console.log(`[SECURITY] CSRF validation error for ${req.method} ${adminPath}:`, error.message);
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid CSRF token' }));
        return;
      }

      // Token is valid - rotate it after successful validation
      this.csrfToken = refreshCsrfToken(this);
    }

    // ─── Admin API routes ───────────────────────────────────────

    if (adminPath === '/admin/api/env' && req.method === 'GET') {
      return handleGetEnvVars(this, res);
    }
    if (adminPath === '/admin/api/env-file' && req.method === 'GET') {
      return handleGetEnvFile(this, res);
    }
    if (adminPath === '/admin/api/env' && req.method === 'POST') {
      return handleUpdateEnvVars(this, req, res, body);
    }
    if (adminPath === '/admin/api/test' && req.method === 'POST') {
      return handleTestApiKey(this, req, res, body);
    }
    if (adminPath === '/admin/api/test-all-keys' && req.method === 'POST') {
      return handleTestAllKeys(this, req, res);
    }
    if (adminPath === '/admin/api/key-sources' && req.method === 'GET') {
      return handleGetKeySources(this, res);
    }
    if (adminPath === '/admin/api/logs' && req.method === 'GET') {
      return this.handleGetLogs(res);
    }
    if (adminPath.startsWith('/admin/api/response/') && req.method === 'GET') {
      return this.handleGetResponse(res, adminPath);
    }
    if (adminPath === '/admin/api/reorder-keys' && req.method === 'POST') {
      return handleReorderKeys(this, req, res, body);
    }
    if (adminPath === '/admin/api/key-usage' && req.method === 'GET') {
      return handleGetKeyUsage(this, res);
    }
    if (adminPath === '/admin/api/key-history' && req.method === 'GET') {
      return handleGetKeyHistory(this, res);
    }
    if (adminPath.startsWith('/admin/api/key-history/') && req.method === 'GET') {
      return handleGetKeyHistory(this, res, adminPath.split('/').pop());
    }
    if (adminPath.startsWith('/admin/api/key-history/reset/') && req.method === 'POST') {
      return handleResetKeyHistory(this, req, res, adminPath.split('/').pop());
    }
    if (adminPath === '/admin/api/key-test' && req.method === 'POST') {
      return handleTestKeyRecovery(this, req, res, body);
    }
    if (adminPath === '/admin/api/toggle-key' && req.method === 'POST') {
      return handleToggleKey(this, req, res, body);
    }
    if (adminPath === '/admin/api/toggle-provider' && req.method === 'POST') {
      return handleToggleProvider(this, req, res, body);
    }
    if (adminPath === '/admin/api/toggle-sync-env' && req.method === 'POST') {
      return handleToggleSyncEnv(this, req, res, body);
    }
    if (adminPath === '/admin/api/toggle-global-sync' && req.method === 'POST') {
      return handleToggleGlobalSync(this, req, res, body);
    }
    if (adminPath === '/admin/api/sync-exclusive' && req.method === 'GET') {
      return handleGetSyncExclusive(this, res);
    }
    if (adminPath === '/admin/api/sync-exclusive' && req.method === 'POST') {
      return handleToggleSyncExclusive(this, req, res, body);
    }
    if (adminPath === '/admin/api/upgrade-password' && req.method === 'POST') {
      return handleUpgradePassword(this, req, res);
    }
    if (adminPath === '/admin/api/change-password' && req.method === 'POST') {
      return handleChangePassword(this, req, res, body);
    }
    if (adminPath === '/admin/api/telegram' && req.method === 'GET') {
      return handleGetTelegramSettings(this, res);
    }
    if (adminPath === '/admin/api/telegram' && req.method === 'POST') {
      return handleUpdateTelegramSettings(this, req, res, body);
    }
    if (adminPath === '/admin/api/reload' && req.method === 'POST') {
      return handleReloadConfig(this, req, res);
    }
    if (adminPath === '/admin/api/retry-config' && req.method === 'GET') {
      return handleGetRetryConfig(this, res);
    }
    if (adminPath === '/admin/api/retry-config' && req.method === 'POST') {
      return handleUpdateRetryConfig(this, req, res, body);
    }
    if (adminPath === '/admin/api/settings' && req.method === 'POST') {
      return handleUpdateSettings(this, req, res, body);
    }
    if (adminPath === '/admin/api/general-settings' && req.method === 'GET') {
      return handleGetGeneralSettings(this, res);
    }
    if (adminPath === '/admin/api/general-settings' && req.method === 'POST') {
      return handleUpdateGeneralSettings(this, req, res, body);
    }
    if (adminPath === '/admin/api/env-files' && req.method === 'GET') {
      return handleGetEnvFiles(this, res);
    }
    if (adminPath === '/admin/api/env-files' && req.method === 'POST') {
      return handleAddEnvFile(this, req, res, body);
    }
    if (adminPath === '/admin/api/env-files' && req.method === 'DELETE') {
      return handleRemoveEnvFile(this, req, res, body);
    }
    if (adminPath === '/admin/api/switch-env' && req.method === 'POST') {
      return handleSwitchEnv(this, req, res, body);
    }
    if (adminPath === '/admin/api/reorder-env-files' && req.method === 'POST') {
      return handleReorderEnvFiles(this, req, res, body);
    }
    if (adminPath === '/admin/api/toggle-env-file-disabled' && req.method === 'POST') {
      return handleToggleEnvFileDisabled(this, req, res, body);
    }
    // Environment Sources (manual import)
    if (adminPath === '/admin/api/env-sources/preview' && req.method === 'POST') {
      return handlePreviewEnvSource(this, req, res, body);
    }
    if (adminPath === '/admin/api/env-sources/pull' && req.method === 'POST') {
      return handlePullEnvSource(this, req, res, body);
    }
    if (adminPath === '/admin/api/env-sources' && req.method === 'GET') {
      return handleGetEnvSources(this, res);
    }
    if (adminPath === '/admin/api/env-sources' && req.method === 'POST') {
      return handleAddEnvSource(this, req, res, body);
    }
    if (adminPath === '/admin/api/env-sources' && req.method === 'DELETE') {
      return handleRemoveEnvSource(this, req, res, body);
    }
    if (adminPath === '/admin/api/recovery-status' && req.method === 'GET') {
      return handleGetRecoveryStatus(this, res);
    }
    if (adminPath === '/admin/api/recovery/scan' && req.method === 'POST') {
      return handleRecoveryScan(this, req, res);
    }
    if (adminPath.startsWith('/admin/api/recovery/probe/') && req.method === 'POST') {
      return handleRecoveryProbe(this, req, res, adminPath);
    }
    if (adminPath === '/admin/api/health' && req.method === 'GET') {
      return handleGetHealth(this, res);
    }
    if (adminPath === '/admin/api/health/check-all' && req.method === 'POST') {
      return handleHealthCheckAll(this, req, res);
    }
    if (adminPath === '/admin/api/health/reset' && req.method === 'POST') {
      return handleHealthReset(this, req, res, body);
    }
    if (adminPath === '/admin/api/notifications' && req.method === 'GET') {
      return handleGetNotifications(this, res);
    }
    if (adminPath === '/admin/api/notifications' && req.method === 'POST') {
      return handleUpdateNotifications(this, req, res, body);
    }
    if (adminPath === '/admin/api/notifications/test' && req.method === 'POST') {
      return handleTestNotification(this, req, res, body);
    }
    if (adminPath === '/admin/api/analytics' && req.method === 'GET') {
      return handleGetAnalytics(this, res, params);
    }
    if (adminPath === '/admin/api/analytics/reset' && req.method === 'POST') {
      return handleResetAnalytics(this, req, res);
    }
    if (adminPath === '/admin/api/fallbacks' && req.method === 'GET') {
      return handleGetFallbacks(this, res);
    }
    if (adminPath === '/admin/api/fallbacks' && req.method === 'POST') {
      return handleSetFallback(this, req, res, body);
    }
    if (adminPath === '/admin/api/circuit-breaker' && req.method === 'GET') {
      return handleGetCircuitBreaker(this, res);
    }
    if (adminPath.startsWith('/admin/api/circuit-breaker/') && req.method === 'POST') {
      return handleCircuitBreakerAction(this, req, res, adminPath, body);
    }
    if (adminPath === '/admin/api/export-config' && req.method === 'POST') {
      return handleExportConfig(this, req, res, body);
    }
    if (adminPath === '/admin/api/import-config' && req.method === 'POST') {
      return handleImportConfig(this, req, res, body);
    }
    // Unified status endpoint (combines RPM, key expiry, health)
    if (adminPath === '/admin/api/status' && req.method === 'GET') {
      return handleGetStatus(this, res, params);
    }
    if (adminPath === '/admin/api/rpm' && req.method === 'GET') {
      return handleGetRpm(this, res);
    }
    if (adminPath === '/admin/api/cache' && req.method === 'GET') {
      return handleGetCacheStats(this, res);
    }
    if (adminPath === '/admin/api/cache' && req.method === 'DELETE') {
      return handleClearCache(this, req, res);
    }
    if (adminPath === '/admin/api/cache/config' && req.method === 'POST') {
      return handleCacheConfig(this, req, res, body);
    }
    if (adminPath === '/admin/api/virtual-keys' && req.method === 'GET') {
      return handleListVirtualKeys(this, res);
    }
    if (adminPath === '/admin/api/virtual-keys' && req.method === 'POST') {
      return handleCreateVirtualKey(this, req, res, body);
    }
    if (adminPath.startsWith('/admin/api/virtual-keys/') && req.method === 'DELETE') {
      return handleRevokeVirtualKey(this, req, res, adminPath);
    }
    if (adminPath.startsWith('/admin/api/virtual-keys/') && req.method === 'POST') {
      return handleToggleVirtualKey(this, req, res, adminPath);
    }
    if (adminPath === '/admin/api/budgets' && req.method === 'GET') {
      return handleGetBudgets(this, res);
    }
    if (adminPath === '/admin/api/budgets/available-keys' && req.method === 'GET') {
      return handleGetAvailableKeys(this, res);
    }
    if (adminPath.startsWith('/admin/api/budgets/') && req.method === 'DELETE') {
      return handleRemoveBudget(this, req, res, adminPath);
    }
    if (adminPath === '/admin/api/budgets' && req.method === 'POST') {
      return handleSetBudget(this, req, res, body);
    }
    if (adminPath === '/admin/api/key-expiry' && req.method === 'GET') {
      return handleGetKeyExpiry(this, res, params);
    }
    if (adminPath === '/admin/api/key-extend' && req.method === 'POST') {
      return handleExtendKey(this, req, res, body);
    }
    if (adminPath === '/admin/api/select-env' && (req.method === 'GET' || req.method === 'POST')) {
      return handleSelectEnv(this, req, res);
    }
    if (adminPath === '/admin/api/fs-list' && req.method === 'GET') {
      return handleFsList(this, res, params.path);
    }
    if (adminPath === '/admin/api/fs-drives' && req.method === 'GET') {
      return handleFsDrives(this, res);
    }
    if (adminPath === '/admin/api/lb-strategy' && req.method === 'GET') {
      return handleGetLbStrategy(this, res);
    }
    if (adminPath === '/admin/api/lb-strategy' && req.method === 'POST') {
      return handleSetLbStrategy(this, req, res, body);
    }
    if (adminPath === '/admin/api/lb-weight' && req.method === 'POST') {
      return handleSetLbWeight(this, req, res, body);
    }
    if (adminPath === '/admin/api/models' && req.method === 'GET') {
      return handleFetchModels(this, req, res);
    }
    if (adminPath === '/admin/api/models' && req.method === 'POST') {
      return handleSaveModels(this, req, res, body);
    }

    // Exclusion pattern management
    if (adminPath === '/admin/api/exclusions' && req.method === 'GET') {
      return handleGetExclusions(this, res);
    }
    if (adminPath === '/admin/api/exclusions' && req.method === 'POST') {
      return handleAddExclusion(this, req, res, body);
    }
    if (adminPath === '/admin/api/exclusions' && req.method === 'DELETE') {
      return handleRemoveExclusion(this, req, res, body);
    }
    if (adminPath === '/admin/api/exclusions/toggle' && req.method === 'POST') {
      return handleToggleExclusion(this, req, res, body);
    }
    if (adminPath === '/admin/api/exclusions/test' && req.method === 'POST') {
      return handleTestExclusion(this, req, res, body);
    }

    // Agent Configuration Context
    if (adminPath === '/admin/api/agent-context' && req.method === 'GET') {
      return handleGetAgentContext(this, res, params);
    }

    sendError(res, 404, 'Not found');
  }

  // ─── Server-owned methods (state management, logging, etc.) ────

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

  async handleGetLogs(res) {
    try {
      // Return logs from memory buffer only (last 100 entries)
      const recentLogs = this.logBuffer.slice(-100).map(log => {
        // Handle both old string format and new object format
        if (typeof log === 'string') {
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
              message: match[2]
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
        format: 'json'
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

  async handleGetResponse(res, urlPath) {
    try {
      const testId = urlPath.split('/').pop();
      const responseData = this.responseStorage.get(testId);

      if (!responseData) {
        sendError(res, 404, 'Response not found');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
    } catch (error) {
      sendError(res, 500, 'Failed to get response data');
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

    // Enhanced console logging with key information
    let consoleMsg = `[${new Date().toISOString().substring(11, 23)}] [${requestId}] ${method} /${provider}${endpoint}`;
    
    if (status) {
      const statusColor = status < 400 ? '✓' : '✗';
      consoleMsg += ` ${statusColor} ${status}`;
    }
    
    if (responseTime) {
      consoleMsg += ` ${responseTime}ms`;
    }
    
    // Show key information prominently
    if (keyInfo) {
      if (keyInfo.keyUsed) {
        consoleMsg += ` key:${keyInfo.keyUsed}`;
      }
      if (keyInfo.failedKeys && keyInfo.failedKeys.length > 0) {
        const failedSummary = keyInfo.failedKeys.map(fk => `${fk.key}(${fk.status || 'err'})`).join(', ');
        consoleMsg += ` FAILED:[${failedSummary}]`;
      }
    }
    
    if (error) {
      consoleMsg += ` ERROR: ${error}`;
    }
    
    console.log(consoleMsg);

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

  storeResponseData(testId, responseData) {
    // Store response data for viewing (keep last 100 responses)
    this.responseStorage.set(testId, responseData);
    if (this.responseStorage.size > 100) {
      const firstKey = this.responseStorage.keys().next().value;
      this.responseStorage.delete(firstKey);
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
      statusText: getStatusText(response.statusCode),
      contentType: contentType,
      responseData: response.data,
      requestBody: requestBody
    });

    // Log basic response info to console only
    const responseMsg = `[REQ-${requestId}] Response: ${response.statusCode} ${getStatusText(response.statusCode)}`;
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

  writeEnvFile(envVars) {
    const envPath = path.join(process.cwd(), '.env');

    let envContent = '# API Key KeyProxy Configuration\n';
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
      sendError(res, 500, 'Admin panel not found');
    }
  }

  /**
   * Reinitialize API clients with updated configuration.
   * Called after environment variables are updated via admin panel.
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

  /**
   * Test all keys on startup and record verified/failed in keyHistory.
   * Fire-and-forget (non-blocking).
   */
  async runStartupKeyCheck() {
    const providers = this.config.getProviders();
    let verified = 0;
    let failed = 0;
    let total = 0;

    console.log('[STARTUP] Auto-checking all API keys...');

    for (const [providerName, config] of providers.entries()) {
      for (const key of config.keys) {
        total++;
        try {
          const { testGeminiKey, testOpenaiKey } = require('./routes/adminProviders');
          const mcpProviders = ['brave', 'tavily', 'exa', 'firecrawl', 'context7', 'jina', 'searchapi', 'onref'];
          let result;

          const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => resolve({ success: false, error: 'Timeout' }), 5000);
          });

          let testPromise;
          if (mcpProviders.includes(config.apiType.toLowerCase())) {
            testPromise = Promise.resolve({ success: true });
          } else if (config.apiType === 'gemini') {
            testPromise = testGeminiKey(this, key, config.baseUrl);
          } else if (config.apiType === 'openai') {
            testPromise = testOpenaiKey(this, key, config.baseUrl);
          } else {
            testPromise = Promise.resolve({ success: false, error: 'Unknown type' });
          }

          result = await Promise.race([testPromise, timeoutPromise]);

          if (result.success) {
            this.historyManager.recordKeyVerified(providerName, key);
            verified++;
          } else {
            this.historyManager.recordKeyFailed(providerName, key, result.error);
            failed++;
          }
        } catch (err) {
          this.historyManager.recordKeyFailed(providerName, key, err.message);
          failed++;
        }
      }
    }

    console.log(`[STARTUP] Key check complete: ${verified}/${total} verified, ${failed} failed`);
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
