const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  handleError,
  categorizeError,
  categorizeHttpError,
  ErrorCategories
} = require('../../src/core/errorHandler');

describe('errorHandler', () => {
  describe('ErrorCategories', () => {
    it('defines all category constants', () => {
      assert.equal(ErrorCategories.CRITICAL, 'critical');
      assert.equal(ErrorCategories.HIGH, 'high');
      assert.equal(ErrorCategories.MEDIUM, 'medium');
      assert.equal(ErrorCategories.LOW, 'low');
    });
  });

  describe('handleError', () => {
    it('does not throw on valid input', () => {
      assert.doesNotThrow(() => {
        handleError(new Error('test error'), { location: 'test' });
      });
    });

    it('handles null error gracefully', () => {
      assert.doesNotThrow(() => {
        handleError(null, { location: 'test' });
      });
    });

    it('handles string error', () => {
      assert.doesNotThrow(() => {
        handleError('string error', { location: 'test' });
      });
    });

    it('handles missing context', () => {
      assert.doesNotThrow(() => {
        handleError(new Error('test'));
      });
    });

    it('handles all error categories', () => {
      for (const cat of Object.values(ErrorCategories)) {
        assert.doesNotThrow(() => {
          handleError(new Error('test'), { location: 'test', category: cat });
        });
      }
    });

    it('accepts metadata', () => {
      assert.doesNotThrow(() => {
        handleError(new Error('test'), {
          location: 'test',
          metadata: { key: 'value' }
        });
      });
    });

    it('accepts userVisible flag', () => {
      assert.doesNotThrow(() => {
        handleError(new Error('test'), {
          location: 'test',
          userVisible: true
        });
      });
    });
  });

  describe('categorizeError', () => {
    it('returns LOW for null error', () => {
      assert.equal(categorizeError(null, 'test'), ErrorCategories.LOW);
    });

    it('returns CRITICAL for notifier locations', () => {
      assert.equal(categorizeError(new Error('fail'), 'notifier'), ErrorCategories.CRITICAL);
      assert.equal(categorizeError(new Error('fail'), 'slack-handler'), ErrorCategories.CRITICAL);
    });

    it('returns HIGH for provider locations', () => {
      assert.equal(categorizeError(new Error('fail'), 'provider'), ErrorCategories.HIGH);
      assert.equal(categorizeError(new Error('fail'), 'client-handler'), ErrorCategories.HIGH);
    });

    it('returns HIGH for file locations', () => {
      assert.equal(categorizeError(new Error('fail'), 'fs'), ErrorCategories.HIGH);
      assert.equal(categorizeError(new Error('fail'), 'file-ops'), ErrorCategories.HIGH);
      assert.equal(categorizeError(new Error('fail'), 'admin-api'), ErrorCategories.HIGH);
    });

    it('returns MEDIUM for timeout errors', () => {
      assert.equal(categorizeError(new Error('Request timeout'), 'request'), ErrorCategories.MEDIUM);
      assert.equal(categorizeError(new Error('network error'), 'handler'), ErrorCategories.MEDIUM);
      assert.equal(categorizeError(new Error('ETIMEDOUT'), 'handler'), ErrorCategories.MEDIUM);
    });

    it('returns LOW for auth/validation errors', () => {
      assert.equal(categorizeError(new Error('Unauthorized'), 'handler'), ErrorCategories.LOW);
      assert.equal(categorizeError(new Error('Forbidden'), 'handler'), ErrorCategories.LOW);
      assert.equal(categorizeError(new Error('validation failed'), 'handler'), ErrorCategories.LOW);
    });

    it('returns MEDIUM as default', () => {
      assert.equal(categorizeError(new Error('unknown'), 'handler'), ErrorCategories.MEDIUM);
    });
  });

  describe('categorizeHttpError', () => {
    it('categorizes 401 as auth', () => {
      assert.equal(categorizeHttpError(401, ''), 'auth');
    });

    it('categorizes 403 as auth', () => {
      assert.equal(categorizeHttpError(403, ''), 'auth');
    });

    it('categorizes 429 as rate_limit', () => {
      assert.equal(categorizeHttpError(429, ''), 'rate_limit');
    });

    it('categorizes 4xx as client_error', () => {
      assert.equal(categorizeHttpError(400, ''), 'client_error');
      assert.equal(categorizeHttpError(404, ''), 'client_error');
      assert.equal(categorizeHttpError(422, ''), 'client_error');
    });

    it('categorizes 5xx as server_error', () => {
      assert.equal(categorizeHttpError(500, ''), 'server_error');
      assert.equal(categorizeHttpError(502, ''), 'server_error');
      assert.equal(categorizeHttpError(503, ''), 'server_error');
    });

    it('categorizes unknown status as unknown', () => {
      assert.equal(categorizeHttpError(200, ''), 'unknown');
      assert.equal(categorizeHttpError(301, ''), 'unknown');
    });
  });
});
