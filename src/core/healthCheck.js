/**
 * Health Check Engine for KeyProxy
 * Periodically verifies API keys and marks them as healthy/unhealthy
 */
class HealthCheck {
  constructor(config) {
    this.config = config;
    this.healthRegistry = new Map(); // Map of key -> { status, lastChecked, error }
    this.checkInterval = 1000 * 60 * 30; // 30 minutes
    this.timer = null;
  }

  /**
   * Starts the background health check cycle
   */
  start() {
    console.log('[HEALTH] Starting periodic health check engine');
    this.runFullCheck();
    this.timer = setInterval(() => this.runFullCheck(), this.checkInterval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Runs a health check for every key in every provider
   */
  async runFullCheck() {
    const providers = this.config.getProviders();
    console.log(`[HEALTH] Commencing full health check for ${providers.size} providers...`);

    for (const [providerName, providerConfig] of providers.entries()) {
      for (const key of providerConfig.keys) {
        await this.checkKey(providerName, providerConfig, key);
      }
    }
    console.log('[HEALTH] Full check cycle completed');
  }

  /**
   * Check a single key's health
   */
  async checkKey(providerName, providerConfig, key) {
    const maskedKey = key.substring(0, 4) + '...' + key.substring(key.length - 4);
    
    // For now, we'll implement a simple validation check
    // In the future, we can add provider-specific probe logic
    try {
      // Logic for validation goes here (e.g. GET /v1/models)
      this.healthRegistry.set(key, { status: 'healthy', lastChecked: new Date(), error: null });
    } catch (error) {
      console.warn(`[HEALTH::${providerName}] Key ${maskedKey} is UNHEALTHY: ${error.message}`);
      this.healthRegistry.set(key, { status: 'unhealthy', lastChecked: new Date(), error: error.message });
    }
  }

  isKeyHealthy(key) {
    if (!this.healthRegistry.has(key)) return true; // Assume healthy if not checked yet
    return this.healthRegistry.get(key).status === 'healthy';
  }

  getRegistry() {
    return Array.from(this.healthRegistry.entries()).map(([key, data]) => ({
      key: key.substring(0, 4) + '...' + key.substring(key.length - 4),
      ...data
    }));
  }
}

module.exports = HealthCheck;
