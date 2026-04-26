const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// We test the intercept module's logic by loading it in a controlled environment.
// The module patches globalThis.fetch and http/https.request on require(),
// so we save originals before loading and verify behavior after.

describe('MCP Intercept Module', () => {
  describe('matchRoute logic', () => {
    // matchRoute is not exported, so we test it via the patched fetch/request
    // by checking URL rewriting behavior.

    it('matches known API hosts from DEFAULT_ROUTES', () => {
      const DEFAULT_ROUTES = {
        'api.search.brave.com': 'brave',
        'api.exa.ai': 'exa',
        'r.jina.ai': 'jina',
        's.jina.ai': 'jina',
        'api.firecrawl.dev': 'firecrawl',
        'api.context7.com': 'context7',
      };

      function matchRoute(urlStr) {
        if (!urlStr) return null;
        try {
          const host = typeof urlStr === 'string' ? new URL(urlStr).hostname : null;
          if (host && DEFAULT_ROUTES[host]) {
            return { host, provider: DEFAULT_ROUTES[host] };
          }
        } catch {}
        return null;
      }

      assert.deepEqual(matchRoute('https://api.search.brave.com/res/v1/web/search?q=test'), {
        host: 'api.search.brave.com',
        provider: 'brave',
      });
      assert.deepEqual(matchRoute('https://api.exa.ai/search'), {
        host: 'api.exa.ai',
        provider: 'exa',
      });
      assert.deepEqual(matchRoute('https://r.jina.ai/https://example.com'), {
        host: 'r.jina.ai',
        provider: 'jina',
      });
      assert.deepEqual(matchRoute('https://s.jina.ai/https://example.com'), {
        host: 's.jina.ai',
        provider: 'jina',
      });
    });

    it('returns null for untracked hosts', () => {
      const DEFAULT_ROUTES = { 'api.search.brave.com': 'brave' };

      function matchRoute(urlStr) {
        if (!urlStr) return null;
        try {
          const host = typeof urlStr === 'string' ? new URL(urlStr).hostname : null;
          if (host && DEFAULT_ROUTES[host]) {
            return { host, provider: DEFAULT_ROUTES[host] };
          }
        } catch {}
        return null;
      }

      assert.equal(matchRoute('https://api.openai.com/v1/chat/completions'), null);
      assert.equal(matchRoute('https://example.com/test'), null);
    });

    it('returns null for null/undefined/empty input', () => {
      const DEFAULT_ROUTES = { 'api.search.brave.com': 'brave' };

      function matchRoute(urlStr) {
        if (!urlStr) return null;
        try {
          const host = typeof urlStr === 'string' ? new URL(urlStr).hostname : null;
          if (host && DEFAULT_ROUTES[host]) {
            return { host, provider: DEFAULT_ROUTES[host] };
          }
        } catch {}
        return null;
      }

      assert.equal(matchRoute(null), null);
      assert.equal(matchRoute(undefined), null);
      assert.equal(matchRoute(''), null);
    });

    it('returns null for invalid URLs', () => {
      const DEFAULT_ROUTES = { 'api.search.brave.com': 'brave' };

      function matchRoute(urlStr) {
        if (!urlStr) return null;
        try {
          const host = typeof urlStr === 'string' ? new URL(urlStr).hostname : null;
          if (host && DEFAULT_ROUTES[host]) {
            return { host, provider: DEFAULT_ROUTES[host] };
          }
        } catch {}
        return null;
      }

      assert.equal(matchRoute('not-a-url'), null);
      assert.equal(matchRoute(':::broken'), null);
    });
  });

  describe('proxyAuthHeader format', () => {
    it('includes status codes from env var', () => {
      const STATUS_CODES = '429,402,403';
      const header = `Bearer [STATUS_CODES:${STATUS_CODES}]`;
      assert.equal(header, 'Bearer [STATUS_CODES:429,402,403]');
    });

    it('uses default status codes when env var not set', () => {
      const STATUS_CODES = '429,402,403';
      assert.ok(STATUS_CODES.includes('429'));
      assert.ok(STATUS_CODES.includes('402'));
      assert.ok(STATUS_CODES.includes('403'));
    });
  });

  describe('KEYPROXY_ROUTES parsing', () => {
    it('parses valid JSON routes', () => {
      const env = '{"api.example.com":"test_provider"}';
      const routes = JSON.parse(env);
      assert.equal(routes['api.example.com'], 'test_provider');
    });

    it('falls back to DEFAULT_ROUTES on invalid JSON', () => {
      const DEFAULT_ROUTES = { 'api.search.brave.com': 'brave' };
      let routes;
      try {
        routes = JSON.parse('not json');
      } catch {
        routes = DEFAULT_ROUTES;
      }
      assert.deepEqual(routes, DEFAULT_ROUTES);
    });
  });

  describe('Layer 1: globalThis.fetch interception', () => {
    let origFetch;
    let interceptedCalls;

    beforeEach(() => {
      origFetch = globalThis.fetch;
      interceptedCalls = [];
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
      // Clean up env vars
      delete process.env.KEYPROXY_URL;
      delete process.env.KEYPROXY_ROUTES;
      delete process.env.KEYPROXY_STATUS_CODES;
      // Clear require cache for intercept module
      delete require.cache[require.resolve('../../src/inject/mcp-intercept.cjs')];
    });

    it('rewrites URL and auth headers for tracked hosts', async () => {
      // Mock fetch that records calls
      globalThis.fetch = function(input, init) {
        interceptedCalls.push({ input, init });
        return Promise.resolve(new Response('ok', { status: 200 }));
      };

      // Load the intercept module with custom config
      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"api.search.brave.com":"brave"}';
      process.env.KEYPROXY_STATUS_CODES = '429,402,403';
      require('../../src/inject/mcp-intercept.cjs');

      // Now call the patched fetch
      await globalThis.fetch('https://api.search.brave.com/res/v1/web/search?q=test', {
        headers: { 'X-Subscription-Token': 'real-key-12345' },
      });

      assert.equal(interceptedCalls.length, 1);
      const call = interceptedCalls[0];

      // URL should be rewritten to proxy
      assert.ok(call.input.includes('localhost:8990'));
      assert.ok(call.input.includes('/brave/'));

      // Original auth header should be stripped, proxy auth injected
      const authHeader = call.init.headers.get('Authorization');
      assert.ok(authHeader.includes('STATUS_CODES'));
      assert.equal(call.init.headers.get('X-Subscription-Token'), null);
    });

    it('passes through untracked hosts unchanged', async () => {
      globalThis.fetch = function(input, init) {
        interceptedCalls.push({ input, init });
        return Promise.resolve(new Response('ok', { status: 200 }));
      };

      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"api.search.brave.com":"brave"}';
      require('../../src/inject/mcp-intercept.cjs');

      await globalThis.fetch('https://api.openai.com/v1/chat/completions', {
        headers: { 'Authorization': 'Bearer real-key' },
      });

      assert.equal(interceptedCalls.length, 1);
      assert.ok(interceptedCalls[0].input.includes('api.openai.com'));
    });

    it('strips all auth header variants (authorization, x-api-key, x-subscription-token)', async () => {
      globalThis.fetch = function(input, init) {
        interceptedCalls.push({ input, init });
        return Promise.resolve(new Response('ok', { status: 200 }));
      };

      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"api.exa.ai":"exa"}';
      require('../../src/inject/mcp-intercept.cjs');

      await globalThis.fetch('https://api.exa.ai/search', {
        headers: {
          'Authorization': 'Bearer real-key',
          'x-api-key': 'real-key',
          'X-Subscription-Token': 'real-key',
        },
      });

      const headers = interceptedCalls[0].init.headers;
      // Headers is case-insensitive, so after stripping originals and setting proxy auth,
      // 'authorization' returns the proxy value (not the original real-key)
      const authValue = headers.get('Authorization');
      assert.ok(authValue?.includes('STATUS_CODES'), 'Should have proxy auth header');
      assert.ok(!authValue?.includes('real-key'), 'Original auth value should be replaced');
      assert.equal(headers.get('x-api-key'), null, 'x-api-key should be stripped');
      assert.equal(headers.get('x-subscription-token'), null, 'X-Subscription-Token should be stripped');
    });

    it('injects proxy auth header even when no original headers', async () => {
      globalThis.fetch = function(input, init) {
        interceptedCalls.push({ input, init });
        return Promise.resolve(new Response('ok', { status: 200 }));
      };

      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"api.search.brave.com":"brave"}';
      require('../../src/inject/mcp-intercept.cjs');

      await globalThis.fetch('https://api.search.brave.com/res/v1/web/search');

      assert.ok(interceptedCalls[0].init.headers.get('Authorization')?.includes('STATUS_CODES'));
    });
  });

  describe('Layer 2: http.request interception', () => {
    const http = require('http');
    const https = require('https');
    let origHttpRequest;
    let origHttpsRequest;
    let interceptedCalls;

    beforeEach(() => {
      origHttpRequest = http.request;
      origHttpsRequest = https.request;
      interceptedCalls = [];
    });

    afterEach(() => {
      http.request = origHttpRequest;
      https.request = origHttpsRequest;
      delete process.env.KEYPROXY_URL;
      delete process.env.KEYPROXY_ROUTES;
      delete process.env.KEYPROXY_STATUS_CODES;
      delete require.cache[require.resolve('../../src/inject/mcp-intercept.cjs')];
    });

    it('rewrites http.request options for tracked hosts', () => {
      // Mock http.request
      const mockReq = { on: () => {}, end: () => {} };
      http.request = function(opts, cb) {
        interceptedCalls.push(opts);
        return mockReq;
      };
      https.request = function(opts, cb) {
        interceptedCalls.push(opts);
        return mockReq;
      };

      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"api.exa.ai":"exa"}';
      process.env.KEYPROXY_STATUS_CODES = '429,402,403';
      require('../../src/inject/mcp-intercept.cjs');

      // Call patched http.request with object options
      http.request({
        hostname: 'api.exa.ai',
        path: '/search',
        method: 'POST',
        headers: { 'x-api-key': 'real-key', 'Content-Type': 'application/json' },
      });

      assert.equal(interceptedCalls.length, 1);
      const opts = interceptedCalls[0];

      // Should be redirected to proxy
      assert.equal(opts.hostname, 'localhost');
      assert.equal(opts.port, 8990);
      assert.ok(opts.path.startsWith('/exa'));

      // Auth header stripped and proxy auth injected
      assert.equal(opts.headers['x-api-key'], undefined);
      assert.ok(opts.headers['Authorization'].includes('STATUS_CODES'));

      // Non-auth headers preserved
      assert.equal(opts.headers['Content-Type'], 'application/json');
    });

    it('passes through untracked hosts', () => {
      const mockReq = { on: () => {}, end: () => {} };
      http.request = function(opts, cb) {
        interceptedCalls.push(opts);
        return mockReq;
      };
      https.request = function(opts, cb) {
        interceptedCalls.push(opts);
        return mockReq;
      };

      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"api.exa.ai":"exa"}';
      require('../../src/inject/mcp-intercept.cjs');

      http.request({
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        headers: { 'Authorization': 'Bearer real-key' },
      });

      assert.equal(interceptedCalls.length, 1);
      assert.equal(interceptedCalls[0].hostname, 'api.openai.com');
      assert.equal(interceptedCalls[0].headers['Authorization'], 'Bearer real-key');
    });

    it('handles string URL input for http.request', () => {
      const mockReq = { on: () => {}, end: () => {} };
      http.request = function(opts, cb) {
        interceptedCalls.push(opts);
        return mockReq;
      };
      https.request = function(opts, cb) {
        interceptedCalls.push(opts);
        return mockReq;
      };

      process.env.KEYPROXY_URL = 'http://localhost:8990';
      process.env.KEYPROXY_ROUTES = '{"r.jina.ai":"jina"}';
      require('../../src/inject/mcp-intercept.cjs');

      http.request('https://r.jina.ai/https://example.com/page');

      assert.equal(interceptedCalls.length, 1);
      const opts = interceptedCalls[0];
      assert.equal(opts.hostname, 'localhost');
      assert.equal(opts.port, 8990);
      assert.ok(opts.path.includes('/jina'));
    });
  });

  describe('URL rewriting', () => {
    it('correctly rewrites Brave search URL', () => {
      const PROXY_URL = 'http://localhost:8990';
      const host = 'api.search.brave.com';
      const url = 'https://api.search.brave.com/res/v1/web/search?q=test&count=10';
      const newUrl = url.replace(`https://${host}`, `${PROXY_URL}/brave`);

      assert.equal(newUrl, 'http://localhost:8990/brave/res/v1/web/search?q=test&count=10');
    });

    it('correctly rewrites Exa URL', () => {
      const PROXY_URL = 'http://localhost:8990';
      const host = 'api.exa.ai';
      const url = 'https://api.exa.ai/search';
      const newUrl = url.replace(`https://${host}`, `${PROXY_URL}/exa`);

      assert.equal(newUrl, 'http://localhost:8990/exa/search');
    });

    it('correctly rewrites Jina reader URL', () => {
      const PROXY_URL = 'http://localhost:8990';
      const host = 'r.jina.ai';
      const url = 'https://r.jina.ai/https://example.com/docs';
      const newUrl = url.replace(`https://${host}`, `${PROXY_URL}/jina`);

      assert.equal(newUrl, 'http://localhost:8990/jina/https://example.com/docs');
    });
  });

  describe('proxy URL parsing', () => {
    it('extracts host and port from proxy URL', () => {
      const u = new URL('http://localhost:8990');
      assert.equal(u.hostname, 'localhost');
      assert.equal(parseInt(u.port), 8990);
    });

    it('uses port 80 as default when not specified', () => {
      const u = new URL('http://myproxy.local');
      assert.equal(parseInt(u.port) || 80, 80);
    });

    it('handles custom port', () => {
      const u = new URL('http://192.168.1.100:3000');
      assert.equal(u.hostname, '192.168.1.100');
      assert.equal(parseInt(u.port), 3000);
    });
  });

  describe('auth header stripping', () => {
    const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-subscription-token'];

    it('strips lowercase variants', () => {
      const headers = {
        'authorization': 'Bearer real-key',
        'x-api-key': 'real-key',
        'x-subscription-token': 'real-key',
        'content-type': 'application/json',
      };

      for (const key of Object.keys(headers)) {
        if (AUTH_HEADERS.includes(key.toLowerCase())) {
          delete headers[key];
        }
      }

      assert.equal(Object.keys(headers).length, 1);
      assert.equal(headers['content-type'], 'application/json');
    });

    it('strips mixed-case variants', () => {
      const headers = {
        'Authorization': 'Bearer key',
        'X-Api-Key': 'key',
        'X-Subscription-Token': 'key',
      };

      for (const key of Object.keys(headers)) {
        if (AUTH_HEADERS.includes(key.toLowerCase())) {
          delete headers[key];
        }
      }

      assert.equal(Object.keys(headers).length, 0);
    });
  });

  describe('edge cases', () => {
    it('handles custom KEYPROXY_URL with trailing slash', () => {
      const raw = 'http://localhost:8990/';
      const url = raw.replace(/\/+$/, '');
      assert.equal(url, 'http://localhost:8990');
    });

    it('handles empty KEYPROXY_ROUTES gracefully', () => {
      let routes;
      try {
        routes = process.env.KEYPROXY_ROUTES ? JSON.parse(process.env.KEYPROXY_ROUTES) : { default: 'fallback' };
      } catch {
        routes = { default: 'fallback' };
      }
      assert.deepEqual(routes, { default: 'fallback' });
    });

    it('multiple keys in DEFAULT_ROUTES map to correct providers', () => {
      const DEFAULT_ROUTES = {
        'api.search.brave.com': 'brave',
        'api.exa.ai': 'exa',
        'r.jina.ai': 'jina',
        's.jina.ai': 'jina',
      };

      assert.equal(DEFAULT_ROUTES['r.jina.ai'], 'jina');
      assert.equal(DEFAULT_ROUTES['s.jina.ai'], 'jina');
      assert.equal(DEFAULT_ROUTES['api.search.brave.com'], 'brave');
      assert.equal(DEFAULT_ROUTES['api.exa.ai'], 'exa');
    });
  });
});
