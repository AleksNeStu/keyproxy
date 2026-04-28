/**
 * Admin key management route handlers.
 * Toggle keys, reorder, usage stats, history, recovery, RPM, vault CRUD.
 */

const fs = require('fs');
const path = require('path');
const { maskApiKey } = require('../core/utils');
const { sendError } = require('./httpHelpers');

// ── Legacy .env-based handlers (fallback when vault not available) ──────────

/**
 * POST /admin/api/toggle-key — toggle a key's disabled state.
 * Body: { apiType, providerName, keyIndex, disabled }
 * When vault is available: uses keyId instead of keyIndex.
 */
async function handleToggleKey(server, req, res, body) {
  try {
    const { apiType, providerName, keyIndex, disabled, keyId } = JSON.parse(body);

    // Vault path
    if (server.keyVault && keyId) {
      const key = server.keyVault.getKeyById(keyId);
      if (!key) { sendError(res, 404, 'Key not found in vault'); return; }
      if (disabled && key.status === 'active') {
        server.keyVault.toggleKey(keyId);
      } else if (!disabled && key.status === 'disabled') {
        server.keyVault.toggleKey(keyId);
      }
      server.keyVault.flushSync();
      server.config.loadConfig();
      server.reinitializeClients();
      server.auditLog.log('toggle_key', { providerName, keyId, disabled });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Legacy .env path
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
 * When vault is available: uses keyIds array.
 */
async function handleReorderKeys(server, req, res, body) {
  try {
    const { apiType, providerName, keys, keyIds } = JSON.parse(body);

    // Vault path
    if (server.keyVault && keyIds && Array.isArray(keyIds)) {
      server.keyVault.reorderKeys(providerName, keyIds);
      server.keyVault.flushSync();
      server.config.loadConfig();
      server.reinitializeClients();
      server.auditLog.log('reorder_keys', { providerName });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Legacy .env path
    if (!apiType || !providerName || !Array.isArray(keys)) {
      sendError(res, 400, 'Missing apiType, providerName, or keys array');
      return;
    }
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);
    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
    const currentValue = envVars[envKey] || '';
    const currentParsed = server.config.parseApiKeysWithState(currentValue);
    const disabledSet = new Set(currentParsed.allKeys.filter(k => k.disabled).map(k => k.key));
    const newKeysStr = keys.map(k => disabledSet.has(k) ? `~${k}` : k).join(',');
    envVars[envKey] = newKeysStr;
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

// ── Key stats / history (unchanged) ────────────────────────────────────────

async function handleGetKeyUsage(server, res) {
  try {
    const usage = {};
    for (const [providerName, client] of server.providerClients.entries()) {
      if (client.keyRotator) {
        usage[providerName] = client.keyRotator.getKeyUsageStats(providerName);
      }
    }
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

async function handleResetKeyHistory(server, req, res, providerName) {
  try {
    server.historyManager.resetProvider(providerName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to reset key history');
  }
}

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
      server.historyManager.recordKeyExhausted(providerName, fullKey, 'manual-test-failed');
      console.log(`[RECOVERY] Manual test failed for key ${masked}: ${result.error}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, recovered: false, error: result.error }));
    }
  } catch (error) {
    sendError(res, 500, 'Key test failed: ' + error.message);
  }
}

async function handleGetRpm(server, res) {
  try {
    const rpmData = server.rpmTracker.getAllRpm();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rpmData));
  } catch (error) {
    sendError(res, 500, 'RPM query failed');
  }
}

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

// ── Vault-specific route handlers ──────────────────────────────────────────

/**
 * GET /admin/api/vault/keys — all keys with vault status/source.
 * Optional query: ?provider=brave
 */
function handleVaultGetKeys(server, res, providerName) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const keys = providerName
      ? server.keyVault.getKeys(providerName)
      : server.keyVault.getKeys();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(keys));
  } catch (error) {
    sendError(res, 500, 'Failed to get vault keys: ' + error.message);
  }
}

/**
 * POST /admin/api/vault/keys — add a key manually.
 * Body: { providerName, keyValue, disabled? }
 */
function handleVaultAddKey(server, req, res, body) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const { providerName, keyValue, disabled } = JSON.parse(body);
    if (!providerName || !keyValue) { sendError(res, 400, 'Missing providerName or keyValue'); return; }
    const key = server.keyVault.addKey(providerName, keyValue, { source: 'manual', disabled: !!disabled });
    server.keyVault.flushSync();
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('vault_add_key', { providerName, keyId: key.id });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, key }));
  } catch (error) {
    sendError(res, 500, 'Failed to add key: ' + error.message);
  }
}

/**
 * DELETE /admin/api/vault/keys/:id — soft-delete a key.
 */
function handleVaultDeleteKey(server, res, keyId) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const success = server.keyVault.removeKey(keyId);
    if (!success) { sendError(res, 404, 'Key not found'); return; }
    server.keyVault.flushSync();
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('vault_delete_key', { keyId });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to delete key: ' + error.message);
  }
}

/**
 * POST /admin/api/vault/keys/:id/ban — ban a key.
 * Body: { reason? }
 */
function handleVaultBanKey(server, req, res, body, keyId) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const { reason } = body ? JSON.parse(body) : {};
    const success = server.keyVault.banKey(keyId, reason);
    if (!success) { sendError(res, 404, 'Key not found or already deleted'); return; }
    server.keyVault.flushSync();
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('vault_ban_key', { keyId, reason });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to ban key: ' + error.message);
  }
}

/**
 * POST /admin/api/vault/keys/:id/unban — unban a key.
 */
function handleVaultUnbanKey(server, res, keyId) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const success = server.keyVault.unbanKey(keyId);
    if (!success) { sendError(res, 404, 'Key not found or not banned'); return; }
    server.keyVault.flushSync();
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('vault_unban_key', { keyId });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to unban key: ' + error.message);
  }
}

/**
 * POST /admin/api/vault/keys/:id/restore — restore a soft-deleted key.
 */
function handleVaultRestoreKey(server, res, keyId) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const success = server.keyVault.restoreKey(keyId);
    if (!success) { sendError(res, 404, 'Key not found or not deleted'); return; }
    server.keyVault.flushSync();
    server.config.loadConfig();
    server.reinitializeClients();
    server.auditLog.log('vault_restore_key', { keyId });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to restore key: ' + error.message);
  }
}

/**
 * GET /admin/api/vault/deleted — list soft-deleted keys.
 */
function handleVaultGetDeleted(server, res) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const keys = server.keyVault.getDeletedKeys();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(keys));
  } catch (error) {
    sendError(res, 500, 'Failed to get deleted keys: ' + error.message);
  }
}

/**
 * GET /admin/api/vault/active-key/:provider — get currently active key for a provider.
 */
function handleVaultGetActiveKey(server, res, providerName) {
  try {
    const activeKey = server.activeKeyMap?.get(providerName) || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ providerName, activeKey: activeKey ? maskApiKey(activeKey) : null }));
  } catch (error) {
    sendError(res, 500, 'Failed to get active key: ' + error.message);
  }
}

/**
 * GET /admin/api/vault/active-keys — get all currently active keys (provider → masked key).
 */
function handleVaultGetAllActiveKeys(server, res) {
  try {
    const result = {};
    if (server.activeKeyMap) {
      for (const [provider, key] of server.activeKeyMap.entries()) {
        result[provider] = key;
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    sendError(res, 500, 'Failed to get active keys: ' + error.message);
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
  handleUnfreezeKey,
  handleVaultGetKeys,
  handleVaultAddKey,
  handleVaultDeleteKey,
  handleVaultBanKey,
  handleVaultUnbanKey,
  handleVaultRestoreKey,
  handleVaultGetDeleted,
  handleVaultGetActiveKey,
  handleVaultGetAllActiveKeys,
};
