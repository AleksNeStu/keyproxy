const crypto = require('crypto');

/**
 * In-memory LRU response cache for KeyProxy.
 * Caches successful responses keyed by hash(provider + model + messages).
 */

class ResponseCache {
  constructor(maxEntries = 1000, defaultTtlMs = 300000) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map(); // key -> { response, body, expiresAt }
    this.enabled = true;
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Generate cache key from request parameters.
   */
  generateKey(provider, method, path, body) {
    let model = '';
    let messages = '';
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      model = parsed.model || '';
      messages = parsed.messages ? JSON.stringify(parsed.messages) : '';
    } catch {}
    const raw = `${provider}:${method}:${path}:${model}:${messages}`;
    return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
  }

  /**
   * Look up a cached response.
   * Returns the cached entry or null.
   */
  get(provider, method, path, body) {
    if (!this.enabled) return null;

    const key = this.generateKey(provider, method, path, body);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    // Move to end (LRU refresh)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;
    return entry;
  }

  /**
   * Store a response in cache.
   */
  set(provider, method, path, body, response, ttlMs = null) {
    if (!this.enabled) return;
    if (response.statusCode >= 400) return; // Don't cache errors

    const key = this.generateKey(provider, method, path, body);
    const expiresAt = Date.now() + (ttlMs || this.defaultTtlMs);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
      this.stats.evictions++;
    }

    this.cache.set(key, {
      statusCode: response.statusCode,
      headers: { ...response.headers },
      data: response.data,
      cachedAt: Date.now(),
      expiresAt
    });
  }

  /**
   * Invalidate all entries for a provider.
   */
  invalidateProvider(provider) {
    for (const [key] of this.cache.entries()) {
      // We can't reverse-hash, so clear all on provider invalidation
      // This is fine — cache entries are short-lived
    }
    this.cache.clear();
  }

  /**
   * Clear the entire cache.
   */
  clear() {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, evictions: 0 };
  }

  /**
   * Get cache stats.
   */
  getStats() {
    return {
      enabled: this.enabled,
      size: this.cache.size,
      maxEntries: this.maxEntries,
      ttlMs: this.defaultTtlMs,
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(1) + '%'
        : '0%'
    };
  }

  configure({ enabled, maxEntries, ttlMs }) {
    if (enabled !== undefined) this.enabled = enabled;
    if (maxEntries !== undefined) this.maxEntries = maxEntries;
    if (ttlMs !== undefined) this.defaultTtlMs = ttlMs;
  }
}

module.exports = ResponseCache;
