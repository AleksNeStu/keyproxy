const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ResponseCache = require('../../src/core/cache');

describe('ResponseCache', () => {
  let cache;

  beforeEach(() => {
    cache = new ResponseCache(5, 60000);
  });

  describe('constructor', () => {
    it('uses default values when no arguments', () => {
      const c = new ResponseCache();
      assert.equal(c.maxEntries, 1000);
      assert.equal(c.defaultTtlMs, 300000);
      assert.equal(c.enabled, true);
      assert.equal(c.cache.size, 0);
    });

    it('accepts custom maxEntries and defaultTtlMs', () => {
      const c = new ResponseCache(50, 120000);
      assert.equal(c.maxEntries, 50);
      assert.equal(c.defaultTtlMs, 120000);
    });

    it('initializes stats to zero', () => {
      assert.equal(cache.stats.hits, 0);
      assert.equal(cache.stats.misses, 0);
      assert.equal(cache.stats.evictions, 0);
    });
  });

  describe('generateKey', () => {
    it('produces a 32-char hex string', () => {
      const key = cache.generateKey('openai', 'POST', '/v1/chat/completions', '{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}');
      assert.match(key, /^[0-9a-f]{32}$/);
    });

    it('produces different keys for different providers', () => {
      const k1 = cache.generateKey('openai', 'POST', '/v1/chat', '{}');
      const k2 = cache.generateKey('anthropic', 'POST', '/v1/chat', '{}');
      assert.notEqual(k1, k2);
    });

    it('produces different keys for different bodies', () => {
      const k1 = cache.generateKey('openai', 'POST', '/v1/chat', '{"model":"gpt-4"}');
      const k2 = cache.generateKey('openai', 'POST', '/v1/chat', '{"model":"gpt-3.5"}');
      assert.notEqual(k1, k2);
    });

    it('handles string body', () => {
      const key = cache.generateKey('openai', 'POST', '/v1/chat', '{"model":"gpt-4"}');
      assert.ok(key.length === 32);
    });

    it('handles object body', () => {
      const key = cache.generateKey('openai', 'POST', '/v1/chat', { model: 'gpt-4' });
      assert.ok(key.length === 32);
    });

    it('handles null/undefined body gracefully', () => {
      const key = cache.generateKey('openai', 'POST', '/v1/chat', null);
      assert.ok(key.length === 32);
    });

    it('handles invalid JSON string body', () => {
      const key = cache.generateKey('openai', 'POST', '/v1/chat', 'not-json');
      assert.ok(key.length === 32);
    });
  });

  describe('get and set', () => {
    it('returns null on cache miss', () => {
      const result = cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(result, null);
      assert.equal(cache.stats.misses, 1);
    });

    it('stores and retrieves a response', () => {
      const response = { statusCode: 200, headers: { 'content-type': 'application/json' }, data: 'ok' };
      cache.set('openai', 'POST', '/v1/chat', '{"model":"gpt-4"}', response);

      const entry = cache.get('openai', 'POST', '/v1/chat', '{"model":"gpt-4"}');
      assert.ok(entry);
      assert.equal(entry.statusCode, 200);
      assert.equal(entry.data, 'ok');
      assert.equal(cache.stats.hits, 1);
    });

    it('does not cache error responses (statusCode >= 400)', () => {
      const response = { statusCode: 500, headers: {}, data: 'error' };
      cache.set('openai', 'POST', '/v1/chat', '{}', response);

      const entry = cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(entry, null);
    });

    it('does not cache when disabled', () => {
      cache.enabled = false;
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/v1/chat', '{}', response);

      cache.enabled = true;
      const entry = cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(entry, null);
    });

    it('returns null when cache is disabled on get', () => {
      cache.enabled = false;
      const result = cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(result, null);
    });

    it('respects custom TTL', async function() {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/v1/chat', '{}', response, 10); // expires in 10ms

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 20));

      const entry = cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(entry, null);
      assert.equal(cache.stats.misses, 1);
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when at maxEntries', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };

      // Fill cache to maxEntries
      for (let i = 0; i < 5; i++) {
        cache.set('prov', 'POST', `/path${i}`, `{"i":${i}}`, response);
      }

      assert.equal(cache.cache.size, 5);

      // Add one more - should evict the oldest
      cache.set('prov', 'POST', '/pathExtra', '{"extra":true}', response);

      assert.equal(cache.cache.size, 5);
      assert.equal(cache.stats.evictions, 1);

      // First entry should be evicted
      const evicted = cache.get('prov', 'POST', '/path0', '{"i":0}');
      assert.equal(evicted, null);
    });

    it('refreshes LRU position on get', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };

      for (let i = 0; i < 5; i++) {
        cache.set('prov', 'POST', `/path${i}`, `{"i":${i}}`, response);
      }

      // Access the first entry to refresh it
      cache.get('prov', 'POST', '/path0', '{"i":0}');

      // Now add a new entry - /path1 should be evicted (oldest unaccessed)
      cache.set('prov', 'POST', '/pathExtra', '{"extra":true}', response);

      const path0 = cache.get('prov', 'POST', '/path0', '{"i":0}');
      const path1 = cache.get('prov', 'POST', '/path1', '{"i":1}');

      assert.ok(path0, '/path0 should still exist (was refreshed)');
      assert.equal(path1, null, '/path1 should be evicted');
    });
  });

  describe('TTL expiry', () => {
    it('returns null for expired entries', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/v1/chat', '{}', response, 1); // 1ms TTL

      // Wait a tiny bit for expiry
      const start = Date.now();
      while (Date.now() - start < 5) {} // busy-wait 5ms

      const entry = cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(entry, null);
    });

    it('counts expired entries as misses', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/v1/chat', '{}', response, 1);

      const start = Date.now();
      while (Date.now() - start < 5) {}

      cache.get('openai', 'POST', '/v1/chat', '{}');
      assert.equal(cache.stats.misses, 1);
    });
  });

  describe('invalidateProvider', () => {
    it('removes all entries for a specific provider', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/a', '{}', response);
      cache.set('openai', 'POST', '/b', '{}', response);
      cache.set('anthropic', 'POST', '/c', '{}', response);

      cache.invalidateProvider('openai');

      assert.equal(cache.cache.size, 1);
      assert.ok(cache.get('anthropic', 'POST', '/c', '{}'));
    });

    it('does nothing for non-existent provider', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/a', '{}', response);
      cache.invalidateProvider('nonexistent');
      assert.equal(cache.cache.size, 1);
    });
  });

  describe('clear', () => {
    it('clears all entries and resets stats', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/a', '{}', response);
      cache.get('openai', 'POST', '/a', '{}');
      cache.get('openai', 'POST', '/b', '{}');

      cache.clear();

      assert.equal(cache.cache.size, 0);
      assert.equal(cache.stats.hits, 0);
      assert.equal(cache.stats.misses, 0);
      assert.equal(cache.stats.evictions, 0);
    });
  });

  describe('getStats', () => {
    it('returns correct stats object', () => {
      const response = { statusCode: 200, headers: {}, data: 'ok' };
      cache.set('openai', 'POST', '/a', '{}', response);
      cache.get('openai', 'POST', '/a', '{}'); // hit
      cache.get('openai', 'POST', '/b', '{}'); // miss

      const stats = cache.getStats();
      assert.equal(stats.enabled, true);
      assert.equal(stats.size, 1);
      assert.equal(stats.maxEntries, 5);
      assert.equal(stats.ttlMs, 60000);
      assert.equal(stats.hits, 1);
      assert.equal(stats.misses, 1);
      assert.equal(stats.hitRate, '50.0%');
    });

    it('returns 0% hit rate when no requests', () => {
      const stats = cache.getStats();
      assert.equal(stats.hitRate, '0%');
    });
  });

  describe('configure', () => {
    it('updates enabled flag', () => {
      cache.configure({ enabled: false });
      assert.equal(cache.enabled, false);
    });

    it('updates maxEntries', () => {
      cache.configure({ maxEntries: 100 });
      assert.equal(cache.maxEntries, 100);
    });

    it('updates ttlMs', () => {
      cache.configure({ ttlMs: 10000 });
      assert.equal(cache.defaultTtlMs, 10000);
    });

    it('only updates provided fields', () => {
      const origMax = cache.maxEntries;
      cache.configure({ enabled: false });
      assert.equal(cache.maxEntries, origMax);
    });
  });
});
