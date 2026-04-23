const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { estimateCost, estimateTokens, extractModel } = require('../../src/core/pricing');

describe('estimateCost', () => {
  it('estimates cost for known OpenAI model', () => {
    const result = estimateCost('openai', 'gpt-4o', 1_000_000, 1_000_000);
    assert.equal(result.inputCost, 2.5);
    assert.equal(result.outputCost, 10.0);
    assert.equal(result.totalCost, 12.5);
  });

  it('uses default pricing for unknown model', () => {
    const result = estimateCost('openai', 'unknown-model', 1_000_000, 1_000_000);
    assert.equal(result.inputCost, 5.0);
    assert.equal(result.outputCost, 15.0);
  });

  it('uses default pricing for unknown provider', () => {
    const result = estimateCost('unknown', 'any-model', 1_000_000, 1_000_000);
    assert.equal(result.inputCost, 5.0); // falls back to openai default
  });

  it('handles zero tokens', () => {
    const result = estimateCost('openai', 'gpt-4o', 0, 0);
    assert.equal(result.totalCost, 0);
  });
});

describe('estimateTokens', () => {
  it('estimates tokens from text length (~4 chars/token)', () => {
    assert.equal(estimateTokens('abcdefgh'), 2); // 8 chars / 4
    assert.equal(estimateTokens('abc'), 1); // 3 chars / 4 → ceil
  });

  it('returns 0 for null/undefined/empty', () => {
    assert.equal(estimateTokens(null), 0);
    assert.equal(estimateTokens(undefined), 0);
    assert.equal(estimateTokens(''), 0);
  });

  it('returns 0 for non-string input', () => {
    assert.equal(estimateTokens(123), 0);
    assert.equal(estimateTokens({}), 0);
  });
});

describe('extractModel', () => {
  it('extracts model from JSON body string', () => {
    assert.equal(extractModel('{"model": "gpt-4o"}'), 'gpt-4o');
  });

  it('extracts model from object body', () => {
    assert.equal(extractModel({ model: 'gemini-2.0-flash' }), 'gemini-2.0-flash');
  });

  it('extracts model from path when body has none', () => {
    assert.equal(extractModel('{}', '/v1/models/gpt-4o:generateContent'), 'gpt-4o');
  });

  it('returns null for missing model', () => {
    assert.equal(extractModel('{"foo": "bar"}'), null);
    assert.equal(extractModel(null), null);
  });

  it('handles invalid JSON gracefully', () => {
    assert.equal(extractModel('not json'), null);
  });
});
