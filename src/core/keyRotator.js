class KeyRotator {
  constructor(apiKeys, apiType = 'unknown', systemEnvName = null, historyManager = null) {
    this.apiKeys = [...apiKeys];
    this.apiType = apiType;
    this.systemEnvName = systemEnvName;
    this.historyManager = historyManager;
    this.activeKey = null; // Currently synced system-wide key
    this.lastFailedKey = null; // Track the key that failed in the last request
    this.keyUsageCount = new Map(); // Track per-key usage count
    // Initialize usage counts for all keys
    for (const key of this.apiKeys) {
      this.keyUsageCount.set(key, 0);
    }

    let logMsg = `[${apiType.toUpperCase()}-ROTATOR] Initialized with ${this.apiKeys.length} API keys`;
    if (systemEnvName) logMsg += ` (Syncing to System Env: ${systemEnvName})`;
    if (historyManager) logMsg += ` (History tracking enabled)`;
    console.log(logMsg);
  }

  /**
   * Synchronize the key to system environment variables if it changed
   * @param {string} key 
   */
  async syncIfChanged(key) {
    if (!this.systemEnvName || !key) return;
    if (key === this.activeKey) return;

    // Pointing to the new Destination module
    const WindowsEnv = require('../destinations/windowsEnv');
    try {
      await WindowsEnv.setEnvVar(this.systemEnvName, key);
      this.activeKey = key;
    } catch (error) {
      // Error handled in windowsEnv
    }
  }

  /**
   * Creates a new request context for per-request key rotation with smart shuffling
   * @returns {RequestKeyContext} A new context for managing keys for a single request
   */
  createRequestContext() {
    return new RequestKeyContext(this.apiKeys, this.apiType, this.lastFailedKey);
  }

  /**
   * Updates the last failed key from the completed request
   * @param {string|null} failedKey The key that failed in the last request, or null if no key failed
   */
  updateLastFailedKey(failedKey) {
    this.lastFailedKey = failedKey;
    if (failedKey) {
      const maskedKey = this.maskApiKey(failedKey);
      console.log(`[${this.apiType.toUpperCase()}-ROTATOR] Last failed key updated: ${maskedKey}`);
    }
  }

  /**
   * Increment usage count for a key (called on successful use)
   */
  async incrementKeyUsage(key) {
    if (this.keyUsageCount.has(key)) {
      this.keyUsageCount.set(key, this.keyUsageCount.get(key) + 1);
    }

    // Auto-sync to system environment if this is the new active/successful key
    await this.syncIfChanged(key);
  }

  /**
   * Record a rotation event: a key was exhausted and a new one is being tried.
   * Called by client classes after markKeyAsRateLimited().
   */
  recordRotationEvent(providerName, fullKey, statusCode) {
    if (!this.historyManager) return;
    this.historyManager.recordKeyExhausted(providerName, fullKey, statusCode);
  }

  /**
   * Record a successful key use (marks key as active in history).
   * Called by client classes when a request succeeds.
   */
  recordSuccessEvent(providerName, fullKey) {
    if (!this.historyManager) return;
    this.historyManager.recordKeyActive(providerName, fullKey);
  }

  /**
   * Get usage statistics for all keys, including history status if available
   */
  getKeyUsageStats(providerName = null) {
    const stats = [];
    for (const key of this.apiKeys) {
      const entry = {
        key: this.maskApiKey(key),
        fullKey: key,
        usageCount: this.keyUsageCount.get(key) || 0
      };
      if (this.historyManager && providerName) {
        const status = this.historyManager.getKeyStatus(providerName, key);
        entry.status = status.status;
        entry.rotatedOutAt = status.rotatedOutAt;
        entry.rotationReason = status.rotationReason;
        entry.rotationCount = status.rotationCount;
      }
      stats.push(entry);
    }
    return stats;
  }

  getTotalKeysCount() {
    return this.apiKeys.length;
  }

  maskApiKey(key) {
    if (!key || key.length < 8) return '***';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
  }
}

/**
 * Manages API key rotation for a single request
 * Each request gets its own context to try all available keys with smart shuffling
 */
