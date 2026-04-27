/**
 * Admin key management route handlers.
 * Toggle keys, reorder, usage stats, history, recovery, RPM.
 */

const fs = require('fs');
const path = require('path');
const { maskApiKey } = require('../core/utils');
const { sendError } = require('./httpHelpers');

/**
 * POST /admin/api/toggle-key — toggle a key's disabled state.
 * Body: { apiType, providerName, keyIndex, disabled }
 */
async function handleToggleKey(server, req, res, body) {
  try {
    const { apiType, providerName, keyIndex, disabled } = JSON.parse(body);
    if (!apiType || !providerName || keyIndex === undefined) {
      sendError(res, 400, 'Missing apiType, providerName, or keyIndex');
      return;
    }

    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
    const currentValue = envVars[envKey] || '';
    const parsed = server.config.parseApiKeysWithState(currentValue);

    if (keyIndex < 0 || keyIndex >= parsed.allKeys.length) {
      sendError(res, 400, 'Invalid key index');
      return;
    }

    parsed.allKeys[keyIndex].disabled = disabled;

    // Rebuild key string
    const newKeysStr = parsed.allKeys.map(k => k.disabled ? `~${k.key}` : k.key).join(',');
    envVars[envKey] = newKeysStr;

    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('toggle_key', { apiType, providerName, keyIndex, disabled });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to toggle key: ' + error.message);
  }
}

/**
 * POST /admin/api/reorder-keys — reorder keys for a provider.
 * Body: { apiType, providerName, keys: string[] }
 */
async function handleReorderKeys(server, req, res, body) {
  try {
    const { apiType, providerName, keys } = JSON.parse(body);
    if (!apiType || !providerName || !Array.isArray(keys)) {
      sendError(res, 400, 'Missing apiType, providerName, or keys array');
      return;
    }

    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;

    // Preserve disabled state: build new key string with ~ prefix for disabled keys
    const currentValue = envVars[envKey] || '';
    const currentParsed = server.config.parseApiKeysWithState(currentValue);
    const disabledSet = new Set(currentParsed.allKeys.filter(k => k.disabled).map(k => k.key));

    const newKeysStr = keys.map(k => disabledSet.has(k) ? `~${k}` : k).join(',');
    envVars[envKey] = newKeysStr;

    // Write updated env
    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('reorder_keys', { apiType, providerName });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to reorder keys: ' + error.message);
  }
}

/**
 * GET /admin/api/key-usage — get key usage statistics for all providers.
 */
async function handleGetKeyUsage(server, res) {
  try {
    const usage = {};

    // Get usage from provider clients
    for (const [providerName, client] of server.providerClients.entries()) {
      if (client.keyRotator) {
        usage[providerName] = client.keyRotator.getKeyUsageStats(providerName);
      }
    }

    // Legacy clients
    if (server.geminiClient && server.geminiClient.keyRotator && !usage['gemini']) {
      usage['gemini'] = server.geminiClient.keyRotator.getKeyUsageStats('gemini');
    }
    if (server.openaiClient && server.openaiClient.keyRotator && !usage['openai']) {
      usage['openai'] = server.openaiClient.keyRotator.getKeyUsageStats('openai');
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(usage));
  } catch (error) {
    sendError(res, 500, 'Failed to get key usage');
  }
}

/**
 * GET /admin/api/key-history — get key rotation history.
 * Optional query param: provider name in URL path.
 */
async function handleGetKeyHistory(server, res, providerName = null) {
  try {
    const history = providerName
      ? { [providerName]: server.historyManager.getProviderHistory(providerName) }
      : server.historyManager.getAllHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
  } catch (error) {
    sendError(res, 500, 'Failed to get key history');
  }
}

/**
 * POST /admin/api/key-history/reset/:provider — reset key rotation history for a provider.
 */
async function handleResetKeyHistory(server, req, res, providerName) {
  try {
    server.historyManager.resetProvider(providerName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to reset key history');
  }
}

/**
 * POST /admin/api/key-test — manual key test with recovery counter reset.
 * Body: { providerName, fullKey }
 */
async function handleTestKeyRecovery(server, req, res, body) {
  try {
    const { providerName, fullKey } = JSON.parse(body);
    if (!providerName || !fullKey) {
      sendError(res, 400, 'Missing providerName or fullKey');
      return;
    }

    const providerConfig = server.config.getProvider(providerName);
    if (!providerConfig) {
      sendError(res, 404, 'Provider not found');
      return;
    }

    // Reset recovery attempts so auto-recovery can resume if this fails
    server.historyManager.resetRecoveryAttempts(providerName, fullKey);

    const masked = maskApiKey(fullKey);
    console.log(`[RECOVERY] Manual test requested for key ${masked} on '${providerName}'`);

    const result = await server.healthMonitor.probeKey(providerName, providerConfig, fullKey);

    if (result.success) {
      server.historyManager.recoverKey(providerName, fullKey);
      console.log(`[RECOVERY] Manual test succeeded for key ${masked} — recovered`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, recovered: true, message: 'Key is healthy and recovered' }));
    } else {
      // Re-record exhaustion with fresh counter
      server.historyManager.recordKeyExhausted(providerName, fullKey, 'manual-test-failed');
      console.log(`[RECOVERY] Manual test failed for key ${masked}: ${result.error}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, recovered: false, error: result.error }));
    }
  } catch (error) {
    sendError(res, 500, 'Key test failed: ' + error.message);
  }
}

/**
 * GET /admin/api/rpm — get per-key RPM data.
 */
async function handleGetRpm(server, res) {
  try {
    const rpmData = server.rpmTracker.getAllRpm();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpmData));
  } catch (error) {
    sendError(res, 500, 'RPM query failed');
  }
}

/**
 * POST /admin/api/unfreeze-key — manually unfreeze a frozen key.
 * Body: { providerName, fullKey }
 */
async function handleUnfreezeKey(server, req, res, body) {
  try {
    const { providerName, fullKey } = JSON.parse(body);
    if (!providerName || !fullKey) {
      sendError(res, 400, 'Missing providerName or fullKey');
      return;
    }

    const providerConfig = server.config.getProvider(providerName);
    if (!providerConfig) {
      sendError(res, 404, 'Provider not found');
      return;
    }

    const status = server.historyManager.getKeyStatus(providerName, fullKey);
    if (status.status !== 'frozen') {
      sendError(res, 400, 'Key is not frozen');
      return;
    }

    const success = server.historyManager.unfreezeKey(providerName, fullKey);
    if (success) {
      const masked = maskApiKey(fullKey);
      console.log(`[FREEZE] Key ${masked} manually unfrozen for '${providerName}'`);
      if (server.notifier) {
        server.notifier.send(`Key ${masked} manually unfrozen for '${providerName}'`, 'recovery');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    } else {
      sendError(res, 500, 'Failed to unfreeze key');
    }
  } catch (error) {
    sendError(res, 500, 'Failed to unfreeze key: ' + error.message);
  }
}

module.exports = {
  handleToggleKey,
  handleReorderKeys,
  handleGetKeyUsage,
  handleGetKeyHistory,
  handleResetKeyHistory,
  handleTestKeyRecovery,
  handleGetRpm,
  handleUnfreezeKey
};
