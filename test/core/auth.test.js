const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Auth = require('../../src/core/auth');

describe('Auth', () => {
  describe('hashPassword / verifyPassword', () => {
    it('hashes and verifies a password', () => {
      const hash = Auth.hashPassword('testpassword123');
      assert.ok(Auth.isHash(hash));
      assert.ok(Auth.verifyPassword('testpassword123', hash));
    });

    it('rejects wrong password', () => {
      const hash = Auth.hashPassword('correctpassword');
      assert.ok(!Auth.verifyPassword('wrongpassword', hash));
    });

    it('falls back to plaintext comparison for non-hashed stored values', () => {
      assert.ok(Auth.verifyPassword('plaintext', 'plaintext'));
      assert.ok(!Auth.verifyPassword('plaintext', 'wrong'));
    });
  });

  describe('isHash', () => {
    it('returns true for scrypt hash format', () => {
      assert.ok(Auth.isHash('$scrypt$abc$def'));
    });

    it('returns false for plaintext', () => {
      assert.ok(!Auth.isHash('admin123'));
    });

    it('returns false for null/undefined', () => {
      assert.ok(!Auth.isHash(null));
      assert.ok(!Auth.isHash(undefined));
    });
  });

  describe('verifyPassword edge cases', () => {
    it('returns false for null inputs', () => {
      assert.ok(!Auth.verifyPassword(null, '$scrypt$abc$def'));
      assert.ok(!Auth.verifyPassword('password', null));
      assert.ok(!Auth.verifyPassword(null, null));
    });

    it('returns false for malformed hash', () => {
      assert.ok(!Auth.verifyPassword('password', '$scrypt$incomplete'));
    });
  });
});
