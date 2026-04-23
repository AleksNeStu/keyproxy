const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { maskApiKey, sleep } = require('../../src/core/utils');

describe('maskApiKey', () => {
  it('masks a normal API key', () => {
    assert.equal(maskApiKey('sk-abc123456789xyz'), 'sk-a...9xyz');
  });

  it('returns *** for keys shorter than 8 chars', () => {
    assert.equal(maskApiKey('short'), '***');
  });

  it('returns *** for null', () => {
    assert.equal(maskApiKey(null), '***');
  });

  it('returns *** for undefined', () => {
    assert.equal(maskApiKey(undefined), '***');
  });

  it('returns *** for empty string', () => {
    assert.equal(maskApiKey(''), '***');
  });

  it('handles exactly 8-char key', () => {
    assert.equal(maskApiKey('12345678'), '1234...5678');
  });
});

describe('sleep', () => {
  it('resolves after the specified duration', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `Expected ~50ms, got ${elapsed}ms`);
    assert.ok(elapsed < 200, `Should not take >200ms, got ${elapsed}ms`);
  });
});
