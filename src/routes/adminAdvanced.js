/**
 * Admin advanced feature route handlers.
 * Analytics, fallbacks, circuit breaker, cache, virtual keys,
 * budgets, key expiry, config export/import, filesystem ops.
 */

const fs = require('fs');
const path = require('path');
const { sendError } = require('./httpHelpers');

// ─── Analytics ─────────────────────────────────────────────

/**
 * GET /admin/api/analytics — query analytics data.
 * Query params: range (e.g. '7d')
 */
async function handleGetAnalytics(server, res, params) {
  try {
    const range = params?.range || '7d';
    const data = server.analytics.query(range);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (error) {
    sendError(res, 500, 'Analytics query failed: ' + error.message);
  }
}

/**
 * POST /admin/api/analytics/reset — reset analytics data.
 */
async function handleResetAnalytics(server, req, res) {
  try {
    server.analytics.reset();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Reset failed');
  }
}

// ─── Fallbacks ─────────────────────────────────────────────

/**
 * GET /admin/api/fallbacks — get all fallback chains.
 */
async function handleGetFallbacks(server, res) {
  try {
    const chains = server.fallbackRouter ? server.fallbackRouter.getAllChains() : {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(chains));
  } catch (error) {
    sendError(res, 500, 'Failed to get fallbacks: ' + error.message);
  }
}

/**
 * POST /admin/api/fallbacks — set a fallback route.
 * Body: { provider, fallbackProvider, fallbackModel }
 */
async function handleSetFallback(server, req, res, body) {
  try {
    const { provider, fallbackProvider, fallbackModel } = JSON.parse(body || '{}');
    if (!provider || !fallbackProvider) {
      sendError(res, 400, 'provider and fallbackProvider required');
      return;
    }
    if (server.fallbackRouter) {
      server.fallbackRouter.setFallback(provider, fallbackProvider, fallbackModel || null);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to set fallback: ' + error.message);
  }
}

// ─── Circuit Breaker ───────────────────────────────────────

/**
 * GET /admin/api/circuit-breaker — get circuit breaker states.
 */
async function handleGetCircuitBreaker(server, res) {
  try {
    const states = server.circuitBreaker.getAllStates();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(states));
  } catch (error) {
    sendError(res, 500, 'Failed to get circuit breaker states: ' + error.message);
  }
}

/**
 * POST /admin/api/circuit-breaker/:provider/:action — force-open or force-close.
 */
async function handleCircuitBreakerAction(server, req, res, urlPath, body) {
  try {
    const parts = urlPath.split('/');
    const provider = parts[4];
    const action = parts[5];

    if (!provider || !action) {
      sendError(res, 400, 'Provider and action required');
      return;
    }

    if (action === 'force-close') {
      server.circuitBreaker.forceClose(provider);
    } else if (action === 'force-open') {
      server.circuitBreaker.forceOpen(provider);
    } else {
      sendError(res, 400, 'Unknown action: ' + action);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Circuit breaker action failed: ' + error.message);
  }
}

// ─── Cache ─────────────────────────────────────────────────

/**
 * GET /admin/api/cache — get cache stats.
 */
async function handleGetCacheStats(server, res) {
  try {
    const stats = server.responseCache.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } catch (error) {
    sendError(res, 500, 'Cache stats failed');
  }
}

/**
 * DELETE /admin/api/cache — clear cache.
 */
async function handleClearCache(server, req, res) {
  try {
    server.responseCache.clear();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Cache clear failed');
  }
}

/**
 * POST /admin/api/cache/config — update cache configuration.
 * Body: { enabled, maxEntries, ttlMs }
 */
async function handleCacheConfig(server, req, res, body) {
  try {
    const { enabled, maxEntries, ttlMs } = JSON.parse(body || '{}');
    server.responseCache.configure({ enabled, maxEntries, ttlMs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(server.responseCache.getStats()));
  } catch (error) {
    sendError(res, 500, 'Cache config failed');
  }
}

// ─── Virtual Keys ──────────────────────────────────────────

/**
 * GET /admin/api/virtual-keys — list virtual keys.
 */
async function handleListVirtualKeys(server, res) {
  try {
    const keys = server.virtualKeyManager.list();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(keys));
  } catch (error) {
    sendError(res, 500, 'Virtual key list failed');
  }
}

/**
 * POST /admin/api/virtual-keys — create a virtual key.
 * Body: { name, allowedProviders, allowedModels, rpmLimit, expiresAt }
 */
async function handleCreateVirtualKey(server, req, res, body) {
  try {
    const { name, allowedProviders, allowedModels, rpmLimit, expiresAt } = JSON.parse(body || '{}');
    const result = server.virtualKeyManager.create({
      name, allowedProviders: allowedProviders || [],
      allowedModels: allowedModels || [],
      rpmLimit: rpmLimit || 0,
      expiresAt: expiresAt || null
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    sendError(res, 500, 'Virtual key creation failed');
  }
}

/**
 * DELETE /admin/api/virtual-keys/:id — revoke a virtual key.
 */
async function handleRevokeVirtualKey(server, req, res, urlPath) {
  try {
    const parts = urlPath.split('/');
    const id = parts[parts.length - 1];
    const deleted = server.virtualKeyManager.revoke(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: deleted }));
  } catch (error) {
    sendError(res, 500, 'Virtual key revoke failed');
  }
}

/**
 * POST /admin/api/virtual-keys/:id — toggle a virtual key.
 */
async function handleToggleVirtualKey(server, req, res, urlPath) {
  try {
    const parts = urlPath.split('/');
    const id = parts[parts.length - 1];
    const toggled = server.virtualKeyManager.toggle(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: toggled }));
  } catch (error) {
    sendError(res, 500, 'Virtual key toggle failed');
  }
}

