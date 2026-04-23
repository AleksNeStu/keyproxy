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
 * POST /admin/api/toggle-sync-env — toggle sync-to-env for a provider.
 * Body: { apiType, providerName, enabled }
 */
async function handleToggleSyncEnv(server, req, res, body) {
  try {
    const { apiType, providerName, enabled } = JSON.parse(body);
    if (!apiType || !providerName) {
      sendError(res, 400, 'Missing apiType or providerName');
      return;
    }

    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_SYNC_ENV`;

    if (enabled) {
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
    sendError(res, 500, 'Failed to toggle sync env: ' + error.message);
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
    const recoveryStatus = {};
    const providers = server.config.providers;
    for (const [name, config] of providers.entries()) {
      if (config.disabled) continue;
      const allKeys = config.allKeys ? config.allKeys.map(k => k.key) : config.keys;
      // Get all exhausted keys regardless of cooldown (use 0) and without max filter
      const exhausted = server.historyManager.getExhaustedKeys(name, 0, allKeys, 0);
      if (exhausted.length > 0) {
        const maxAttempts = server.healthMonitor.maxRecoveryAttempts;
        recoveryStatus[name] = exhausted.map(e => {
          const attempts = e.recoveryAttempts || 0;
          const baseSec = Math.round(server.healthMonitor.backoffBaseMs / 1000);
          const nextBackoffSec = Math.min(baseSec * Math.pow(2, attempts), server.healthMonitor.backoffMaxMs / 1000);
          const elapsed = Date.now() - new Date(e.rotatedOutAt).getTime();
          const nextProbeInSec = Math.max(0, Math.round(nextBackoffSec - elapsed / 1000));
          return {
            hash: e.hash,
            fullKey: e.fullKey,
            rotatedOutAt: e.rotatedOutAt,
            rotationReason: e.rotationReason,
            recoveryAttempts: attempts,
            maxRecoveryAttempts: maxAttempts,
            permanentlyExhausted: attempts >= maxAttempts,
            nextProbeInSec: attempts >= maxAttempts ? null : nextProbeInSec
          };
        });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      enabled: server.healthMonitor.recoveryEnabled,
      baseCooldownSec: Math.round(server.healthMonitor.backoffBaseMs / 1000),
      maxRecoveryAttempts: server.healthMonitor.maxRecoveryAttempts,
      backoffMaxSec: Math.round(server.healthMonitor.backoffMaxMs / 1000),
      providers: recoveryStatus
    }));
  } catch (error) {
    sendError(res, 500, 'Failed to get recovery status: ' + error.message);
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

    if (apiType === 'gemini') {
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

module.exports = {
  handleToggleProvider,
  handleToggleSyncEnv,
  handleGetHealth,
  handleHealthCheckAll,
  handleHealthReset,
  handleGetRecoveryStatus,
  handleTestApiKey,
  testGeminiKey,
  testOpenaiKey
};
