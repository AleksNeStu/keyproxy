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
const STATUS_CODES = process.env.KEYPROXY_STATUS_CODES || '401,429,402,403';

// Default route mapping: API host → KeyProxy provider name
const DEFAULT_ROUTES = {
  'api.search.brave.com': 'brave',
  'api.exa.ai': 'exa',
  'r.jina.ai': 'jina',
  's.jina.ai': 'jina',
  'api.firecrawl.dev': 'firecrawl',
  'context7.com': 'context7',
  'api.tavily.com': 'tavily',
  'api.ref.tools': 'onref',
};

// Auto-fill missing API key env vars so MCP servers start without real keys
const KNOWN_KEYS = {
  'BRAVE_API_KEY': 'brave',
  'EXA_API_KEY': 'exa',
  'JINA_API_KEY': 'jina',
  'FIRECRAWL_API_KEY': 'firecrawl',
  'CONTEXT7_API_KEY': 'context7',
  'TAVILY_API_KEY': 'tavily',
  'REF_API_KEY': 'onref',
};
for (const [envVar] of Object.entries(KNOWN_KEYS)) {
  if (!process.env[envVar]) {
    process.env[envVar] = 'placeholder';
  }
}

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
  'x-ref-api-key',
  'x-goog-api-key',
];

// Body fields to strip from intercepted requests (some APIs send key in body AND header)
const BODY_KEY_FIELDS = ['api_key', 'apikey', 'api-key'];

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

function stripBodyKeys(body) {
  if (typeof body !== 'string') return body;
  try {
    const obj = JSON.parse(body);
    if (typeof obj !== 'object' || obj === null) return body;
    let changed = false;
    for (const field of BODY_KEY_FIELDS) {
      if (field in obj) {
        delete obj[field];
        changed = true;
      }
    }
    return changed ? JSON.stringify(obj) : body;
  } catch {
    return body;
  }
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

    // Strip body keys (e.g., Tavily sends api_key in JSON body)
    if (newInit?.body && typeof newInit.body === 'string') {
      newInit.body = stripBodyKeys(newInit.body);
    }

    if (newInit?.headers) {
      const h = newInit.headers instanceof Headers
        ? new Headers(newInit.headers)
        : new Headers(Object.entries(newInit.headers));
      for (const ah of AUTH_HEADERS) {
        h.delete(ah);
      }
      h.set('Authorization', proxyAuthHeader());
      h.set('X-KeyProxy-Original-Host', route.host);
      newInit.headers = h;
    } else {
      newInit.headers = new Headers({ 'Authorization': proxyAuthHeader(), 'X-KeyProxy-Original-Host': route.host });
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

    mod.request = function(urlOrOpts, optionsOrCb, maybeCb) {
      // Normalize: http.request(url, options, cb) | http.request(url, cb) | http.request(options, cb)
      let url, options, cb;
      if (typeof urlOrOpts === 'string' || urlOrOpts instanceof URL) {
        url = urlOrOpts;
        if (typeof optionsOrCb === 'function') {
          cb = optionsOrCb;
          options = {};
        } else {
          options = optionsOrCb || {};
          cb = maybeCb;
        }
      } else {
        options = urlOrOpts || {};
        cb = optionsOrCb;
      }

      // Extract host from url or options
      let host;
      if (url) {
        try { host = new URL(typeof url === 'string' ? url : url.href).hostname; } catch {}
      } else if (options) {
        host = options.hostname || options.host;
      }

      const route = host ? matchRoute(`https://${host}`) : null;

      if (!route) {
        return origRequest.apply(this, arguments);
      }

      // Build new options
      let newOpts;
      if (url) {
        const urlStr = typeof url === 'string' ? url : url.href;
        const parsed = new URL(urlStr);
        newOpts = {
          ...options,
          hostname: proxyHost,
          port: proxyPort,
          path: `/${route.provider}${parsed.pathname}${parsed.search}`,
          method: options.method || 'GET',
          headers: { ...options.headers },
        };
      } else {
        newOpts = { ...options };
        newOpts.hostname = proxyHost;
        newOpts.port = proxyPort;
        newOpts.path = `/${route.provider}${options.path || '/'}`;
        newOpts.headers = { ...options.headers };
      }

      // Strip HTTPS properties that conflict with HTTP proxy
      delete newOpts.protocol;
      delete newOpts.host;
      delete newOpts.agent;
      delete newOpts.socketPath;

      // Strip auth headers
      for (const key of Object.keys(newOpts.headers || {})) {
        if (AUTH_HEADERS.includes(key.toLowerCase())) {
          delete newOpts.headers[key];
        }
      }
      newOpts.headers = newOpts.headers || {};
      newOpts.headers['Authorization'] = proxyAuthHeader();
      newOpts.headers['X-KeyProxy-Original-Host'] = host;

      // Use http.request (not https) since KeyProxy listens on plain HTTP
      const req = http.request(newOpts, cb);

      // Intercept req.write() to strip API key fields from JSON body.
      // This is needed for MCP servers using axios (Layer 2) that send api_key
      // in the request body (e.g. Tavily MCP sends both header + body auth).
      // We intercept write() instead of buffering the entire body to avoid
      // deadlocks with follow-redirects Writable stream lifecycle.
      const origWrite = req.write.bind(req);
      let firstWrite = true;
      req.write = function(data, encoding, callback) {
        if (firstWrite && typeof data === 'string') {
          firstWrite = false;
          const stripped = stripBodyKeys(data);
          return origWrite(stripped, encoding, callback);
        }
        return origWrite(data, encoding, callback);
      };

      return req;
    };
  }

  patchModule(http, 'http');
  patchModule(https, 'https');

  console.log('[keyproxy-intercept] Layer 2 active: http/https.request patched');
} catch (e) {
  console.log('[keyproxy-intercept] Layer 2 skipped:', e.message);
}

