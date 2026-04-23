const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const KeyRotator = require('../../src/core/keyRotator');

describe('KeyRotator', () => {
  describe('round-robin strategy', () => {
    it('returns all keys (shuffled order, not sequential)', () => {
      const rotator = new KeyRotator(['key1', 'key2', 'key3'], 'test');
      const ctx = rotator.createRequestContext();

      const keys = [];
      let key;
      while ((key = ctx.getNextKey()) !== null) {
        keys.push(key);
      }

      assert.equal(keys.length, 3);
      assert.ok(keys.includes('key1'));
      assert.ok(keys.includes('key2'));
      assert.ok(keys.includes('key3'));
    });

    it('returns null after all keys are tried', () => {
      const rotator = new KeyRotator(['k1', 'k2'], 'test');
      const ctx = rotator.createRequestContext();

      ctx.getNextKey();
      ctx.getNextKey();
      assert.equal(ctx.getNextKey(), null);
    });
  });

  describe('weighted-random strategy', () => {
    it('initializes with default weight 1 for all keys', () => {
      const rotator = new KeyRotator(['a', 'b'], 'test', null, null, 'weighted-random');
      assert.equal(rotator.keyWeights.get('a'), 1);
      assert.equal(rotator.keyWeights.get('b'), 1);
    });

    it('allows setting custom weights', () => {
      const rotator = new KeyRotator(['a', 'b'], 'test', null, null, 'weighted-random');
      rotator.keyWeights.set('a', 10);
      rotator.keyWeights.set('b', 1);

      let countA = 0;
      for (let i = 0; i < 100; i++) {
        const ctx = rotator.createRequestContext();
        while (true) {
          const key = ctx.getNextKey();
          if (key === null) break;
          if (key === 'a') countA++;
        }
      }
      assert.ok(countA > 70, `Expected a >70 times, got ${countA}`);
    });
  });

  describe('key usage tracking', () => {
    it('tracks incrementKeyUsage', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 'test');
      rotator.incrementKeyUsage('key1');
      rotator.incrementKeyUsage('key1');
      rotator.incrementKeyUsage('key2');

      assert.equal(rotator.keyUsageCount.get('key1'), 2);
      assert.equal(rotator.keyUsageCount.get('key2'), 1);
    });
  });

  describe('RequestKeyContext', () => {
    it('tracks rate-limited keys and tries remaining keys', () => {
      const rotator = new KeyRotator(['k1', 'k2', 'k3'], 'test');
      const ctx = rotator.createRequestContext();

      const tried = [];
      let key;
      while ((key = ctx.getNextKey()) !== null) {
        tried.push(key);
        ctx.markKeyAsRateLimited(key);
      }

      assert.equal(tried.length, 3);
      assert.ok(tried.includes('k1'));
      assert.ok(tried.includes('k2'));
      assert.ok(tried.includes('k3'));
    });

    it('reports all rate limited correctly', () => {
      const rotator = new KeyRotator(['k1', 'k2'], 'test');
      const ctx = rotator.createRequestContext();

      ctx.markKeyAsRateLimited(ctx.getNextKey());
      ctx.markKeyAsRateLimited(ctx.getNextKey());

      assert.ok(ctx.allTriedKeysRateLimited());
    });

    it('getStats returns correct counts', () => {
      const rotator = new KeyRotator(['k1', 'k2', 'k3'], 'test');
      const ctx = rotator.createRequestContext();

      ctx.markKeyAsRateLimited(ctx.getNextKey());
      ctx.getNextKey(); // k2, not rate limited

      const stats = ctx.getStats();
      assert.equal(stats.totalKeys, 3);
      assert.equal(stats.rateLimitedKeys, 1);
    });
  });
});
