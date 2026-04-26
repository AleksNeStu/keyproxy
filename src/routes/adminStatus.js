/**
 * Admin unified status endpoint.
 * Combines RPM, key expiry, and other status data into single response.
 * Solves N+1 request problem.
 */

const { sendError } = require('./httpHelpers');
const { maskApiKey } = require('../core/utils');

/**
 * GET /admin/api/status — unified status endpoint.
 * Returns: { rpm: {...}, keyExpiry: {...}, health: {...} }
 * 
 * This endpoint combines multiple status checks into one request
 * to prevent N+1 problem on frontend.
 */
async function handleGetStatus(server, res, params) {
  try {
    const response = {
      rpm: {},
      keyExpiry: {},
      health: null,
      globalSyncEnabled: server.config.isGlobalSyncEnabled(),
      providers: {},
      timestamp: Date.now()
    };

    // Get RPM data
    try {
      const rpmData = server.rpmTracker.getAllRpm();
      // getAllRpm() returns Object with masked keys: { "sk-abc123": 5, "sk-def456": 2 }
      Object.assign(response.rpm, rpmData);
    } catch (error) {
      console.error('[STATUS] Failed to get RPM data:', error.message);
    }

    // Get key expiry data + provider sync status
    try {
      const providers = server.config.getProviders();
      for (const [providerName, providerConfig] of providers.entries()) {
        const keyExpiryList = [];
        for (const key of providerConfig.keys) {
          const keyHash = server.historyManager.hashKey(key);
          const maskedKey = maskApiKey(key);
          const expiryInfo = server.historyManager.getKeyExpiry(providerName, keyHash);
          keyExpiryList.push({
            key: maskedKey,
            expiry: expiryInfo
          });
        }
        response.keyExpiry[providerName] = keyExpiryList;
        response.providers[providerName] = {
          syncEnabled: server.config.isProviderSyncEnabled(providerName)
        };
      }
    } catch (error) {
      console.error('[STATUS] Failed to get key expiry data:', error.message);
    }

    // Get health summary (optional, only if requested)
    if (params.includeHealth === 'true' && server.healthMonitor) {
      try {
        response.health = {
          summary: server.healthMonitor.getSummary(),
          providers: server.healthMonitor.getAllStatuses()
        };
      } catch (error) {
        console.error('[STATUS] Failed to get health data:', error.message);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  } catch (error) {
    console.error('[STATUS] Failed to get unified status:', error.message);
    sendError(res, 500, 'Failed to get status: ' + error.message);
  }
}

module.exports = {
  handleGetStatus
};
