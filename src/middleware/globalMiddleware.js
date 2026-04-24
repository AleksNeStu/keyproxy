/**
 * Global middleware function to handle security headers and CORS for all requests
 */
function globalMiddleware(req, res, next) {
  // Add security headers
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy - updated to allow CDN resources
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' data:; " +
    "connect-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );

  // Permissions policy
  res.setHeader('Permissions-Policy',
    'geolocation=(), ' +
    'microphone=(), ' +
    'camera=(), ' +
    'payment=(), ' +
    'usb=()'
  );

  // CORS headers - fix for CDN resources
  const corsOrigin = '*';
  res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin, X-CSRF-Token');
  res.setHeader('Access-Control-Allow-Credentials', 'false'); // No credentials for CDN

  // HSTS (only on HTTPS)
  if (req.connection.encrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

module.exports = globalMiddleware;