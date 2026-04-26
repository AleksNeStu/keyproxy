/**
 * Admin provider management route handlers.
 * Toggle provider, toggle sync env, health, API key testing, recovery status.
 */

const fs = require('fs');
const path = require('path');
const { sendError } = require('./httpHelpers');

/**
 * POST /admin/api/toggle-provider — toggle a provider's disabled state.
 * Body: { apiType, providerName, disabled }
 */
async function handleToggleProvider(server, req, res, body) {
  try {
    const { apiType, providerName, disabled } = JSON.parse(body);
    if (!apiType || !providerName) {
      sendError(res, 400, 'Missing apiType or providerName');
      return;
    }

    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_DISABLED`;

    if (disabled) {
      envVars[envKey] = 'true';
    } else {
      delete envVars[envKey];
    }

    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to toggle provider: ' + error.message);
  }
}

/**
 * POST /admin/api/toggle-sync-env — toggle sync-to-os-env for a provider.
 * Body: { apiType, providerName, enabled }
 * Writes to OS environment variables (setx on Windows), NOT to .env file.
 */
async function handleToggleSyncEnv(server, req, res, body) {
  try {
    const { apiType, providerName, enabled } = JSON.parse(body);
    if (!apiType || !providerName) {
      sendError(res, 400, 'Missing apiType or providerName');
      return;
    }

    const WindowsEnv = require('../destinations/windowsEnv');
    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_SYNC_ENV`;

    if (enabled) {
      await WindowsEnv.setEnvVar(envKey, 'true');
    } else {
      await WindowsEnv.setEnvVar(envKey, 'false');
    }

    // Update in-memory config so the change takes effect immediately
    server.config.envVars[envKey] = enabled ? 'true' : 'false';
    server.reinitializeClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, provider: providerName, syncEnabled: enabled }));
  } catch (error) {
    sendError(res, 500, 'Failed to toggle sync env: ' + error.message);
  }
}

/**
 * POST /admin/api/toggle-global-sync — toggle global SYNC_TO_OS_ENV.
 * Body: { enabled }
 * Writes to OS environment variables, NOT to .env file.
 */
async function handleToggleGlobalSync(server, req, res, body) {
  try {
    const { enabled } = JSON.parse(body);
    const WindowsEnv = require('../destinations/windowsEnv');

    if (enabled) {
      await WindowsEnv.setEnvVar('SYNC_TO_OS_ENV', 'true');
    } else {
      await WindowsEnv.setEnvVar('SYNC_TO_OS_ENV', 'false');
    }

    server.config.envVars['SYNC_TO_OS_ENV'] = enabled ? 'true' : 'false';
    server.reinitializeClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, globalSyncEnabled: enabled }));
  } catch (error) {
    sendError(res, 500, 'Failed to toggle global sync: ' + error.message);
  }
}

/**
 * GET /admin/api/health — get health summary.
 */
async function handleGetHealth(server, res) {
  try {
    if (!server.healthMonitor) {
      sendError(res, 503, 'Health monitor not initialized');
      return;
    }
    const summary = server.healthMonitor.getSummary();
    const statuses = server.healthMonitor.getAllStatuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ summary, providers: statuses }));
  } catch (error) {
    sendError(res, 500, 'Failed to get health: ' + error.message);
  }
}

/**
 * POST /admin/api/health/check-all — trigger health check for all providers.
 */
async function handleHealthCheckAll(server, req, res) {
  try {
    if (!server.healthMonitor) {
      sendError(res, 503, 'Health monitor not initialized');
      return;
    }
    await server.healthMonitor.checkAll();
    const summary = server.healthMonitor.getSummary();
    const statuses = server.healthMonitor.getAllStatuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ summary, providers: statuses }));
  } catch (error) {
    sendError(res, 500, 'Failed to check health: ' + error.message);
  }
}

/**
 * POST /admin/api/health/reset — reset health history for a provider.
 * Body: { provider }
 */
