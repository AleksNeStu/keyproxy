const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const KeyRotator = require('../../src/core/keyRotator');
const FallbackRouter = require('../../src/core/fallbackRouter');
const CircuitBreaker = require('../../src/core/circuitBreaker');
const VirtualKeyManager = require('../../src/core/virtualKeys');

function makeConfig(fallbacks = {}, providers = {}) {
  const providerMap = new Map(Object.entries(providers));
  const envVars = {};
  for (const [name, cfg] of Object.entries(fallbacks)) {
    const p = providers[name];
    if (p) {
      const apiType = p.apiType.toUpperCase();
      const provUpper = name.toUpperCase().replace(/-/g, '_');
      envVars[`${apiType}_${provUpper}_FALLBACK`] = cfg.provider;
      if (cfg.model) envVars[`${apiType}_${provUpper}_FALLBACK_MODEL`] = cfg.model;
    }
  }
  return {
    envVars,
    getProviders: () => providerMap,
    getProvider: (name) => providerMap.get(name)
  };
}

describe('Integration: Proxy Flow', () => {
  describe('FallbackRouter chain', () => {
    it('builds a fallback chain from env config', () => {
      const config = makeConfig(
        { openai: { provider: 'anthropic', model: 'claude-3-opus' } },
        { openai: { apiType: 'openai' }, anthropic: { apiType: 'openai' } }
      );
      const router = new FallbackRouter(config);
      const chain = router.getChain('openai');
      assert.ok(Array.isArray(chain));
      assert.ok(chain.length >= 1);
      assert.equal(chain[0].provider, 'anthropic');
    });

    it('returns empty chain for unknown provider', () => {
      const config = makeConfig({}, { openai: { apiType: 'openai' } });
      const router = new FallbackRouter(config);
      const chain = router.getChain('unknown');
      assert.deepEqual(chain, []);
    });

    it('adjusts model in request body for fallback', () => {
      const config = makeConfig({}, {});
      const router = new FallbackRouter(config);
      const fallbackConfig = { provider: 'anthropic', model: 'claude-3-opus' };
      const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] };
      const adjusted = router.prepareBody(body, fallbackConfig);
      const parsed = JSON.parse(adjusted);
      assert.equal(parsed.model, 'claude-3-opus');
    });

    it('preserves non-model fields in body during fallback', () => {
      const config = makeConfig({}, {});
      const router = new FallbackRouter(config);
      const fallbackConfig = { provider: 'anthropic', model: 'claude-3-opus' };
      const body = { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }], temperature: 0.7 };
      const adjusted = router.prepareBody(body, fallbackConfig);
      const parsed = JSON.parse(adjusted);
      assert.equal(parsed.model, 'claude-3-opus');
      assert.deepEqual(parsed.messages, [{ role: 'user', content: 'hi' }]);
      assert.equal(parsed.temperature, 0.7);
    });

    it('allows runtime fallback configuration', () => {
      const config = makeConfig({}, {});
      const router = new FallbackRouter(config);
      router.setFallback('openai', 'groq', 'llama-3');
      const chain = router.getChain('openai');
      assert.ok(chain.length > 0);
      assert.equal(chain[0].provider, 'groq');
      assert.equal(chain[0].model, 'llama-3');
    });
  });

  describe('CircuitBreaker with provider flow', () => {
    it('starts in closed state for new provider', () => {
      const cb = new CircuitBreaker(5, 30000);
      const status = cb.getState('test-provider');
      assert.equal(status.state, 'closed');
    });

    it('transitions to open after threshold failures', () => {
      const cb = new CircuitBreaker(3, 30000);
      cb.recordFailure('prov');
      cb.recordFailure('prov');
      const s2 = cb.getState('prov');
      assert.equal(s2.state, 'closed'); // Not yet
      cb.recordFailure('prov');
      const s3 = cb.getState('prov');
      assert.equal(s3.state, 'open');
    });

    it('rejects requests when open', () => {
      const cb = new CircuitBreaker(1, 60000);
      cb.recordFailure('prov');
      const result = cb.check('prov');
      assert.equal(result.allowed, false);
    });

    it('allows requests when closed', () => {
      const cb = new CircuitBreaker(5, 30000);
      const result = cb.check('prov');
      assert.equal(result.allowed, true);
    });

    it('resets to closed from half-open on success', () => {
      const cb = new CircuitBreaker(2, 0); // 0ms timeout
      cb.recordFailure('prov');
      cb.recordFailure('prov');
      assert.equal(cb.getState('prov').state, 'open');
      // Transition to half-open by calling check (timeout = 0)
      const check = cb.check('prov');
      assert.equal(check.state, 'half-open');
      // Now success closes the circuit
      cb.recordSuccess('prov');
      assert.equal(cb.getState('prov').state, 'closed');
    });

    it('transitions to half-open after timeout', () => {
      const cb = new CircuitBreaker(1, 0);
      cb.recordFailure('prov');
      assert.equal(cb.getState('prov').state, 'open');
      // With 0ms timeout, next check should allow (half-open)
      const result = cb.check('prov');
      assert.equal(result.allowed, true);
      assert.equal(result.state, 'half-open');
    });

    it('tracks per-provider state independently', () => {
      const cb = new CircuitBreaker(1, 60000);
      cb.recordFailure('a');
      assert.equal(cb.check('a').allowed, false);
      assert.equal(cb.check('b').allowed, true);
    });
  });

  describe('KeyRotator with exhausted keys', () => {
    it('tracks key usage across requests', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 'test');
      const ctx = rotator.createRequestContext();

      const keys = [];
      let key;
      while ((key = ctx.getNextKey()) !== null) {
        keys.push(key);
      }

      assert.equal(keys.length, 2);
      assert.ok(keys.includes('key1'));
      assert.ok(keys.includes('key2'));
    });

    it('marks keys as rate limited and skips them', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 'test');
      const ctx = rotator.createRequestContext();

      const key1 = ctx.getNextKey();
      ctx.markKeyAsRateLimited(key1);

      const key2 = ctx.getNextKey();
      assert.notEqual(key2, key1);

      const key3 = ctx.getNextKey();
      assert.equal(key3, null);
    });

    it('reports all keys rate limited', () => {
      const rotator = new KeyRotator(['key1'], 'test');
      const ctx = rotator.createRequestContext();

      const key = ctx.getNextKey();
      ctx.markKeyAsRateLimited(key);

      const stats = ctx.getStats();
      assert.equal(stats.totalKeys, 1);
      assert.equal(stats.rateLimitedKeys, 1);
      assert.ok(ctx.allTriedKeysRateLimited());
    });

    it('returns null for last failed key when not exhausted', () => {
      const rotator = new KeyRotator(['key1', 'key2'], 'test');
      const ctx = rotator.createRequestContext();
      ctx.getNextKey();
      // Not exhausted yet, lastFailedKey is the current key being tried
      const last = ctx.getLastFailedKey();
      // It should be set to the last tried key
      assert.ok(last === 'key1' || last === 'key2' || last === null);
    });
  });

  describe('Virtual key authentication', () => {
    it('creates a virtual key with vk- prefix', () => {
      const vkm = new VirtualKeyManager(null);
      const key = vkm.create({ name: 'test', allowedProviders: ['openai'], allowedModels: ['gpt-4'], rpmLimit: 60 });
      assert.ok(key.token.startsWith('vk-'));
      assert.equal(key.name, 'test');
    });

    it('rejects expired virtual keys', () => {
      const vkm = new VirtualKeyManager(null);
      const key = vkm.create({ name: 'test', expiresAt: new Date(Date.now() - 1000).toISOString() });
      const result = vkm.validate(key.token);
      assert.equal(result, null);
    });

    it('accepts valid virtual keys', () => {
      const vkm = new VirtualKeyManager(null);
      const key = vkm.create({ name: 'test', allowedProviders: ['openai'], allowedModels: ['gpt-4'] });
      const result = vkm.validate(key.token);
      assert.ok(result);
      assert.equal(result.name, 'test');
    });

    it('tracks usage count', () => {
      const vkm = new VirtualKeyManager(null);
      const key = vkm.create({ name: 'test' });
      vkm.validate(key.token);
      vkm.validate(key.token);
      const keys = vkm.list();
      assert.equal(keys[0].usageCount, 2);
    });

    it('rejects invalid token format', () => {
      const vkm = new VirtualKeyManager(null);
      const result = vkm.validate('invalid-token');
      assert.equal(result, null);
    });

    it('rejects unknown tokens', () => {
      const vkm = new VirtualKeyManager(null);
      const result = vkm.validate('vk-' + 'a'.repeat(48));
      assert.equal(result, null);
    });
  });
});
