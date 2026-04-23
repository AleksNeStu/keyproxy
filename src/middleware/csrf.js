/**
 * CSRF Protection Middleware
 *
 * Implements Synchronizer Token Pattern to prevent Cross-Site Request Forgery attacks.
 *
 * Features:
 * - Cryptographically secure token generation (256-bit entropy)
 * - Timing-safe token comparison to prevent timing attacks
 * - Token rotation after successful state-changing operations
 * - Automatic exclusion of safe methods (GET, HEAD, OPTIONS)
 *
 * Usage:
 * - Token generation: On login, retrieve via GET /admin/api/csrf-token
 * - Token validation: Applied to all state-changing operations (POST/PUT/DELETE/PATCH)
 * - Token format: 64-character hexadecimal string (32 bytes → 64 hex chars)
 */

const crypto = require('crypto');

/**
 * Generate a cryptographically secure CSRF token.
 * @returns {string} 64-character hexadecimal token
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate CSRF token using timing-safe comparison.
 * @param {string} sessionToken - Token stored in session
 * @param {string} headerToken - Token from X-CSRF-Token header
 * @returns {boolean} True if tokens match, false otherwise
 */
function validateCsrfToken(sessionToken, headerToken) {
  if (!sessionToken || !headerToken) {
    return false;
  }

  if (sessionToken.length !== 64 || headerToken.length !== 64) {
    return false;
  }

  try {
    const sessionBuffer = Buffer.from(sessionToken, 'hex');
    const headerBuffer = Buffer.from(headerToken, 'hex');

    // Use timingSafeEqual to prevent timing attacks
    return crypto.timingSafeEqual(sessionBuffer, headerBuffer);
  } catch (error) {
    // Invalid hex format
    return false;
  }
}

/**
 * Extract CSRF token from request headers.
 * @param {Object} headers - Request headers object
 * @returns {string|null} CSRF token or null if not present
 */
function extractCsrfToken(headers) {
  // Case-insensitive header lookup
  const token = headers['x-csrf-token'] || headers['X-CSRF-Token'] || headers['X-Csrf-Token'];
  return token || null;
}

/**
 * Routes that should be excluded from CSRF validation.
 * Format: exact path match or pattern with wildcard (*)
 */
const CSRF_EXEMPT_ROUTES = [
  '/admin/login',                    // Login endpoint (no session yet)
  '/admin/api/csrf-token',           // Token retrieval endpoint
  '/admin/api/auth',                 // Auth check endpoint
  '/admin/api/login-status'          // Login status check
];

/**
 * Check if a route should be exempt from CSRF validation.
 * @param {string} path - Request path
 * @param {string} method - HTTP method
 * @returns {boolean} True if route is exempt
 */
function isCsrfExemptRoute(path, method) {
  // Always exempt safe methods (GET, HEAD, OPTIONS)
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  // Check exact path matches
  if (CSRF_EXEMPT_ROUTES.includes(path)) {
    return true;
  }

  return false;
}

/**
 * Middleware factory for CSRF protection.
 * Returns a middleware function that validates CSRF tokens for state-changing requests.
 *
 * @param {Object} server - ProxyServer instance (for session access)
 * @returns {Function} Express-style middleware function
 */
function csrfMiddleware(server) {
  return async function(req, res, next) {
    const path = req.url;
    const method = req.method;

    // Skip CSRF validation for exempt routes
    if (isCsrfExemptRoute(path, method)) {
      return next();
    }

    // Only validate state-changing operations
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next();
    }

    // Ensure user is authenticated first
    if (!server.adminSessionToken) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Extract and validate CSRF token
    const headerToken = extractCsrfToken(req.headers);
    const sessionToken = server.csrfToken || null;

    if (!validateCsrfToken(sessionToken, headerToken)) {
      console.log(`[SECURITY] CSRF validation failed for ${method} ${path}`);
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid CSRF token' }));
      return;
    }

    // Token is valid - proceed to next middleware/route handler
    next();
  };
}

/**
 * Helper function to create a new CSRF token and store it in the session.
 * Should be called after login and after successful state-changing operations.
 *
 * @param {Object} server - ProxyServer instance
 * @returns {string} New CSRF token
 */
function refreshCsrfToken(server) {
  const newToken = generateCsrfToken();
  server.csrfToken = newToken;
  return newToken;
}

/**
 * Helper function to get the current CSRF token from session.
 *
 * @param {Object} server - ProxyServer instance
 * @returns {string|null} Current CSRF token or null if not set
 */
function getCsrfToken(server) {
  return server.csrfToken || null;
}

module.exports = {
  generateCsrfToken,
  validateCsrfToken,
  extractCsrfToken,
  csrfMiddleware,
  refreshCsrfToken,
  getCsrfToken,
  CSRF_EXEMPT_ROUTES
};
