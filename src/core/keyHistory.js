const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * KeyHistoryManager - Persistent key rotation history
 *
 * Tracks which keys have been rotated out (exhausted), which are active,
 * and which are fresh. Data persists across server restarts via JSON file.
 * Keys are stored as SHA-256 hashes (never raw API keys).
 */
class KeyHistoryManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'key-history.json');
    this.data = { providers: {} };
    this.saveTimer = null;
    this.saveDelay = 3000; // 3s debounce
    this.dirty = false;

    this._load();
  }

  // --- Persistence ---

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        if (!this.data.providers) this.data.providers = {};
        const count = Object.keys(this.data.providers).length;
        console.log(`[HISTORY] Loaded ${count} provider history entries`);
      }
    } catch (err) {
      console.log(`[HISTORY] Could not load history file, starting fresh: ${err.message}`);
      this.data = { providers: {} };
    }
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._flush();
    }, this.saveDelay);
  }

  _flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.log(`[HISTORY] Write failed: ${err.message}`);
    }
  }

  flushSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = true;
    this._flush();
  }

  // --- Hashing ---

  hashKey(key) {
    return crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  // --- Provider helpers ---

  _ensureProvider(providerName) {
    if (!this.data.providers[providerName]) {
      this.data.providers[providerName] = { keys: {} };
    }
    return this.data.providers[providerName];
  }

  _ensureKeyEntry(providerName, hash) {
    const provider = this._ensureProvider(providerName);
    if (!provider.keys[hash]) {
      provider.keys[hash] = {
        status: 'unverified',
        lastUsed: null,
        rotatedOutAt: null,
        rotationReason: null,
        rotationCount: 0,
        recoveryAttempts: 0,
        lastRecoveryAttempt: null,
        lastCheckTime: null
      };
    }
    return provider.keys[hash];
  }

  // --- Public API ---

  /**
   * Mark a key as verified (tested successfully).
   */
  recordKeyVerified(providerName, fullKey) {
    const hash = this.hashKey(fullKey);
    const entry = this._ensureKeyEntry(providerName, hash);
    entry.status = 'verified';
    entry.lastCheckTime = new Date().toISOString();
    this._scheduleSave();
  }

  /**
   * Mark a key as failed (tested and not working).
   */
  recordKeyFailed(providerName, fullKey, reason) {
    const hash = this.hashKey(fullKey);
    const entry = this._ensureKeyEntry(providerName, hash);
    entry.status = 'failed';
    entry.lastCheckTime = new Date().toISOString();
    if (reason) entry.lastFailReason = reason;
    this._scheduleSave();
  }

  /**
   * Get key counts by status for a provider.
   * Returns { total, active, verified, unverified, failed, exhausted, fresh }
   */
  getKeyCounts(providerName) {
    const provider = this.data.providers[providerName];
    const counts = { total: 0, active: 0, verified: 0, unverified: 0, failed: 0, exhausted: 0, fresh: 0 };
    if (!provider) return counts;

    for (const entry of Object.values(provider.keys)) {
      counts.total++;
      const status = entry.status || 'unverified';
      // Map 'fresh' to 'unverified' for backward compat
      const normalized = status === 'fresh' ? 'unverified' : status;
      if (counts[normalized] !== undefined) counts[normalized]++;
    }
    return counts;
  }

  /**
   * Mark a key as currently active (in-use / live)
   */
  recordKeyActive(providerName, fullKey) {
    const hash = this.hashKey(fullKey);
    const entry = this._ensureKeyEntry(providerName, hash);
    entry.status = 'active';
    entry.lastUsed = new Date().toISOString();
    this._scheduleSave();
  }

  /**
   * Mark a key as exhausted (rotated out due to rate limit / error)
   */
  recordKeyExhausted(providerName, fullKey, statusCode) {
    const hash = this.hashKey(fullKey);
    const entry = this._ensureKeyEntry(providerName, hash);
    const wasRecovery = entry.status === 'exhausted' && entry.lastRecoveryAttempt;
    entry.status = 'exhausted';
    entry.rotatedOutAt = new Date().toISOString();
    entry.rotationReason = String(statusCode);
    entry.rotationCount = (entry.rotationCount || 0) + 1;
    if (wasRecovery) {
      entry.recoveryAttempts = (entry.recoveryAttempts || 0) + 1;
      entry.lastRecoveryAttempt = new Date().toISOString();
    }
    this._scheduleSave();
  }

  /**
   * Get status for a single key
   */
  getKeyStatus(providerName, fullKey) {
    const hash = this.hashKey(fullKey);
    const provider = this.data.providers[providerName];
    if (!provider || !provider.keys[hash]) return { status: 'unverified' };
    return { ...provider.keys[hash] };
  }

  /**
   * Get all key statuses for a provider, keyed by hash
   */
  getProviderHistory(providerName) {
    const provider = this.data.providers[providerName];
    if (!provider) return {};
    const result = {};
    for (const [hash, entry] of Object.entries(provider.keys)) {
      result[hash] = { ...entry };
    }
    return result;
  }

  /**
   * Get all provider histories
   */
  getAllHistory() {
    const result = {};
    for (const [name, provider] of Object.entries(this.data.providers)) {
      result[name] = {};
      for (const [hash, entry] of Object.entries(provider.keys)) {
        result[name][hash] = { ...entry };
      }
    }
    return result;
  }

  /**
   * Reconcile known keys with history. Marks unknown keys as fresh,
   * removes keys no longer in the provider's config.
   */
  syncProviderKeys(providerName, allFullKeys) {
    const provider = this._ensureProvider(providerName);
    const currentHashes = new Set(allFullKeys.map(k => this.hashKey(k)));

    // Add entries for any keys not yet tracked
    for (const key of allFullKeys) {
      this._ensureKeyEntry(providerName, this.hashKey(key));
    }

    // Remove entries for keys no longer in config
    for (const hash of Object.keys(provider.keys)) {
      if (!currentHashes.has(hash)) {
        delete provider.keys[hash];
      }
    }

    this._scheduleSave();
  }

  /**
   * Reset history for a specific provider
   */
  resetProvider(providerName) {
    if (this.data.providers[providerName]) {
      delete this.data.providers[providerName];
      this._scheduleSave();
    }
  }

  /**
   * Reset all history
   */
  resetAll() {
    this.data = { providers: {} };
    this._scheduleSave();
  }

  /**
   * Get exhausted keys for a provider that are past the cooldown period.
   * Returns array of { hash, fullKey (if mapped), rotatedOutAt, rotationReason }
   * @param {string} providerName
   * @param {number} cooldownMs - minimum time since exhaustion in milliseconds
   * @param {string[]} [allFullKeys] - optional: full keys to resolve hashes back
   */
  getExhaustedKeys(providerName, cooldownMs, allFullKeys = [], maxRecoveryAttempts = 0) {
    const provider = this.data.providers[providerName];
    if (!provider) return [];

    const now = Date.now();
    const hashToKey = new Map();
    for (const key of allFullKeys) {
      hashToKey.set(this.hashKey(key), key);
    }

    const result = [];
    for (const [hash, entry] of Object.entries(provider.keys)) {
      if (entry.status !== 'exhausted' || !entry.rotatedOutAt) continue;
      // Skip keys that exceeded max recovery attempts (0 = no limit)
      if (maxRecoveryAttempts > 0 && (entry.recoveryAttempts || 0) >= maxRecoveryAttempts) continue;
      const elapsed = now - new Date(entry.rotatedOutAt).getTime();
      if (elapsed >= cooldownMs) {
        result.push({
          hash,
          fullKey: hashToKey.get(hash) || null,
          rotatedOutAt: entry.rotatedOutAt,
          rotationReason: entry.rotationReason,
          rotationCount: entry.rotationCount || 0,
          recoveryAttempts: entry.recoveryAttempts || 0
        });
      }
    }
    return result;
  }

  /**
   * Mark a previously exhausted key as recovered (active again)
   */
  recoverKey(providerName, fullKey) {
    const hash = this.hashKey(fullKey);
    const provider = this.data.providers[providerName];
    if (!provider || !provider.keys[hash]) return false;
    const entry = provider.keys[hash];
    if (entry.status !== 'exhausted') return false;

    entry.status = 'active';
    entry.rotatedOutAt = null;
    entry.rotationReason = null;
    entry.lastUsed = new Date().toISOString();
    entry.recoveryAttempts = 0;
    entry.lastRecoveryAttempt = null;
    this._scheduleSave();
    return true;
  }

  /**
   * Reset recovery attempts for a key (for manual test/reset from UI).
   * Returns true if the key was found and reset.
   */
  resetRecoveryAttempts(providerName, fullKey) {
    const hash = this.hashKey(fullKey);
    const provider = this.data.providers[providerName];
    if (!provider || !provider.keys[hash]) return false;
    const entry = provider.keys[hash];
    entry.recoveryAttempts = 0;
    entry.lastRecoveryAttempt = null;
    this._scheduleSave();
    return true;
  }

  /**
   * Build a lookup map: hash -> status for a provider (convenience for UI)
   */
  getStatusMap(providerName, allFullKeys) {
    const map = {};
    for (const key of allFullKeys) {
      const hash = this.hashKey(key);
      const status = this.getKeyStatus(providerName, key);
      map[key] = { hash, ...status };
    }
    return map;
  }
}

module.exports = KeyHistoryManager;
