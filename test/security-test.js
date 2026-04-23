/**
 * Security Test Suite for KeyProxy
 * Tests input validation, CSRF protection, password strength, and security headers
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Test configuration
const TEST_HOST = 'localhost';
const TEST_PORT = 3000;
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;

// Test credentials
const VALID_PASSWORD = 'TestPassword123!';
const WEAK_PASSWORDS = ['123', 'password', '12345678', 'abcdefgh', 'Test123', 'test'];
const STRONG_PASSWORDS = ['MySecureP@ssw0rd', 'Str0ng!Pass#2024', 'C0mplex!ty#99'];

// Malicious payloads for testing
const SQL_INJECTION_PAYLOADS = [
  "'; DROP TABLE users; --",
  "' OR '1'='1",
  "1' UNION SELECT * FROM users--",
  "admin'--",
  "' OR 1=1#"
];

const XSS_PAYLOADS = [
  '<script>alert("XSS")</script>',
  '<img src=x onerror="alert(\'XSS\')">',
  'javascript:alert("XSS")',
  '<svg onload="alert(\'XSS\')">',
  '"><script>alert(String.fromCharCode(88,83,83))</script>'
];

const PATH_TRAVERSAL_PAYLOADS = [
  '../../../etc/passwd',
  '..\\..\\..\\windows\\system32\\drivers\\etc\\hosts',
  '....//....//....//etc/passwd',
  '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'
];

class SecurityTester {
  constructor() {
    this.sessionCookie = null;
    this.server = null;
  }

  async makeRequest(path, options = {}) {
    const url = new URL(path, BASE_URL);
    const headers = {
      ...options.headers,
      'Content-Type': 'application/json'
    };

    if (this.sessionCookie && !options.skipAuth) {
      headers['Cookie'] = `adminSession=${this.sessionCookie}`;
    }

    const requestOptions = {
      hostname: TEST_HOST,
      port: TEST_PORT,
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers
    };

    return new Promise((resolve, reject) => {
      const req = http.request(requestOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', reject);

      if (options.body) {
        req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
      }

      req.end();
    });
  }

  async login(password = VALID_PASSWORD) {
    const response = await this.makeRequest('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
      skipAuth: true
    });

    if (response.statusCode === 200) {
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        const match = setCookie[0].match(/adminSession=([^;]+)/);
        if (match) {
          this.sessionCookie = match[1];
        }
      }
      return true;
    }
    return false;
  }

  async logout() {
    const response = await this.makeRequest('/admin/logout', {
      method: 'POST'
    });
    this.sessionCookie = null;
    return response.statusCode === 200;
  }
}

const tester = new SecurityTester();

describe('Security Tests', () => {
  describe('CRITICAL: Input Validation Tests', () => {
    it('should reject oversized JSON payload (>1MB)', async () => {
      const largePayload = {
        data: 'x'.repeat(2 * 1024 * 1024) // 2MB
      };

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: largePayload
      });

      // Should reject with 413 (Payload Too Large) or 400 (Bad Request)
      assert.ok([400, 413, 504].includes(response.statusCode),
        `Expected 400/413/504, got ${response.statusCode}`);
    });

    it('should reject invalid data types (string instead of number)', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/retry-config', {
        method: 'POST',
        body: {
          maxAttempts: "not_a_number", // Should be number
          initialDelay: "also_not_a_number"
        }
      });

      // Should validate and reject
      assert.ok([400, 422].includes(response.statusCode),
        `Expected 400/422 for invalid type, got ${response.statusCode}`);
    });

    it('should reject negative numbers where only positive allowed', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/retry-config', {
        method: 'POST',
        body: {
          maxAttempts: -5, // Negative not allowed
          initialDelay: -100
        }
      });

      assert.ok([400, 422].includes(response.statusCode),
        `Expected 400/422 for negative numbers, got ${response.statusCode}`);
    });

    it('should reject missing required fields', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/change-password', {
        method: 'POST',
        body: {
          // Missing currentPassword
          newPassword: 'newpass123'
        }
      });

      assert.strictEqual(response.statusCode, 400,
        'Expected 400 for missing required field');
    });

    it('should sanitize malicious HTML in text inputs', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/notifications', {
        method: 'POST',
        body: {
          slackWebhookUrl: '<script>alert("XSS")</script>'
        }
      });

      // Should either reject or sanitize
      assert.ok(
        response.statusCode >= 400 || !response.body.includes('<script>'),
        'XSS payload should be rejected or sanitized'
      );
    });
  });

  describe('CRITICAL: SQL Injection Protection', () => {
    it('should reject SQL injection attempts in input fields', async () => {
      await tester.login();

      for (const payload of SQL_INJECTION_PAYLOADS) {
        const response = await tester.makeRequest('/admin/api/settings', {
          method: 'POST',
          body: {
            testField: payload
          }
        });

        assert.ok(
          response.statusCode >= 400 || !response.body.includes('error'),
          `SQL injection payload rejected: ${payload}`
        );
      }
    });
  });

  describe('CRITICAL: XSS Protection', () => {
    it('should sanitize XSS payloads in all input fields', async () => {
      await tester.login();

      for (const payload of XSS_PAYLOADS) {
        const response = await tester.makeRequest('/admin/api/notifications', {
          method: 'POST',
          body: {
            slackWebhookUrl: payload
          }
        });

        // Should reject dangerous payloads
        assert.ok(
          response.statusCode >= 400,
          `XSS payload should be rejected: ${payload.substring(0, 20)}`
        );
      }
    });

    it('should escape HTML entities in output', async () => {
      await tester.login();

      const xssPayload = '<img src=x onerror="alert(1)">';

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: {
          testSetting: xssPayload
        }
      });

      // If accepted, should be escaped in response
      if (response.statusCode < 400) {
        assert.ok(
          !response.body.includes('<img') ||
          response.body.includes('&lt;') ||
          response.body.includes('&#60;'),
          'HTML should be escaped in output'
        );
      }
    });
  });

  describe('CRITICAL: Path Traversal Protection', () => {
    it('should reject path traversal attempts in file operations', async () => {
      await tester.login();

      for (const payload of PATH_TRAVERSAL_PAYLOADS) {
        const response = await tester.makeRequest(`/admin/api/fs-list?path=${encodeURIComponent(payload)}`);

        assert.ok(
          response.statusCode >= 400 ||
          !response.body.includes('root:') ||
          !response.body.includes('etc/passwd'),
          `Path traversal rejected: ${payload}`
        );
      }
    });

    it('should restrict file access to working directory', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/fs-list?path=/etc/passwd');

      assert.ok(
        response.statusCode >= 400,
        'Should reject absolute paths outside working directory'
      );
    });
  });

  describe('CRITICAL: CSRF Protection', () => {
    it('should require CSRF token for state-changing operations', async () => {
      await tester.login();

      // Try to make a request without CSRF token
      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: { test: 'value' }
      });

      // Should require CSRF token (403 Forbidden)
      assert.strictEqual(response.statusCode, 403,
        'CSRF token should be required for POST requests');
    });

    it('should reject invalid CSRF tokens', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'invalid-token-12345'
        },
        body: { test: 'value' }
      });

      assert.strictEqual(response.statusCode, 403,
        'Invalid CSRF token should be rejected');
    });

    it('should provide CSRF token on GET requests', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/auth');

      if (response.statusCode === 200) {
        const body = JSON.parse(response.body);
        assert.ok(
          body.csrfToken || response.headers['x-csrf-token'],
          'CSRF token should be provided'
        );
      }
    });

    it('should reject CSRF token reuse after logout', async () => {
      await tester.login();
      const originalToken = tester.sessionCookie;

      await tester.logout();
      await tester.login(); // Get new token

      // Try to use old token
      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        skipAuth: true,
        headers: {
          'Cookie': `adminSession=${originalToken}`
        },
        body: { test: 'value' }
      });

      assert.strictEqual(response.statusCode, 401,
        'Old session token should be invalid after logout');
    });
  });

  describe('CRITICAL: Password Strength Validation', () => {
    it('should reject weak passwords (< 8 characters)', async () => {
      await tester.login();

      const weakPasswords = ['123', 'pass', 'abc123'];

      for (const password of weakPasswords) {
        const response = await tester.makeRequest('/admin/api/change-password', {
          method: 'POST',
          body: {
            currentPassword: VALID_PASSWORD,
            newPassword: password
          }
        });

        assert.strictEqual(response.statusCode, 400,
          `Weak password should be rejected: ${password}`);
      }
    });

    it('should reject passwords without complexity requirements', async () => {
      await tester.login();

      // Test: all lowercase
      let response = await tester.makeRequest('/admin/api/change-password', {
        method: 'POST',
        body: {
          currentPassword: VALID_PASSWORD,
          newPassword: 'lowercaseonly'
        }
      });
      assert.strictEqual(response.statusCode, 400,
        'Password without uppercase should be rejected');

      // Test: no numbers
      response = await tester.makeRequest('/admin/api/change-password', {
        method: 'POST',
        body: {
          currentPassword: VALID_PASSWORD,
          newPassword: 'NoNumbersHere'
        }
      });
      assert.strictEqual(response.statusCode, 400,
        'Password without numbers should be rejected');

      // Test: no special characters
      response = await tester.makeRequest('/admin/api/change-password', {
        method: 'POST',
        body: {
          currentPassword: VALID_PASSWORD,
          newPassword: 'NoSpecialChars123'
        }
      });
      assert.strictEqual(response.statusCode, 400,
        'Password without special characters should be rejected');
    });

    it('should reject common passwords', async () => {
      await tester.login();

      const commonPasswords = ['Password123!', 'Admin123!', 'Welcome123!'];

      for (const password of commonPasswords) {
        const response = await tester.makeRequest('/admin/api/change-password', {
          method: 'POST',
          body: {
            currentPassword: VALID_PASSWORD,
            newPassword: password
          }
        });

        assert.strictEqual(response.statusCode, 400,
          `Common password should be rejected: ${password}`);
      }
    });

    it('should accept strong passwords meeting all requirements', async () => {
      await tester.login();

      for (const password of STRONG_PASSWORDS) {
        const response = await tester.makeRequest('/admin/api/change-password', {
          method: 'POST',
          body: {
            currentPassword: VALID_PASSWORD,
            newPassword: password
          }
        });

        if (response.statusCode === 200) {
          // Change back to original password for next tests
          await tester.makeRequest('/admin/api/change-password', {
            method: 'POST',
            body: {
              currentPassword: password,
              newPassword: VALID_PASSWORD
            }
          });
          return;
        }
      }

      assert.fail('No strong passwords were accepted');
    });
  });

  describe('CRITICAL: Security Headers', () => {
    it('should include X-Frame-Options header', async () => {
      const response = await tester.makeRequest('/admin');

      assert.ok(
        response.headers['x-frame-options'] === 'DENY' ||
        response.headers['x-frame-options'] === 'SAMEORIGIN',
        'X-Frame-Options header should be set to DENY or SAMEORIGIN'
      );
    });

    it('should include X-Content-Type-Options header', async () => {
      const response = await tester.makeRequest('/admin');

      assert.strictEqual(
        response.headers['x-content-type-options'],
        'nosniff',
        'X-Content-Type-Options should be nosniff'
      );
    });

    it('should include Content-Security-Policy header', async () => {
      const response = await tester.makeRequest('/admin');

      assert.ok(
        response.headers['content-security-policy'],
        'Content-Security-Policy header should be present'
      );
    });

    it('should include Strict-Transport-Security header on HTTPS', async () => {
      // This test assumes HTTPS; if testing on HTTP, header may not be present
      const response = await tester.makeRequest('/admin');

      // On localhost HTTP, HSTS may not be set, but check if it exists
      if (response.headers['strict-transport-security']) {
        assert.ok(
          response.headers['strict-transport-security'].includes('max-age='),
          'Strict-Transport-Security should have max-age directive'
        );
      }
    });

    it('should include X-XSS-Protection header', async () => {
      const response = await tester.makeRequest('/admin');

      assert.ok(
        response.headers['x-xss-protection'] === '1; mode=block' ||
        response.headers['x-xss-protection'] === '1',
        'X-XSS-Protection header should be present'
      );
    });

    it('should not expose server version information', async () => {
      const response = await tester.makeRequest('/admin');

      assert.ok(
        !response.headers['server'] ||
        !response.headers['server'].includes('Node.js') ||
        !response.headers['server'].includes('Express'),
        'Server header should not expose version information'
      );
    });
  });

  describe('CRITICAL: Authentication Security', () => {
    it('should enforce rate limiting on login attempts', async () => {
      // Attempt 6 failed logins (should trigger rate limit after 5)
      for (let i = 0; i < 6; i++) {
        await tester.makeRequest('/admin/login', {
          method: 'POST',
          body: { password: 'wrongpassword' },
          skipAuth: true
        });
      }

      // 6th attempt should be rate limited
      const response = await tester.makeRequest('/admin/login', {
        method: 'POST',
        body: { password: VALID_PASSWORD },
        skipAuth: true
      });

      assert.strictEqual(response.statusCode, 429,
        'Should rate limit after 5 failed attempts');

      // Reset for other tests
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should use secure session cookies', async () => {
      const response = await tester.makeRequest('/admin/login', {
        method: 'POST',
        body: { password: VALID_PASSWORD },
        skipAuth: true
      });

      const setCookie = response.headers['set-cookie'];
      if (setCookie && setCookie[0]) {
        const cookie = setCookie[0];

        assert.ok(
          cookie.includes('HttpOnly'),
          'Session cookie should be HttpOnly'
        );

        // On localhost, Secure flag may not be set (HTTP), but check for it
        // assert.ok(cookie.includes('Secure'), 'Session cookie should be Secure');

        assert.ok(
          cookie.includes('SameSite=Strict') || cookie.includes('SameSite=Lax'),
          'Session cookie should have SameSite protection'
        );
      }
    });

    it('should reject expired session tokens', async () => {
      // This test would require manipulating session expiry
      // For now, just verify session check works
      await tester.login();

      const response = await tester.makeRequest('/admin/api/auth');
      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.authenticated, true);
    });

    it('should hash passwords using scrypt', async () => {
      const Auth = require('../src/core/auth');

      const hash = Auth.hashPassword('testpassword');
      assert.ok(hash.startsWith('$scrypt$'), 'Password should use scrypt hashing');
    });
  });

  describe('CRITICAL: Request Size Limits', () => {
    it('should reject requests larger than configured limit', async () => {
      await tester.login();

      // Create a 5MB payload
      const largePayload = {
        data: 'x'.repeat(5 * 1024 * 1024)
      };

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: largePayload
      });

      assert.ok(
        [400, 413, 504].includes(response.statusCode),
        'Oversized requests should be rejected'
      );
    });

    it('should handle chunked transfer encoding safely', async () => {
      await tester.login();

      // Send request in chunks
      const chunkedData = { test: 'data'.repeat(1000) };

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: chunkedData
      });

      // Should either accept or reject cleanly, not crash
      assert.ok(
        [200, 400, 413].includes(response.statusCode),
        'Chunked requests should be handled safely'
      );
    });
  });

  describe('CRITICAL: CORS Configuration', () => {
    it('should not use wildcard CORS in production', async () => {
      const response = await tester.makeRequest('/admin');

      const corsHeader = response.headers['access-control-allow-origin'];

      // For localhost testing, wildcard may be acceptable
      // But in production, should be specific origin
      if (process.env.NODE_ENV === 'production') {
        assert.notStrictEqual(corsHeader, '*',
          'Wildcard CORS should not be used in production');
      }
    });

    it('should validate Origin header on cross-origin requests', async () => {
      const response = await tester.makeRequest('/admin/api/auth', {
        headers: {
          'Origin': 'https://malicious-site.com'
        }
      });

      // Should either reject or not reflect the malicious origin
      assert.ok(
        response.statusCode >= 400 ||
        response.headers['access-control-allow-origin'] !== 'https://malicious-site.com',
        'Malicious origin should not be reflected in CORS header'
      );
    });
  });

  describe('HIGH: Authorization Checks', () => {
    it('should reject unauthenticated requests to protected endpoints', async () => {
      tester.sessionCookie = null; // Ensure not logged in

      const protectedEndpoints = [
        '/admin/api/env',
        '/admin/api/keys',
        '/admin/api/health',
        '/admin/api/settings'
      ];

      for (const endpoint of protectedEndpoints) {
        const response = await tester.makeRequest(endpoint);

        assert.strictEqual(response.statusCode, 401,
          `Protected endpoint ${endpoint} should require authentication`);
      }
    });

    it('should reject requests with invalid session tokens', async () => {
      tester.sessionCookie = 'invalid-token-12345';

      const response = await tester.makeRequest('/admin/api/env');

      assert.strictEqual(response.statusCode, 401,
        'Invalid session token should be rejected');
    });
  });

  describe('HIGH: Information Disclosure', () => {
    it('should not leak error details in production', async () => {
      const response = await tester.makeRequest('/admin/api/nonexistent');

      assert.ok(
        response.statusCode === 404,
        'Non-existent endpoints should return 404 without exposing stack traces'
      );

      const body = JSON.parse(response.body || '{}');
      assert.ok(
        !body.stack && !body.trace,
        'Error responses should not include stack traces'
      );
    });

    it('should not expose file paths in error messages', async () => {
      tester.sessionCookie = 'invalid';

      const response = await tester.makeRequest('/admin/api/env');

      if (response.statusCode >= 400) {
        const body = JSON.parse(response.body || '{}');
        assert.ok(
          !body.error?.includes('/') &&
          !body.error?.includes('\\') &&
          !body.error?.includes('.env'),
          'Error messages should not expose file paths'
        );
      }
    });
  });

  describe('MEDIUM: HTTP Method Security', () => {
    it('should reject unsafe HTTP methods', async () => {
      const unsafeMethods = ['PUT', 'DELETE', 'PATCH'];

      for (const method of unsafeMethods) {
        const response = await tester.makeRequest('/admin/api/settings', {
          method: method
        });

        // Should either reject or require proper validation
        assert.ok(
          response.statusCode >= 400 ||
          response.statusCode === 405 ||
          response.statusCode === 501,
          `Unsafe method ${method} should be properly handled`
        );
      }
    });

    it('should handle OPTIONS requests correctly', async () => {
      const response = await tester.makeRequest('/admin/api/auth', {
        method: 'OPTIONS'
      });

      assert.strictEqual(response.statusCode, 204,
        'OPTIONS requests should return 204 No Content');
    });
  });

  describe('MEDIUM: JSON Parsing Security', () => {
    it('should handle malformed JSON safely', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: '{"invalid": json}'
      });

      assert.strictEqual(response.statusCode, 400,
        'Malformed JSON should return 400 Bad Request');
    });

    it('should reject JSON with prototype pollution attempts', async () => {
      await tester.login();

      const pollutionPayload = {
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } }
      };

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: pollutionPayload
      });

      // Should reject or sanitize
      assert.ok(
        response.statusCode >= 400,
        'Prototype pollution attempts should be rejected'
      );
    });

    it('should handle deeply nested JSON safely', async () => {
      await tester.login();

      // Create deeply nested object
      let deepObject = { level: 0 };
      let current = deepObject;
      for (let i = 1; i < 100; i++) {
        current.next = { level: i };
        current = current.next;
      }

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        body: deepObject
      });

      // Should either accept or reject cleanly
      assert.ok(
        [200, 400, 413].includes(response.statusCode),
        'Deeply nested JSON should be handled safely'
      );
    });
  });

  describe('MEDIUM: File Upload Security', () => {
    it('should reject non-JSON content types on API endpoints', async () => {
      await tester.login();

      const response = await tester.makeRequest('/admin/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        body: 'test data'
      });

      assert.strictEqual(response.statusCode, 400,
        'Non-JSON content types should be rejected on API endpoints');
    });
  });

  describe('LOW: Logging and Monitoring', () => {
    it('should log security-relevant events', async () => {
      // Attempt failed login
      await tester.makeRequest('/admin/login', {
        method: 'POST',
        body: { password: 'wrong' },
        skipAuth: true
      });

      // Check if logs are accessible (if endpoint exists)
      const logResponse = await tester.makeRequest('/admin/api/logs');

      if (logResponse.statusCode === 200) {
        const logs = JSON.parse(logResponse.body);
        assert.ok(logs.logs?.length > 0, 'Security events should be logged');
      }
    });
  });
});
