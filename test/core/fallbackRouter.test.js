const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const FallbackRouter = require('../../src/core/fallbackRouter');

function createMockConfig(envVars = {}, providers = {}) {
  const providerMap = new Map();
  for (const [name, config] of Object.entries(providers)) {
    providerMap.set(name, config);
  }

  return {
    envVars,
    getProviders: () => providerMap,
    getProvider: (name) => providerMap.get(name) || null
  };
}

describe('FallbackRouter', () => {
  describe('constructor and chain parsing', () => {
    it('parses fallback chains from env vars', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'anthropic' },
        {
          openai: { apiType: 'openai', baseUrl: 'https://api.openai.com' },
          anthropic: { apiType: 'openai', baseUrl: 'https://api.anthropic.com' }
        }
      );

      const router = new FallbackRouter(config);
      assert.ok(router.hasFallback('openai'));
      assert.equal(router.getFallback('openai').provider, 'anthropic');
    });

    it('parses fallback model from env vars', () => {
      const config = createMockConfig(
        {
          OPENAI_OPENAI_FALLBACK: 'groq',
          OPENAI_OPENAI_FALLBACK_MODEL: 'llama-3'
        },
        {
          openai: { apiType: 'openai', baseUrl: 'https://api.openai.com' }
        }
      );

      const router = new FallbackRouter(config);
      const fb = router.getFallback('openai');
      assert.equal(fb.provider, 'groq');
      assert.equal(fb.model, 'llama-3');
      assert.equal(fb.model, 'llama-3');
    });

    it('sets null model when no fallback model env var', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'anthropic' },
        { openai: { apiType: 'openai', baseUrl: 'https://api.openai.com' } }
      );

      const router = new FallbackRouter(config);
      assert.equal(router.getFallback('openai').model, null);
    });

    it('handles no fallback config gracefully', () => {
      const config = createMockConfig(
        {},
        { openai: { apiType: 'openai', baseUrl: 'https://api.openai.com' } }
      );

      const router = new FallbackRouter(config);
      assert.equal(router.hasFallback('openai'), false);
    });

    it('skips providers not in config', () => {
      const config = createMockConfig(
        { OPENAI_NONEXISTENT_FALLBACK: 'anthropic' },
        {}
      );

      const router = new FallbackRouter(config);
      assert.equal(router.hasFallback('nonexistent'), false);
    });

    it('handles provider names with dashes (converted to underscores)', () => {
      const config = createMockConfig(
        { OPENAI_MY_PROVIDER_FALLBACK: 'anthropic' },
        { 'my-provider': { apiType: 'openai', baseUrl: 'https://example.com' } }
      );

      const router = new FallbackRouter(config);
      assert.ok(router.hasFallback('my-provider'));
    });
  });

  describe('getChain', () => {
    it('returns empty chain when no fallback', () => {
      const config = createMockConfig({}, { openai: { apiType: 'openai', baseUrl: '' } });
      const router = new FallbackRouter(config);

      const chain = router.getChain('openai');
      assert.deepEqual(chain, []);
    });

    it('returns single fallback chain', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'anthropic' },
        {
          openai: { apiType: 'openai', baseUrl: '' },
          anthropic: { apiType: 'openai', baseUrl: '' }
        }
      );
      const router = new FallbackRouter(config);

      const chain = router.getChain('openai');
      assert.equal(chain.length, 1);
      assert.equal(chain[0].provider, 'anthropic');
    });

    it('respects maxDepth of 2', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'groq' },
        { openai: { apiType: 'openai', baseUrl: '' } }
      );
      const router = new FallbackRouter(config);

      // Manually add deep chains beyond maxDepth
      router.setFallback('openai', 'groq', null);
      router.setFallback('groq', 'anthropic', null);
      router.setFallback('anthropic', 'gemini', null);

      const chain = router.getChain('openai');
      assert.equal(chain.length, 2); // maxDepth limits to 2
    });
  });

  describe('hasFallback', () => {
    it('returns true when fallback exists', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'anthropic' },
        { openai: { apiType: 'openai', baseUrl: '' } }
      );
      const router = new FallbackRouter(config);
      assert.equal(router.hasFallback('openai'), true);
    });

    it('returns false when no fallback', () => {
      const config = createMockConfig({}, { openai: { apiType: 'openai', baseUrl: '' } });
      const router = new FallbackRouter(config);
      assert.equal(router.hasFallback('openai'), false);
    });
  });

  describe('getFallback', () => {
    it('returns null for provider without fallback', () => {
      const config = createMockConfig({}, { openai: { apiType: 'openai', baseUrl: '' } });
      const router = new FallbackRouter(config);
      assert.equal(router.getFallback('openai'), null);
    });
  });

  describe('prepareBody', () => {
    it('replaces model when fallback model configured', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);

      const body = JSON.stringify({ model: 'gpt-4', messages: [] });
      const result = router.prepareBody(body, { provider: 'anthropic', model: 'claude-3' });

      const parsed = JSON.parse(result);
      assert.equal(parsed.model, 'claude-3');
    });

    it('returns original body when no fallback model', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);

      const body = JSON.stringify({ model: 'gpt-4', messages: [] });
      const result = router.prepareBody(body, { provider: 'anthropic', model: null });

      assert.equal(result, body);
    });

    it('returns original body when body is null', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);
      const result = router.prepareBody(null, { provider: 'a', model: 'm' });
      assert.equal(result, null);
    });

    it('returns original body when body is undefined', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);
      const result = router.prepareBody(undefined, { provider: 'a', model: 'm' });
      assert.equal(result, undefined);
    });

    it('handles string body', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);

      const result = router.prepareBody('{"model":"gpt-4"}', { provider: 'a', model: 'claude' });
      const parsed = JSON.parse(result);
      assert.equal(parsed.model, 'claude');
    });

    it('handles object body', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);

      const result = router.prepareBody({ model: 'gpt-4' }, { provider: 'a', model: 'claude' });
      const parsed = JSON.parse(result);
      assert.equal(parsed.model, 'claude');
    });

    it('handles body without model field', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);

      const body = JSON.stringify({ messages: [] });
      const result = router.prepareBody(body, { provider: 'a', model: 'claude' });
      const parsed = JSON.parse(result);
      assert.equal(parsed.model, undefined);
    });

    it('returns original body on invalid JSON', () => {
      const config = createMockConfig({}, {});
      const router = new FallbackRouter(config);

      const result = router.prepareBody('not-json', { provider: 'a', model: 'claude' });
      assert.equal(result, 'not-json');
    });
  });

  describe('getAllChains', () => {
    it('returns all configured fallback chains', () => {
      const config = createMockConfig(
        {
          OPENAI_OPENAI_FALLBACK: 'anthropic',
          OPENAI_GROQ_FALLBACK: 'openai'
        },
        {
          openai: { apiType: 'openai', baseUrl: '' },
          groq: { apiType: 'openai', baseUrl: '' }
        }
      );
      const router = new FallbackRouter(config);

      const chains = router.getAllChains();
      assert.ok(chains.openai);
      assert.ok(chains.groq);
      assert.equal(chains.openai.provider, 'anthropic');
      assert.equal(chains.groq.provider, 'openai');
    });
  });

  describe('setFallback', () => {
    it('adds a new fallback at runtime', () => {
      const config = createMockConfig({}, { openai: { apiType: 'openai', baseUrl: '' } });
      const router = new FallbackRouter(config);

      router.setFallback('openai', 'anthropic', 'claude-3');

      assert.ok(router.hasFallback('openai'));
      const fb = router.getFallback('openai');
      assert.equal(fb.provider, 'anthropic');
      assert.equal(fb.model, 'claude-3');
    });

    it('removes fallback when provider is null', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'anthropic' },
        { openai: { apiType: 'openai', baseUrl: '' } }
      );
      const router = new FallbackRouter(config);

      router.setFallback('openai', null);
      assert.equal(router.hasFallback('openai'), false);
    });

    it('removes fallback when provider is empty string', () => {
      const config = createMockConfig(
        { OPENAI_OPENAI_FALLBACK: 'anthropic' },
        { openai: { apiType: 'openai', baseUrl: '' } }
      );
      const router = new FallbackRouter(config);

      router.setFallback('openai', '');
      assert.equal(router.hasFallback('openai'), false);
    });
  });
});
