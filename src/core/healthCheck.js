/**
 * Health Monitor for KeyProxy
 * Aggregates provider status from config, usage stats, history, and logs.
 */
class HealthMonitor {
  constructor(server) {
    this.server = server;
    this.timer = null;
    this.intervalMs = 5 * 60 * 1000; // 5 minutes
    this.statusCache = new Map();
    this.lastFullCheck = null;
  }

  start(intervalMs) {
    if (intervalMs) this.intervalMs = intervalMs;
    console.log(`[HEALTH] Monitor started (interval: ${this.intervalMs / 1000}s)`);
    this.checkAll();
    this.timer = setInterval(() => this.checkAll(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkAll() {
    const providers = this.server.config.providers;
    for (const [name] of providers.entries()) {
      this.checkProvider(name);
    }
    this.lastFullCheck = new Date().toISOString();
    console.log(`[HEALTH] Full check completed for ${providers.size} providers`);
  }

  checkProvider(providerName) {
    const config = this.server.config.getProvider(providerName);
    if (!config) return null;

    const client = this.server.providerClients.get(providerName);
    const status = {
      name: providerName,
      apiType: config.apiType,
      baseUrl: config.baseUrl,
      disabled: config.disabled || false,
      totalKeys: config.allKeys ? config.allKeys.length : config.keys.length,
      enabledKeys: config.keys.length,
      disabledKeys: (config.allKeys ? config.allKeys.length : config.keys.length) - config.keys.length,
      lastCheckTime: new Date().toISOString(),
      lastError: null,
      totalRequests: 0,
      avgResponseTime: 0,
      failedRequests: 0,
      status: 'unknown'
    };

    // Determine status from config
    if (config.disabled) {
      status.status = 'disabled';
    } else if (config.keys.length === 0) {
      status.status = 'failed';
      status.lastError = 'No enabled keys';
    }

    // Aggregate from keyRotator usage stats
    if (client && client.keyRotator) {
      const usageStats = client.keyRotator.getKeyUsageStats(providerName);
      let exhaustedCount = 0;
      let freshCount = 0;
      let activeCount = 0;

      for (const stat of usageStats) {
        status.totalRequests += stat.usageCount;
        if (stat.status === 'exhausted') exhaustedCount++;
        else if (stat.status === 'active') activeCount++;
        else if (stat.status === 'fresh') freshCount++;
      }

      status.exhaustedKeys = exhaustedCount;
      status.freshKeys = freshCount;
      status.activeKeys = activeCount;

      if (status.status !== 'disabled' && status.enabledKeys > 0) {
        if (exhaustedCount >= status.enabledKeys) {
          status.status = 'failed';
          status.lastError = 'All keys exhausted';
        } else if (exhaustedCount > 0) {
          status.status = 'degraded';
        } else {
          status.status = 'active';
        }
      }
    }

    // Aggregate from log buffer
    const providerLogs = this.server.logBuffer.filter(l => l.provider === providerName);
    if (providerLogs.length > 0) {
      const recent = providerLogs.slice(-50);
      const totalTime = recent.reduce((sum, l) => sum + (l.responseTime || 0), 0);
      status.avgResponseTime = Math.round(totalTime / recent.length);
      status.failedRequests = recent.filter(l => l.statusCode >= 400).length;
      status.lastRequestTime = recent[recent.length - 1]?.timestamp || null;

      // Last error from logs
      const errorLog = [...recent].reverse().find(l => l.statusCode >= 400);
      if (errorLog) {
        status.lastError = `HTTP ${errorLog.statusCode}`;
      }
    }

    this.statusCache.set(providerName, status);
    return status;
  }

  getProviderStatus(providerName) {
    if (this.statusCache.has(providerName)) {
      return this.statusCache.get(providerName);
    }
    return this.checkProvider(providerName);
  }

  getAllStatuses() {
    const providers = this.server.config.providers;
    for (const [name] of providers.entries()) {
      if (!this.statusCache.has(name)) {
        this.checkProvider(name);
      }
    }
    return Array.from(this.statusCache.values());
  }

  getSummary() {
    const statuses = this.getAllStatuses();
    return {
      total: statuses.length,
      active: statuses.filter(s => s.status === 'active').length,
      degraded: statuses.filter(s => s.status === 'degraded').length,
      failed: statuses.filter(s => s.status === 'failed').length,
      disabled: statuses.filter(s => s.status === 'disabled').length,
      lastFullCheck: this.lastFullCheck
    };
  }
}

module.exports = HealthMonitor;
