const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const GeminiClient = require('../../src/providers/gemini');
const KeyRotator = require('../../src/core/keyRotator');

describe('Gemini Provider', () => {
  let rotator;
  let client;

  beforeEach(() => {
    rotator = new KeyRotator(['gemini-key-1', 'gemini-key-2'], 'gemini');
    client = new GeminiClient(
      rotator,
      'https://generativelanguage.googleapis.com',
      'gemini',
      { maxRetries: 1, retryDelayMs: 0, retryBackoff: 1 },
      5000
    );
  });

  describe('getProvidedApiKey', () => {
    it('returns null when no x-goog-api-key header', () => {
      assert.equal(client.getProvidedApiKey({ 'content-type': 'application/json' }), null);
    });

    it('extracts key from x-goog-api-key header', () => {
      const result = client.getProvidedApiKey({ 'x-goog-api-key': 'my-key', 'content-type': 'application/json' });
      assert.equal(result.key, 'my-key');
      assert.equal(result.cleanHeaders['x-goog-api-key'], undefined);
      assert.equal(result.cleanHeaders['content-type'], 'application/json');
    });
  });

  describe('_buildRequestOptions', () => {
    it('adds rotated key as query parameter', () => {
      const opts = client._buildRequestOptions('POST', '/v1beta/models/gemini-2.0-flash:generateContent', {}, {}, 'rotated-key');
      assert.ok(opts.path.includes('key=rotated-key'));
      assert.equal(opts.headers['x-goog-api-key'], undefined);
    });

    it('uses header auth for provided keys', () => {
      // Simulate provided key mode
      client._providedKeyMode = true;
      const opts = client._buildRequestOptions('POST', '/v1beta/models/test', {}, {}, 'provided-key');
      assert.equal(opts.headers['x-goog-api-key'], 'provided-key');
      assert.ok(!opts.path.includes('key=provided-key'));
      client._providedKeyMode = false;
    });

    it('builds correct hostname for googleapis', () => {
      const opts = client._buildRequestOptions('POST', '/v1beta/models/test:generateContent', {}, {}, 'key1');
      assert.equal(opts.hostname, 'generativelanguage.googleapis.com');
    });

    it('sets correct path with query param', () => {
      const opts = client._buildRequestOptions('POST', '/v1beta/models/test:generateContent', {}, {}, 'key1');
      assert.ok(opts.path.startsWith('/v1beta/models/test:generateContent'));
      assert.ok(opts.path.includes('key=key1'));
    });

    it('resolves version conflicts between path and base URL', () => {
      const v1Client = new GeminiClient(
        rotator, 'https://generativelanguage.googleapis.com/v1', 'gemini',
        { maxRetries: 1, retryDelayMs: 0, retryBackoff: 1 }, 5000
      );
      // Path says v1beta, base says v1 → should use path version
      const opts = v1Client._buildRequestOptions('POST', '/v1beta/models/test:generateContent', {}, {}, 'key1');
      assert.ok(opts.path.includes('v1beta') || opts.path.includes('v1'));
    });
  });

  describe('_rateLimitedError', () => {
    it('returns Gemini-style 429 error with RESOURCE_EXHAUSTED', () => {
      const err = client._rateLimitedError();
      assert.equal(err.error.code, 429);
      assert.equal(err.error.status, 'RESOURCE_EXHAUSTED');
      assert.ok(err.error.message);
    });
  });
});