class RequestKeyContext {
  constructor(apiKeys, apiType, lastFailedKey = null) {
    this.originalApiKeys = [...apiKeys];
    this.apiType = apiType;
    this.currentIndex = 0;
    this.triedKeys = new Set();
    this.rateLimitedKeys = new Set();
    this.lastFailedKeyForThisRequest = null;
    
    // Apply smart shuffling: shuffle keys but move last failed key to end
    this.apiKeys = this.smartShuffle(apiKeys, lastFailedKey);
    
    if (lastFailedKey) {
      const maskedKey = this.maskApiKey(lastFailedKey);
      console.log(`[${this.apiType.toUpperCase()}] Smart shuffle applied - last failed key ${maskedKey} moved to end`);
    }
  }
  
  /**
   * Smart shuffle: randomize key order but move last failed key to the end
   * @param {Array} keys Array of API keys
   * @param {string|null} lastFailedKey The key that failed in the previous request
   * @returns {Array} Shuffled array with last failed key at the end
   */
  smartShuffle(keys, lastFailedKey) {
    const shuffled = [...keys];
    
    // Fisher-Yates shuffle algorithm
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    // If we have a last failed key, move it to the end
    if (lastFailedKey && keys.includes(lastFailedKey)) {
      const failedKeyIndex = shuffled.indexOf(lastFailedKey);
      if (failedKeyIndex !== -1) {
        // Remove the failed key from its current position
        shuffled.splice(failedKeyIndex, 1);
        // Add it to the end
        shuffled.push(lastFailedKey);
      }
    }
    
    return shuffled;
  }

  /**
   * Gets the next available key to try for this request
   * @returns {string|null} The next API key to try, or null if all keys have been tried
   */
  getNextKey() {
    // If we've tried all keys, return null
    if (this.triedKeys.size >= this.apiKeys.length) {
      return null;
    }

    // Find the next untried key
    let attempts = 0;
    while (attempts < this.apiKeys.length) {
      const key = this.apiKeys[this.currentIndex];
      
      if (!this.triedKeys.has(key)) {
        this.triedKeys.add(key);
        const maskedKey = this.maskApiKey(key);
        console.log(`[${this.apiType.toUpperCase()}::${maskedKey}] Trying key (${this.triedKeys.size}/${this.apiKeys.length} tried for this request)`);
        return key;
      }
      
      this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
      attempts++;
    }
    
    return null;
  }

  /**
   * Marks the current key as rate limited for this request
   * @param {string} key The API key that was rate limited
   */
  markKeyAsRateLimited(key) {
    this.rateLimitedKeys.add(key);
    this.lastFailedKeyForThisRequest = key; // Track the most recent failed key
    const maskedKey = this.maskApiKey(key);
    console.log(`[${this.apiType.toUpperCase()}::${maskedKey}] Rate limited for this request (${this.rateLimitedKeys.size}/${this.triedKeys.size} rate limited)`);
    
    // Move to next key for the next attempt
    this.currentIndex = (this.currentIndex + 1) % this.apiKeys.length;
  }

  /**
   * Gets the key that failed most recently in this request (for updating global state)
   * @returns {string|null} The last key that was rate limited in this request
   */
  getLastFailedKey() {
    return this.lastFailedKeyForThisRequest;
  }

  /**
   * Checks if all tried keys were rate limited
   * @returns {boolean} True if all keys that were tried returned 429
   */
  allTriedKeysRateLimited() {
    return this.triedKeys.size > 0 && this.rateLimitedKeys.size === this.triedKeys.size;
  }

  /**
   * Checks if all available keys have been tried
   * @returns {boolean} True if all keys have been attempted
   */
  allKeysTried() {
    return this.triedKeys.size >= this.apiKeys.length;
  }

  /**
   * Gets statistics about this request's key usage
   * @returns {object} Statistics object
   */
  getStats() {
    return {
      totalKeys: this.apiKeys.length,
      triedKeys: this.triedKeys.size,
      rateLimitedKeys: this.rateLimitedKeys.size,
      hasUntriedKeys: this.triedKeys.size < this.apiKeys.length
    };
  }

  maskApiKey(key) {
    if (!key || key.length < 8) return '***';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
  }
}

module.exports = KeyRotator;
