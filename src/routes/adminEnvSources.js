const { sendError } = require('./httpHelpers');

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function handleGetEnvSources(server, res) {
  try {
    const sources = server.envSourceManager.list();
    sendJson(res, 200, { sources });
  } catch (err) {
    sendError(res, 500, 'Failed to list env sources');
  }
}

async function handleAddEnvSource(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    const result = server.envSourceManager.add({
      name: data.name,
      filePath: data.filePath
    });

    if (result.error) {
      sendError(res, 400, result.error);
      return;
    }

    sendJson(res, 200, { success: true, source: result });
  } catch (err) {
    sendError(res, 500, 'Failed to add env source');
  }
}

async function handleRemoveEnvSource(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Source id is required');
      return;
    }

    const result = server.envSourceManager.remove(data.id);
    if (result.error) {
      sendError(res, 404, result.error);
      return;
    }

    sendJson(res, 200, { success: true });
  } catch (err) {
    sendError(res, 500, 'Failed to remove env source');
  }
}

async function handlePreviewEnvSource(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Source id is required');
      return;
    }

    const result = server.envSourceManager.previewNewKeys(data.id, server.config);
    if (result.error) {
      sendError(res, 400, result.error);
      return;
    }

    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, 500, 'Failed to preview env source');
  }
}

async function handlePullEnvSource(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Source id is required');
      return;
    }

    const result = server.envSourceManager.pullKeys(data.id, server);
    if (result.error) {
      sendError(res, 400, result.error);
      return;
    }

    sendJson(res, 200, result);
  } catch (err) {
    sendError(res, 500, 'Failed to pull from env source');
  }
}

module.exports = {
  handleGetEnvSources,
  handleAddEnvSource,
  handleRemoveEnvSource,
  handlePreviewEnvSource,
  handlePullEnvSource
};
