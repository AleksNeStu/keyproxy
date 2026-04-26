/**
 * KeyProxy MCP Intercept Module
 *
 * Transparent HTTP interception for MCP servers.
 * Routes API calls through KeyProxy for automatic key rotation.
 *
 * Usage: NODE_OPTIONS=--require /path/to/mcp-intercept.cjs
 *
 * Config (env vars):
 *   KEYPROXY_URL          - Proxy base URL (default: http://localhost:8990)
 *   KEYPROXY_ROUTES       - JSON map of { "api.host.com": "provider" } (default: built-in)
 *   KEYPROXY_STATUS_CODES - Comma-separated codes triggering rotation (default: 429,402,403)
 *
 * Layer 1: globalThis.fetch  — covers native fetch (Brave, Firecrawl)
 * Layer 2: http/https.request — covers axios (Exa), node-fetch (Jina)
 */

'use strict';

const PROXY_URL = (process.env.KEYPROXY_URL || 'http://localhost:8990').replace(/\/+$/, '');
const STATUS_CODES = process.env.KEYPROXY_STATUS_CODES || '429,402,403';

// Default route mapping: API host → KeyProxy provider name
const DEFAULT_ROUTES = {
  'api.search.brave.com': 'brave',
  'api.exa.ai': 'exa',
  'r.jina.ai': 'jina',
  's.jina.ai': 'jina',
  'api.firecrawl.dev': 'firecrawl',
  'api.context7.com': 'context7',
};

let routes;
try {
  routes = process.env.KEYPROXY_ROUTES ? JSON.parse(process.env.KEYPROXY_ROUTES) : DEFAULT_ROUTES;
} catch {
  routes = DEFAULT_ROUTES;
}

// Parse proxy URL into host/port
let proxyHost, proxyPort;
try {
  const u = new URL(PROXY_URL);
  proxyHost = u.hostname;
  proxyPort = parseInt(u.port) || 80;
} catch {
  proxyHost = 'localhost';
  proxyPort = 8990;
}

// Auth headers to strip from intercepted requests
const AUTH_HEADERS = [
  'authorization',
  'x-api-key',
  'x-subscription-token',
];

function matchRoute(urlStr) {
  if (!urlStr) return null;
  try {
    const host = typeof urlStr === 'string' ? new URL(urlStr).hostname : null;
    if (host && routes[host]) {
      return { host, provider: routes[host] };
    }
  } catch {}
  return null;
}

function proxyAuthHeader() {
  return `Bearer [STATUS_CODES:${STATUS_CODES}]`;
}

// ── Layer 1: globalThis.fetch ────────────────────────────────────────────────

if (typeof globalThis.fetch === 'function') {
  const origFetch = globalThis.fetch;

  globalThis.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input?.url);
    const route = matchRoute(url);

    if (!route) {
      return origFetch.apply(this, arguments);
    }

    const newUrl = url.replace(`https://${route.host}`, `${PROXY_URL}/${route.provider}`);
    const newInit = { ...init };

    if (newInit?.headers) {
      const h = newInit.headers instanceof Headers
        ? new Headers(newInit.headers)
        : new Headers(Object.entries(newInit.headers));
      for (const ah of AUTH_HEADERS) {
        h.delete(ah);
      }
      h.set('Authorization', proxyAuthHeader());
      newInit.headers = h;
    } else {
      newInit.headers = new Headers({ 'Authorization': proxyAuthHeader() });
    }

    // Handle Request objects
    if (input instanceof Request) {
      return origFetch(new Request(newUrl, { ...input, ...newInit }));
    }

    return origFetch(newUrl, newInit);
  };

  console.log('[keyproxy-intercept] Layer 1 active: globalThis.fetch patched');
}

// ── Layer 2: http.request / https.request ────────────────────────────────────

try {
  const http = require('http');
  const https = require('https');

  function patchModule(mod, modName) {
    const origRequest = mod.request;

    mod.request = function(opts, cb) {
      let host;

      if (typeof opts === 'string') {
        try { host = new URL(opts).hostname; } catch {}
      } else if (opts instanceof URL) {
        host = opts.hostname;
      } else if (opts && typeof opts === 'object') {
        host = opts.hostname || opts.host;
      }

      const route = host ? matchRoute(`https://${host}`) : null;

      if (!route) {
        return origRequest.apply(this, arguments);
      }

      // Build new options
      let newOpts;
      if (typeof opts === 'string' || opts instanceof URL) {
        const oldUrl = typeof opts === 'string' ? opts : opts.href;
        const parsed = new URL(oldUrl);
        newOpts = {
          hostname: proxyHost,
          port: proxyPort,
          path: `/${route.provider}${parsed.pathname}${parsed.search}`,
          method: 'GET',
          headers: {},
        };
      } else {
        newOpts = { ...opts };
        newOpts.hostname = proxyHost;
        newOpts.port = proxyPort;
        newOpts.path = `/${route.provider}${opts.path || '/'}`;
        newOpts.headers = { ...opts.headers };
      }

      // Strip auth headers
      for (const key of Object.keys(newOpts.headers || {})) {
        if (AUTH_HEADERS.includes(key.toLowerCase())) {
          delete newOpts.headers[key];
        }
      }
      newOpts.headers = newOpts.headers || {};
      newOpts.headers['Authorization'] = proxyAuthHeader();

      return origRequest.call(this, newOpts, cb);
    };
  }

  patchModule(http, 'http');
  patchModule(https, 'https');

  console.log('[keyproxy-intercept] Layer 2 active: http/https.request patched');
} catch (e) {
  console.log('[keyproxy-intercept] Layer 2 skipped:', e.message);
}

// ── Summary ──────────────────────────────────────────────────────────────────

const routeList = Object.entries(routes).map(([h, p]) => `${h} → ${p}`).join(', ');
console.log(`[keyproxy-intercept] Routes: ${routeList}`);
console.log(`[keyproxy-intercept] Proxy: ${PROXY_URL}`);
console.log(`[keyproxy-intercept] Status codes: ${STATUS_CODES}`);