// ─── Budgets ───────────────────────────────────────────────

/**
 * GET /admin/api/budgets — get all budget statuses.
 */
async function handleGetBudgets(server, res) {
  try {
    const statuses = server.budgetTracker.getAllStatuses();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(statuses));
  } catch (error) {
    sendError(res, 500, 'Budget query failed');
  }
}

/**
 * POST /admin/api/budgets — set a budget.
 * Body: { keyHash, dailyLimit, monthlyLimit }
 */
async function handleSetBudget(server, req, res, body) {
  try {
    const { keyHash, dailyLimit, monthlyLimit } = JSON.parse(body || '{}');
    if (!keyHash) {
      sendError(res, 400, 'keyHash required');
      return;
    }
    server.budgetTracker.setBudget(keyHash, { dailyLimit: dailyLimit || 0, monthlyLimit: monthlyLimit || 0 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(server.budgetTracker.getStatus(keyHash)));
  } catch (error) {
    sendError(res, 500, 'Budget set failed');
  }
}

// ─── Key Expiry ────────────────────────────────────────────

/**
 * GET /admin/api/key-expiry — get key expiry info.
 * Query params: provider
 */
async function handleGetKeyExpiry(server, res, params) {
  try {
    const providerName = params?.provider;
    const result = {};
    const clients = server.providerClients;
    for (const [name, client] of clients.entries()) {
      if (providerName && name !== providerName) continue;
      if (client.keyRotator && client.keyRotator.ttlMs > 0) {
        result[name] = client.keyRotator.getKeyUsageStats(name)
          .filter(k => k.expiry)
          .map(k => ({ key: k.key, expiry: k.expiry }));
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    sendError(res, 500, 'Key expiry query failed');
  }
}

/**
 * POST /admin/api/key-extend — extend a key's TTL.
 * Body: { provider, fullKey }
 */
async function handleExtendKey(server, req, res, body) {
  try {
    const { provider, fullKey } = JSON.parse(body || '{}');
    if (!provider || !fullKey) {
      sendError(res, 400, 'provider and fullKey required');
      return;
    }
    const client = server.providerClients.get(provider);
    if (!client || !client.keyRotator) {
      sendError(res, 404, 'Provider not found');
      return;
    }
    client.keyRotator.extendKey(fullKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Key extend failed');
  }
}

// ─── Config Export/Import ──────────────────────────────────

/**
 * POST /admin/api/export-config — export config.
 * Body: { includeSecrets }
 */
async function handleExportConfig(server, req, res, body) {
  try {
    const { includeSecrets } = JSON.parse(body || '{}');
    const data = server.configExporter.exportConfig(!!includeSecrets);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  } catch (error) {
    sendError(res, 500, 'Export failed');
  }
}

/**
 * POST /admin/api/import-config — import config.
 * Body: { config, mode }
 */
async function handleImportConfig(server, req, res, body) {
  try {
    const { config: importData, mode } = JSON.parse(body || '{}');
    if (!importData) {
      sendError(res, 400, 'Config data required');
      return;
    }
    const result = server.configExporter.importConfig(importData, mode || 'merge');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    sendError(res, 500, 'Import failed');
  }
}

// ─── Filesystem Operations ─────────────────────────────────

/**
 * GET /admin/api/fs-list — list directory contents.
 * Query params: path
 */
async function handleFsList(server, res, queryPath) {
  try {
    let targetPath = queryPath;
    if (!targetPath || targetPath === 'undefined') {
      targetPath = process.cwd();
    }

    // Basic safety: resolve the path
    targetPath = path.resolve(targetPath);

    if (!fs.existsSync(targetPath)) {
      sendError(res, 404, 'Path not found');
      return;
    }

    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      sendError(res, 400, 'Path is not a directory');
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
    sendError(res, 500, 'Failed to list directory: ' + error.message);
  }
}

/**
 * GET /admin/api/fs-drives — list available drives (Windows).
 */
async function handleFsDrives(server, res) {
  try {
    const { exec } = require('child_process');
    if (process.platform === 'win32') {
      exec('wmic logicaldisk get name', (error, stdout) => {
        if (error) {
          sendError(res, 500, 'Failed to list drives');
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
    sendError(res, 500, 'Failed to list drives');
  }
}

module.exports = {
  handleGetAnalytics,
  handleResetAnalytics,
  handleGetFallbacks,
  handleSetFallback,
  handleGetCircuitBreaker,
  handleCircuitBreakerAction,
  handleGetCacheStats,
  handleClearCache,
  handleCacheConfig,
  handleListVirtualKeys,
  handleCreateVirtualKey,
  handleRevokeVirtualKey,
  handleToggleVirtualKey,
  handleGetBudgets,
  handleSetBudget,
  handleGetKeyExpiry,
  handleExtendKey,
  handleExportConfig,
  handleImportConfig,
  handleFsList,
  handleFsDrives
};