// ── Zombie cleanup ─────────────────────────────────────────────────────────

// On Windows, MCP server processes (especially via npx) may not be properly
// terminated on reconnect, leaving orphan processes that accumulate over time.
// Kill stale siblings of the SAME package only (not other MCP servers).
try {
  const { execSync } = require('child_process');

  const entryPoint = process.argv[1] || '';
  if (entryPoint && process.platform === 'win32') {
    // Extract the package name from the entry point path (e.g. "exa-mcp-server")
    const pathParts = entryPoint.replace(/\\/g, '/').split('/');
    const pkgIdx = pathParts.findIndex(p => p === 'node_modules');
    const pkgName = pkgIdx >= 0 ? pathParts[pkgIdx + 1] : null;

    if (pkgName) {
      const cmd = `wmic process where "name='node.exe' and processid!=${process.pid}" get processid,commandline /format:csv 2>nul`;
      const output = execSync(cmd, { timeout: 3000, encoding: 'utf8' }).trim();
      const lines = output.split('\n').filter(l => l.includes(pkgName));

      for (const line of lines) {
        const match = line.match(/"(\d+)"/);
        if (match) {
          const pid = parseInt(match[1]);
          if (pid && pid !== process.pid) {
            try {
              process.kill(pid);
              console.log(`[keyproxy-intercept] Killed zombie ${pkgName} PID ${pid}`);
            } catch {}
          }
        }
      }
    }
  }
} catch {} // Silent — cleanup is best-effort

// ── Summary ──────────────────────────────────────────────────────────────────

const routeList = Object.entries(routes).map(([h, p]) => `${h} → ${p}`).join(', ');
console.log(`[keyproxy-intercept] Routes: ${routeList}`);
console.log(`[keyproxy-intercept] Proxy: ${PROXY_URL}`);
console.log(`[keyproxy-intercept] Status codes: ${STATUS_CODES}`);
