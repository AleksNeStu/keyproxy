/**
 * Admin exclusion pattern management route handlers.
 * CRUD operations for key exclusion patterns.
 */

const { sendError, sendResponse } = require('./httpHelpers');

function handleGetExclusions(server, res) {
  try {
    const patterns = server.exclusionManager ? server.exclusionManager.list() : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ patterns }));
  } catch (error) {
    sendError(res, 500, 'Failed to load exclusions: ' + error.message);
  }
}

async function handleAddExclusion(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.pattern) {
      sendError(res, 400, 'Pattern is required');
      return;
    }

    if (!server.exclusionManager) {
      sendError(res, 500, 'Exclusion manager not initialized');
      return;
    }

    const result = server.exclusionManager.add({
      pattern: data.pattern,
      type: data.type || null,
      description: data.description || ''
    });

    if (result.error) {
      sendError(res, 400, result.error);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, pattern: result }));
  } catch (error) {
    sendError(res, 500, 'Failed to add exclusion: ' + error.message);
  }
}

async function handleRemoveExclusion(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Pattern id is required');
      return;
    }

    if (!server.exclusionManager) {
      sendError(res, 500, 'Exclusion manager not initialized');
      return;
    }

    const result = server.exclusionManager.remove(data.id);
    if (result.error) {
      sendError(res, 404, result.error);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to remove exclusion: ' + error.message);
  }
}

async function handleToggleExclusion(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.id) {
      sendError(res, 400, 'Pattern id is required');
      return;
    }

    if (!server.exclusionManager) {
      sendError(res, 500, 'Exclusion manager not initialized');
      return;
    }

    const result = server.exclusionManager.toggle(data.id);
    if (result.error) {
      sendError(res, 404, result.error);
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, pattern: result }));
  } catch (error) {
    sendError(res, 500, 'Failed to toggle exclusion: ' + error.message);
  }
}

async function handleTestExclusion(server, req, res, body) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    if (!data.name) {
      sendError(res, 400, 'Variable name is required');
      return;
    }

    if (!server.exclusionManager) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ excluded: false, matchedBy: null }));
      return;
    }

    const result = server.exclusionManager.testPattern(data.name);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (error) {
    sendError(res, 500, 'Failed to test exclusion: ' + error.message);
  }
}

module.exports = {
  handleGetExclusions,
  handleAddExclusion,
  handleRemoveExclusion,
  handleToggleExclusion,
  handleTestExclusion
};