async function handleHealthReset(server, req, res, body) {
  try {
    const { provider } = JSON.parse(body || '{}');
    if (!provider) {
      sendError(res, 400, 'Missing provider name');
      return;
    }
    if (server.historyManager) {
      server.historyManager.resetProvider(provider);
    }
    // Refresh status
    if (server.healthMonitor) {
      server.healthMonitor.statusCache.delete(provider);
      server.healthMonitor.checkProvider(provider);
    }
    // Reset circuit breaker for this provider
    if (server.circuitBreaker) {
      server.circuitBreaker.forceClose(provider);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to reset provider: ' + error.message);
  }
}

/**
 * GET /admin/api/recovery-status — get key recovery status.
 */
async function handleGetRecoveryStatus(server, res) {
  try {
    if (!server.healthMonitor) {
      sendError(res, 503, 'Health monitor not initialized');
      return;
    }
    const status = server.healthMonitor.getRecoveryStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } catch (error) {
    sendError(res, 500, 'Failed to get recovery status: ' + error.message);
  }
}

/**
 * POST /admin/api/recovery/scan — trigger immediate recovery scan.
 * Rate limited to once per 30 seconds.
 */
let lastRecoveryScanTime = 0;
const RECOVERY_SCAN_COOLDOWN_MS = 30000;

async function handleRecoveryScan(server, req, res) {
  try {
    if (!server.healthMonitor) {
      sendError(res, 503, 'Health monitor not initialized');
      return;
    }

    const now = Date.now();
    if (now - lastRecoveryScanTime < RECOVERY_SCAN_COOLDOWN_MS) {
      const remainingSec = Math.ceil((RECOVERY_SCAN_COOLDOWN_MS - (now - lastRecoveryScanTime)) / 1000);
      sendError(res, 429, `Recovery scan rate limited. Please wait ${remainingSec}s.`);
      return;
    }

    lastRecoveryScanTime = now;

    // Capture before/after states
    const beforeStatus = server.healthMonitor.getRecoveryStatus();
    const beforeKeys = new Set(beforeStatus.keys.map(k => `${k.provider}:${k.keyHash}`));

    await server.healthMonitor.recoverExhaustedKeys();

    const afterStatus = server.healthMonitor.getRecoveryStatus();
    const afterKeys = new Set(afterStatus.keys.map(k => `${k.provider}:${k.keyHash}`));

    // Calculate results
    const recovered = [];
    const stillFailing = [];
    const skipped = [];

    for (const key of beforeStatus.keys) {
      const keyId = `${key.provider}:${key.keyHash}`;
      if (!afterKeys.has(keyId)) {
        recovered.push({ provider: key.provider, keyMask: key.keyMask });
      } else {
        const afterKey = afterStatus.keys.find(k => k.keyHash === key.keyHash && k.provider === key.provider);
        if (afterKey && afterKey.recoveryAttempts > key.recoveryAttempts) {
          stillFailing.push({ provider: key.provider, keyMask: key.keyMask, attempts: afterKey.recoveryAttempts });
        } else {
          skipped.push({ provider: key.provider, keyMask: key.keyMask, reason: 'cooldown not elapsed' });
        }
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      results: {
        recovered: recovered.length,
        stillFailing: stillFailing.length,
        skipped: skipped.length,
        details: { recovered, stillFailing, skipped }
      },
      status: afterStatus
    }));
  } catch (error) {
    sendError(res, 500, 'Failed to run recovery scan: ' + error.message);
  }
}

/**
 * POST /admin/api/recovery/probe/:provider/:keyHash — force probe a single key.
 */
async function handleRecoveryProbe(server, req, res, adminPath) {
  try {
    if (!server.healthMonitor) {
      sendError(res, 503, 'Health monitor not initialized');
      return;
    }

    // Parse provider and keyHash from path
    const match = adminPath.match(/^\/admin\/api\/recovery\/probe\/([^/]+)\/(.+)$/);
    if (!match) {
      sendError(res, 400, 'Invalid path format');
      return;
    }

    const [, provider, keyHash] = match;

    const result = await server.healthMonitor.probeSingleKey(provider, keyHash);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    sendError(res, 500, 'Failed to probe key: ' + error.message);
  }
}

/**
 * POST /admin/api/test — test an API key.
 * Body: { apiType, apiKey, baseUrl }
 */
async function handleTestApiKey(server, req, res, body) {
  try {
    const { apiType, apiKey, baseUrl } = JSON.parse(body);
    let testResult = { success: false, error: 'Unknown API type' };

    // MCP providers (search/parse services) - validate key format only
    const mcpProviders = ['brave', 'tavily', 'exa', 'firecrawl', 'context7', 'jina', 'searchapi', 'onref'];
    if (mcpProviders.includes(apiType.toLowerCase())) {
      testResult = validateMcpKey(apiType, apiKey);
    } else if (apiType === 'gemini') {
      testResult = await testGeminiKey(server, apiKey, baseUrl);
    } else if (apiType === 'openai') {
      testResult = await testOpenaiKey(server, apiKey, baseUrl);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(testResult));
  } catch (error) {
    sendError(res, 500, 'Failed to test API key');
  }
}

