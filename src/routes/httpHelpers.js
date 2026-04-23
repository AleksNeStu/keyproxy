/**
 * Shared HTTP utility functions.
 * Pure helpers with no dependency on the ProxyServer instance.
 */

/**
 * Send a JSON error response.
 */
function sendError(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
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
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      resolve(body || null);
    });
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
  isStreamingRequest
};
