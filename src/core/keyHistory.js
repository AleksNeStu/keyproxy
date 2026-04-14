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
        status: 'fresh',
        lastUsed: null,
        rotatedOutAt: null,
        rotationReason: null,
        rotationCount: 0
      };
    }
    return provider.keys[hash];
  }

  // --- Public API ---

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
    entry.status = 'exhausted';
    entry.rotatedOutAt = new Date().toISOString();
    entry.rotationReason = String(statusCode);
    entry.rotationCount = (entry.rotationCount || 0) + 1;
    this._scheduleSave();
  }

  /**
   * Get status for a single key
   */
  getKeyStatus(providerName, fullKey) {
    const hash = this.hashKey(fullKey);
    const provider = this.data.providers[providerName];
    if (!provider || !provider.keys[hash]) return { status: 'fresh' };
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
