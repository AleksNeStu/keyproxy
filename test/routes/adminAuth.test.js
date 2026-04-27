const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { parseCookies } = require('../../src/routes/httpHelpers');
const { isAdminAuthenticated, generateSessionToken } = require('../../src/routes/adminAuth');

function mockRes() {
  const res = {
    _statusCode: null,
    _headers: {},
    _body: null,
    _ended: false,
    writeHead(code, headers) {
      res._statusCode = code;
      Object.assign(res._headers, headers);
    },
    end(data) {
      res._body = data;
      res._ended = true;
    }
  };
  return res;
}

describe('Admin Auth Routes', () => {
  describe('isAdminAuthenticated', () => {
    it('returns false when no cookie is present', () => {
      const server = { adminSessionToken: 'valid-token' };
      const req = { headers: {} };
      assert.equal(isAdminAuthenticated(server, req), false);
    });

    it('returns false when session token is null', () => {
      const server = { adminSessionToken: null };
      const req = { headers: { cookie: 'adminSession=abc' } };
      assert.equal(isAdminAuthenticated(server, req), false);
    });

    it('returns true when cookie matches session token', () => {
      const server = { adminSessionToken: 'valid-token-123' };
      const req = { headers: { cookie: 'adminSession=valid-token-123' } };
      assert.equal(isAdminAuthenticated(server, req), true);
    });

    it('returns false when cookie does not match', () => {
      const server = { adminSessionToken: 'valid-token-123' };
      const req = { headers: { cookie: 'adminSession=wrong-token' } };
      assert.equal(isAdminAuthenticated(server, req), false);
    });

    it('handles multiple cookies', () => {
      const server = { adminSessionToken: 'my-token' };
      const req = { headers: { cookie: 'other=foo; adminSession=my-token; extra=bar' } };
      assert.equal(isAdminAuthenticated(server, req), true);
    });
  });

  describe('generateSessionToken', () => {
    it('returns a 64-char hex string', () => {
      const token = generateSessionToken();
      assert.equal(token.length, 64);
      assert.ok(/^[0-9a-f]+$/.test(token));
    });

    it('generates unique tokens', () => {
      const t1 = generateSessionToken();
      const t2 = generateSessionToken();
      assert.notEqual(t1, t2);
    });
  });
});

describe('HTTP Helpers', () => {
  describe('parseCookies', () => {
    it('parses single cookie', () => {
      const result = parseCookies('name=value');
      assert.equal(result.name, 'value');
    });

    it('parses multiple cookies', () => {
      const result = parseCookies('a=1; b=2; c=3');
      assert.equal(result.a, '1');
      assert.equal(result.b, '2');
      assert.equal(result.c, '3');
    });

    it('returns empty object for null input', () => {
      const result = parseCookies(null);
      assert.deepEqual(result, {});
    });

    it('returns empty object for undefined input', () => {
      const result = parseCookies(undefined);
      assert.deepEqual(result, {});
    });

    it('handles cookies with spaces around equals', () => {
      const result = parseCookies('  name = value  ;  other = test  ');
      // The parser trims the whole cookie string but not individual parts
      assert.ok(result['name '] === ' value' || result.name === 'value');
      assert.ok(result['other '] === ' test' || result.other === 'test');
    });
  });
});

describe('Admin Auth - Login Flow', () => {
  const Auth = require('../../src/core/auth');

  describe('handleAdminLogin', () => {
    it('rejects when rate limited', async () => {
      const { handleAdminLogin } = require('../../src/routes/adminAuth');
      const server = {
        adminSessionToken: null,
        loginBlockedUntil: Date.now() + 300000,
        failedLoginAttempts: 5,
        getAdminPassword: () => 'testpass'
      };
      const res = mockRes();
      await handleAdminLogin(server, {}, res, JSON.stringify({ password: 'anything' }));
      assert.equal(res._statusCode, 429);
      const body = JSON.parse(res._body);
      assert.ok(body.error.includes('Too many failed'));
    });

    it('rejects invalid password', async () => {
      const { handleAdminLogin } = require('../../src/routes/adminAuth');
      const hashed = Auth.hashPassword('correctpass');
      const server = {
        adminSessionToken: null,
        loginBlockedUntil: null,
        failedLoginAttempts: 0,
        getAdminPassword: () => hashed
      };
      const res = mockRes();
      await handleAdminLogin(server, {}, res, JSON.stringify({ password: 'wrongpass' }));
      assert.equal(res._statusCode, 401);
      const body = JSON.parse(res._body);
      assert.ok(body.error.includes('Invalid password'));
      assert.ok(body.attemptsRemaining > 0);
    });

    it('accepts valid password and sets session', async () => {
      const { handleAdminLogin } = require('../../src/routes/adminAuth');
      const hashed = Auth.hashPassword('correctpass');
      const server = {
        adminSessionToken: null,
        loginBlockedUntil: null,
        failedLoginAttempts: 0,
        getAdminPassword: () => hashed,
        failedLoginAttempts: 0,
        loginBlockedUntil: null
      };
      const res = mockRes();
      await handleAdminLogin(server, {}, res, JSON.stringify({ password: 'correctpass' }));
      assert.equal(res._statusCode, 200);
      const body = JSON.parse(res._body);
      assert.equal(body.success, true);
      assert.ok(body.csrfToken);
      assert.ok(server.adminSessionToken);
      assert.ok(res._headers['Set-Cookie'].includes('adminSession='));
    });

    it('blocks after 5 failed attempts', async () => {
      const { handleAdminLogin } = require('../../src/routes/adminAuth');
      const hashed = Auth.hashPassword('correctpass');
      const server = {
        adminSessionToken: null,
        loginBlockedUntil: null,
        failedLoginAttempts: 4,
        getAdminPassword: () => hashed
      };
      const res = mockRes();
      await handleAdminLogin(server, {}, res, JSON.stringify({ password: 'wrong' }));
      assert.equal(res._statusCode, 429);
      assert.ok(server.loginBlockedUntil);
    });

    it('returns 400 for invalid JSON body', async () => {
      const { handleAdminLogin } = require('../../src/routes/adminAuth');
      const server = {
        adminSessionToken: null,
        loginBlockedUntil: null,
        failedLoginAttempts: 0,
        getAdminPassword: () => 'pass'
      };
      const res = mockRes();
      await handleAdminLogin(server, {}, res, 'not-json');
      assert.equal(res._statusCode, 400);
    });
  });
});
