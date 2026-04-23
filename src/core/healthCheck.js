/**
 * Health Monitor for KeyProxy
 * Aggregates provider status from config, usage stats, history, and logs.
 */
const { maskApiKey } = require('./utils');
const { testGeminiKey, testOpenaiKey } = require('../routes/adminProviders');

class HealthMonitor {
  constructor(server) {
    this.server = server;
    this.timer = null;
    this.intervalMs = 5 * 60 * 1000; // 5 minutes
    this.statusCache = new Map();
    this.lastFullCheck = null;
    this.recoveryEnabled = true;
    this.recoveryCooldownMs = 5 * 60 * 1000; // 5 minutes base cooldown
    this.maxRecoveryAttempts = 5; // Stop auto-probing after this many failed recoveries
    this.backoffBaseMs = 5 * 60 * 1000; // Base cooldown for exponential backoff
    this.backoffMaxMs = 60 * 60 * 1000; // Cap at 1 hour
  }

  start(intervalMs) {
    if (intervalMs) this.intervalMs = intervalMs;

    // Read recovery config from env
    const envVars = this.server.config.envVars;
    this.recoveryEnabled = envVars.KEYPROXY_RECOVERY_ENABLED !== 'false';
    const cooldownSec = parseInt(envVars.KEYPROXY_RECOVERY_COOLDOWN_SEC) || 300;
    this.recoveryCooldownMs = cooldownSec * 1000;
    this.backoffBaseMs = this.recoveryCooldownMs;
    this.maxRecoveryAttempts = parseInt(envVars.KEYPROXY_RECOVERY_MAX_ATTEMPTS) || 5;
    this.backoffMaxMs = (parseInt(envVars.KEYPROXY_RECOVERY_BACKOFF_MAX_SEC) || 3600) * 1000;

    console.log(`[HEALTH] Monitor started (interval: ${this.intervalMs / 1000}s, recovery: ${this.recoveryEnabled ? cooldownSec + 's base cooldown, max ' + this.maxRecoveryAttempts + ' attempts, backoff cap ' + (this.backoffMaxMs / 1000) + 's' : 'disabled'})`);
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

    if (this.recoveryEnabled) {
      await this.recoverExhaustedKeys();
    }
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

  async recoverExhaustedKeys() {
    const providers = this.server.config.providers;
    const historyManager = this.server.historyManager;
    if (!historyManager) return;

    for (const [providerName, providerConfig] of providers.entries()) {
      if (providerConfig.disabled) continue;

      const allKeys = providerConfig.allKeys
        ? providerConfig.allKeys.map(k => k.key)
        : providerConfig.keys;

      // Get all exhausted keys including those past max attempts (for logging)
      const allExhausted = historyManager.getExhaustedKeys(
        providerName,
        0, // no minimum cooldown for listing
        allKeys,
        0  // no max attempt filter
      );

      for (const entry of allExhausted) {
        if (!entry.fullKey) continue;
        const masked = maskApiKey(entry.fullKey);
        const attempts = entry.recoveryAttempts || 0;

        // Skip keys that exceeded max recovery attempts
        if (attempts >= this.maxRecoveryAttempts) {
          continue;
        }

        // Exponential backoff: base * 2^attempts, capped at max
        const backoffMs = Math.min(this.backoffBaseMs * Math.pow(2, attempts), this.backoffMaxMs);
        const elapsed = Date.now() - new Date(entry.rotatedOutAt).getTime();

        if (elapsed < backoffMs) {
          continue; // Not yet time to probe this key
        }

        console.log(`[RECOVERY] Probing exhausted key ${masked} for '${providerName}' (attempt ${attempts + 1}/${this.maxRecoveryAttempts}, backoff ${Math.round(backoffMs / 1000)}s, exhausted ${Math.round(elapsed / 1000)}s ago)`);

        const result = await this.probeKey(providerName, providerConfig, entry.fullKey);
        if (result.success) {
          historyManager.recoverKey(providerName, entry.fullKey);
          console.log(`[RECOVERY] Key ${masked} recovered for '${providerName}' after ${attempts} failed attempts`);

          if (this.server.notifier) {
            this.server.notifier.send(`Key ${masked} recovered for '${providerName}' after ${attempts} failed attempts`, 'recovery');
          }
        } else {
          // Re-record exhaustion — this increments recoveryAttempts via the wasRecovery logic
          historyManager.recordKeyExhausted(providerName, entry.fullKey, entry.rotationReason || 'still-failing');
          const newAttempts = attempts + 1;
          const nextBackoff = Math.min(this.backoffBaseMs * Math.pow(2, newAttempts), this.backoffMaxMs);
          console.log(`[RECOVERY] Key ${masked} still exhausted for '${providerName}' (attempt ${newAttempts}/${this.maxRecoveryAttempts}, next probe in ${Math.round(nextBackoff / 1000)}s): ${result.error}`);

          if (newAttempts >= this.maxRecoveryAttempts && this.server.notifier) {
            this.server.notifier.send(`Key ${masked} for '${providerName}' reached max recovery attempts (${this.maxRecoveryAttempts}). Manual test required.`, 'recovery');
          }
        }
      }
    }
  }

  async probeKey(providerName, providerConfig, apiKey) {
    try {
      if (providerConfig.apiType === 'gemini') {
        return await testGeminiKey(this.server, apiKey, providerConfig.baseUrl);
      } else if (providerConfig.apiType === 'openai') {
        // Skip probe for providers without /models endpoint
        const skipDomains = ['firecrawl.dev', 'context7.com', 'ref.tools', 'tavily.com', 'jina.ai'];
        const baseUrl = providerConfig.baseUrl || '';
        if (skipDomains.some(d => baseUrl.includes(d))) {
          return { success: true };
        }
        return await testOpenaiKey(this.server, apiKey, providerConfig.baseUrl);
      }
      return { success: false, error: 'Unknown apiType' };
    } catch (err) {
      return { success: false, error: err.message };
    }
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