/**
 * Test a Gemini API key.
 */
async function testGeminiKey(server, apiKey, baseUrl = null) {
  const testId = Math.random().toString(36).substring(2, 11);
  const testBaseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1';
  const startTime = Date.now();

  // Determine the correct path based on base URL
  let testPath = '/models';
  let fullUrl;

  if (testBaseUrl.includes('/v1') || testBaseUrl.includes('/v1beta')) {
    fullUrl = `${testBaseUrl.endsWith('/') ? testBaseUrl.slice(0, -1) : testBaseUrl}/models?key=${apiKey}`;
  } else {
    fullUrl = `${testBaseUrl.endsWith('/') ? testBaseUrl.slice(0, -1) : testBaseUrl}/v1/models?key=${apiKey}`;
    testPath = '/v1/models';
  }

  try {
    const testResponse = await fetch(fullUrl);
    const responseText = await testResponse.text();
    const contentType = testResponse.headers.get('content-type') || 'unknown';
    const responseTime = Date.now() - startTime;

    // Store response data for viewing
    server.storeResponseData(testId, {
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
    server.logApiRequest(testId, 'GET', testPath, 'gemini', testResponse.status, responseTime, error, 'admin-test');

    console.log(`[TEST-${testId}] GET ${testPath} (Gemini) → ${testResponse.status} ${testResponse.statusText} | ${contentType} ${responseText.length}b`);

    return {
      success: testResponse.ok,
      error: error
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.log(`[TEST-${testId}] GET ${testPath} (Gemini) → ERROR: ${error.message}`);
    server.logApiRequest(testId, 'GET', testPath, 'gemini', null, responseTime, error.message, 'admin-test');

    return { success: false, error: error.message };
  }
}

/**
 * Test an OpenAI API key.
 */
async function testOpenaiKey(server, apiKey, baseUrl = null) {
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
    server.storeResponseData(testId, {
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
    server.logApiRequest(testId, 'GET', testPath, 'openai', testResponse.status, responseTime, error, 'admin-test');

    console.log(`[TEST-${testId}] GET ${testPath} (OpenAI) → ${testResponse.status} ${testResponse.statusText} | ${contentType} ${responseText.length}b`);

    return {
      success: testResponse.ok,
      error: error
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    console.log(`[TEST-${testId}] GET ${testPath} (OpenAI) → ERROR: ${error.message}`);
    server.logApiRequest(testId, 'GET', testPath, 'openai', null, responseTime, error.message, 'admin-test');

    return { success: false, error: error.message };
  }
}

/**
 * Validate MCP provider API key format.
 * MCP providers (search/parse services) don't have standard /models endpoints,
 * so we just validate the key format and confirm it's loaded.
 */
function validateMcpKey(apiType, apiKey) {
  if (!apiKey || typeof apiKey !== 'string') {
    return {
      success: false,
      error: 'Invalid API key format'
    };
  }

  // Basic validation: key should be non-empty and reasonable length
  if (apiKey.trim().length < 10) {
    return {
      success: false,
      error: 'API key too short (minimum 10 characters)'
    };
  }

  // Check for common placeholder values
  const placeholders = ['your-api-key', 'your_api_key', 'api-key-here', 'replace-me', 'xxx', 'test'];
  if (placeholders.some(p => apiKey.toLowerCase().includes(p))) {
    return {
      success: false,
      error: 'API key appears to be a placeholder value'
    };
  }

  // Key format looks valid
  return {
    success: true,
    message: `${apiType.toUpperCase()} API key format validated. Key is loaded and ready for use. Note: MCP providers don't support endpoint testing, but the key will be used for actual requests.`
  };
}

module.exports = {
  handleToggleProvider,
  handleToggleSyncEnv,
  handleToggleGlobalSync,
  handleGetHealth,
  handleHealthCheckAll,
  handleHealthReset,
  handleGetRecoveryStatus,
  handleRecoveryScan,
  handleRecoveryProbe,
  handleTestApiKey,
  testGeminiKey,
  testOpenaiKey
};
