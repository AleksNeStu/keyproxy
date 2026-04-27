const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const OpenAIClient = require('../../src/providers/openai');
const KeyRotator = require('../../src/core/keyRotator');

describe('OpenAI Provider', () => {
  let rotator;
  let client;

  beforeEach(() => {
    rotator = new KeyRotator(['sk-test-key-1', 'sk-test-key-2'], 'openai');
    client = new OpenAIClient(
      rotator,
      'https://api.openai.com',
      'openai',
      { maxRetries: 1, retryDelayMs: 0, retryBackoff: 1 },
      5000
    );
  });

  describe('_buildRequestOptions', () => {
    it('builds correct URL for /v1/chat/completions', () => {
      const opts = client._buildRequestOptions('POST', '/v1/chat/completions', {}, {}, 'sk-test');
      assert.equal(opts.hostname, 'api.openai.com');
      assert.equal(opts.path, '/v1/chat/completions');
      assert.equal(opts.method, 'POST');
    });

    it('sets Bearer authorization header by default', () => {
      const opts = client._buildRequestOptions('POST', '/v1/test', {}, {}, 'sk-mykey');
      assert.equal(opts.headers['Authorization'], 'Bearer sk-mykey');
    });

    it('sets Content-Type to application/json', () => {
      const opts = client._buildRequestOptions('POST', '/v1/test', {}, {}, 'sk-key');
      assert.equal(opts.headers['Content-Type'], 'application/json');
    });

    it('sets Content-Length when body is present and method is POST', () => {
      const body = { model: 'gpt-4', prompt: 'hello' };
      const opts = client._buildRequestOptions('POST', '/v1/test', body, {}, 'sk-key');
      assert.ok(opts.headers['Content-Length'] > 0);
    });

    it('omits Content-Length for GET requests', () => {
      const opts = client._buildRequestOptions('GET', '/v1/models', null, {}, 'sk-key');
      assert.equal(opts.headers['Content-Length'], undefined);
    });

    it('handles custom authHeader from providerConfig', () => {
      const customClient = new OpenAIClient(
        rotator, 'https://custom.api.com', 'custom',
        { maxRetries: 1, retryDelayMs: 0, retryBackoff: 1 }, 5000,
        null, { authHeader: 'X-API-Key', authPrefix: '' }
      );
      const opts = customClient._buildRequestOptions('POST', '/test', {}, {}, 'my-key');
      assert.equal(opts.headers['X-API-Key'], 'my-key');
    });

    it('handles path without leading slash', () => {
      const opts = client._buildRequestOptions('POST', 'v1/test', {}, {}, 'sk-key');
      assert.equal(opts.path, '/v1/test');
    });

    it('handles base URL with trailing slash', () => {
      const trailingClient = new OpenAIClient(
        rotator, 'https://api.openai.com/', 'openai',
        { maxRetries: 1, retryDelayMs: 0, retryBackoff: 1 }, 5000
      );
      const opts = trailingClient._buildRequestOptions('POST', '/v1/test', {}, {}, 'sk-key');
      assert.equal(opts.path, '/v1/test');
    });

    it('substitutes KeyProxy placeholder in URL', () => {
      const urlRotator = new KeyRotator(['my-tavily-key'], 'tavily');
      const urlClient = new OpenAIClient(
        urlRotator, 'https://api.tavily.com/search?api_key=KeyProxy', 'tavily',
        { maxRetries: 1, retryDelayMs: 0, retryBackoff: 1 }, 5000
      );
      const opts = urlClient._buildRequestOptions('POST', '/search', {}, {}, 'my-tavily-key');
      assert.ok(opts.path.includes('my-tavily-key'));
    });

    it('handles empty request path', () => {
      const opts = client._buildRequestOptions('GET', '', {}, {}, 'sk-key');
      assert.equal(opts.hostname, 'api.openai.com');
    });
  });

  describe('constructor', () => {
    it('uses default auth header when no providerConfig', () => {
      assert.equal(client.authHeader, 'Authorization');
      assert.equal(client.authPrefix, 'Bearer');
    });

    it('preserves empty authPrefix when explicitly set', () => {
      const c = new OpenAIClient(rotator, 'https://api.test.com', 'test', null, 5000, null, { authPrefix: '' });
      assert.equal(c.authPrefix, '');
    });
  });
});
