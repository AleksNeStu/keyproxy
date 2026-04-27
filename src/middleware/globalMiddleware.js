const { addSecurityHeaders } = require('./securityHeaders');

/**
 * Global middleware function to handle security headers and CORS for all requests.
 * Delegates security headers to addSecurityHeaders to avoid duplication.
 */
function globalMiddleware(req, res, next) {
  // Security headers (delegated to centralized implementation)
  addSecurityHeaders(req, res, () => {});

  // CORS headers
  const corsOrigin = '*';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'false');

  next();
}

module.exports = globalMiddleware;
