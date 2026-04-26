/**
 * Shared HTTP utility functions.
 * Pure helpers with no dependency on the ProxyServer instance.
 */

const crypto = require('crypto');
const { categorizeHttpError } = require('../core/errorHandler');

/**
 * Send a JSON error response with debugging context.
 * @param {Object} res - Response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} context - Optional debugging context
 */
function sendError(res, statusCode, message, context = {}) {
  const {
    endpoint,
    method,
    provider,
    includeDetails = process.env.NODE_ENV !== 'production',
    retryAfter
  } = context;

  const requestId = res._requestId || crypto.randomBytes(4).toString('hex');
  const timestamp = new Date().toISOString();

  const errorResponse = {
    error: message,
    statusCode: statusCode,
    requestId: requestId,
    timestamp: timestamp
  };

  if (includeDetails) {
    if (endpoint) errorResponse.endpoint = endpoint;
    if (method) errorResponse.method = method;
    if (provider) errorResponse.provider = provider;
    errorResponse.category = categorizeHttpError(statusCode, message);
  }

  if (statusCode === 429 && retryAfter) {
    errorResponse.retryAfter = retryAfter;
    errorResponse.limit = context.limit;
    errorResponse.remaining = 0;
    errorResponse.resetAt = new Date(Date.now() + retryAfter * 1000).toISOString();
  }

  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId
  });
  res.end(JSON.stringify(errorResponse));
}

/**
 * Send a proxied response (statusCode + headers + data).
 */
function sendResponse(res, response) {
  res.writeHead(response.statusCode, response.headers);
  res.end(response.data);
}

/**
 * Read the full request body as a string.
 */
function readRequestBody(req) {
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      done(body || null);
    });
    req.on('error', () => {
      done(null);
    });

    // Safety timeout — resolve even if 'end' never fires (e.g. empty POST with no Content-Length)
    setTimeout(() => done(body || null), 3000);
  });
}

/**
 * Parse a JSON body string into an object, returning null on failure.
 */
function parseJsonBody(body) {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Parse a Cookie header string into an object.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const parts = cookie.trim().split('=');
      if (parts.length === 2) {
        cookies[parts[0]] = parts[1];
      }
    });
  }
  return cookies;
}

/**
 * Get a human-readable status text for common HTTP codes.
 */
function getStatusText(statusCode) {
  const statusTexts = {
    200: 'OK',
    201: 'Created',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout'
  };
  return statusTexts[statusCode] || 'Unknown Status';
}

/**
 * Detect if a request body contains stream: true.
 */
function isStreamingRequest(body) {
  if (!body) return false;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    return parsed.stream === true;
  } catch {
    return false;
  }
}

module.exports = {
  sendError,
  sendResponse,
  readRequestBody,
  parseJsonBody,
  parseCookies,
  getStatusText,
  isStreamingRequest,
  categorizeHttpError
};
