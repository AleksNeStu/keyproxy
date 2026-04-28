const { sendError } = require('./httpHelpers');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleGetEnvSources(server, res) {
  try {
    if (!server.keyVault) { sendJson(res, 200, { sources: [] }); return; }
    const sources = server.keyVault.getImportSources();
    sendJson(res, 200, { sources });
  } catch (err) {
    sendError(res, 500, 'Failed to list env sources');
  }
}

async function handleAddEnvSource(server, req, res, body) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.name || !data.name.trim()) {
      sendError(res, 400, 'Name is required');
      return;
    }
    if (!data.filePath || !data.filePath.trim()) {
      sendError(res, 400, 'File path is required');
      return;
    }

    const source = server.keyVault.addImportSource({
      name: data.name.trim(),
      filePath: data.filePath.trim(),
    });
    server.keyVault.flushSync();
    sendJson(res, 200, { success: true, source });
  } catch (err) {
    sendError(res, 500, 'Failed to add env source');
  }
}

async function handleRemoveEnvSource(server, req, res, body) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Source id is required');
      return;
    }

    const success = server.keyVault.removeImportSource(data.id);
    if (!success) {
      sendError(res, 404, 'Source not found');
      return;
    }
    server.keyVault.flushSync();
    sendJson(res, 200, { success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to remove env source');
  }
}

async function handlePreviewEnvSource(server, req, res, body) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Source id is required');
      return;
    }

    const result = server.keyVault.previewImport(data.id);
    if (result.error) {
      sendError(res, 400, result.error);
      return;
    }

    // Transform vault preview format to match what UI expects
    const newKeys = {};
    let totalNewKeys = result.newKeys.length;
    let totalNewProviders = new Set(result.newKeys.map(k => k.providerName)).size;

    for (const k of result.newKeys) {
      const envVar = `OPENAI_${k.providerName.toUpperCase()}_API_KEYS`;
      if (!newKeys[envVar]) newKeys[envVar] = [];
      newKeys[envVar].push(k.keyValue);
    }
    for (const [key, val] of Object.entries(newKeys)) {
      newKeys[key] = val.join(',');
    }

    sendJson(res, 200, {
      sourceId: data.id,
      newKeys,
      totalNewKeys,
      totalNewProviders,
      existingKeys: result.unchangedKeys.map(k => k.keyId),
    });
  } catch (err) {
    sendError(res, 500, 'Failed to preview env source');
  }
}

async function handlePullEnvSource(server, req, res, body) {
  try {
    if (!server.keyVault) { sendError(res, 404, 'Vault not available'); return; }
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Source id is required');
      return;
    }

    const result = server.keyVault.pullImport(data.id);
    if (result.error) {
      sendError(res, 400, result.error);
      return;
    }

    // Reload providers from vault after import
    if (result.imported > 0) {
      server.config.providers.clear();
      server.config.loadProvidersFromVault();
      server.reinitializeClients();
    }

    server.keyVault.flushSync();
    sendJson(res, 200, {
      success: true,
      imported: { keys: result.imported, providers: result.skipped > 0 ? 1 : 0 },
      message: result.imported > 0
        ? `Imported ${result.imported} new key(s)`
        : 'No new keys found in this source',
    });
  } catch (err) {
    sendError(res, 500, 'Failed to pull from env source');
  }
}

module.exports = {
  handleGetEnvSources,
  handleAddEnvSource,
  handleRemoveEnvSource,
  handlePreviewEnvSource,
  handlePullEnvSource,
};
