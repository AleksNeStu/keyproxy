/**
 * Security Headers Middleware
 *
 * Implements security hardening headers and input sanitization.
 * Provides protection against XSS, clickjacking, MIME sniffing, and other attacks.
 */

/**
 * Add security headers to all responses.
 */
function addSecurityHeaders(req, res, next) {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS filter (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );

  // Permissions policy (formerly Feature-Policy)
  res.setHeader('Permissions-Policy',
    'geolocation=(), ' +
    'microphone=(), ' +
    'camera=(), ' +
    'payment=(), ' +
    'usb=()'
  );

  // HSTS (only on HTTPS)
  if (req.connection.encrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

/**
 * Remove null bytes and excessive whitespace from request data.
 * Prevents null byte injection and reduces attack surface.
 */
function sanitizeInput(req, res, next) {
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Remove null bytes and excessive whitespace
      return obj.replace(/\0/g, '').replace(/\s{20,}/g, ' '.repeat(5));
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[sanitize(key)] = sanitize(value);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query);
  }
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
}

/**
 * Rate limiter using sliding window.
 * @param {Object} options - Configuration options
 * @returns {Function} Middleware function
 */
function createRateLimiter(options = {}) {
  const {
    windowMs = 60000, // 1 minute
    maxRequests = 100
  } = options;

  const requests = new Map(); // IP -> [{timestamp, count}]

  return (req, res, next) => {
    const ip = req.socket.remoteAddress || req.connection.remoteAddress;
    const now = Date.now();

    // Clean old entries
    if (!requests.has(ip)) {
      requests.set(ip, []);
    }

    const ipRequests = requests.get(ip);

    // Remove entries outside the window
    const windowStart = now - windowMs;
    for (let i = ipRequests.length - 1; i >= 0; i--) {
      if (ipRequests[i].timestamp < windowStart) {
        ipRequests.splice(i, 1);
      }
    }

    // Count requests in window
    const requestCount = ipRequests.length;

    if (requestCount >= maxRequests) {
      console.log(`[RATE_LIMIT] IP ${ip} exceeded limit: ${requestCount}/${maxRequests}`);
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': Math.ceil(windowMs / 1000).toString()
      });
      res.end(JSON.stringify({
        error: 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000)
      }));
      return;
    }

    // Add current request
    ipRequests.push({ timestamp: now });

    // Auto-cleanup old IPs periodically
    if (requests.size > 10000) {
      for (const [key, value] of requests.entries()) {
        if (value.length === 0 || value[0].timestamp < windowStart) {
          requests.delete(key);
        }
      }
    }

    next();
  };
}

/**
 * Admin-specific rate limiter (stricter limits).
 */
const adminApiLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 100 // 100 requests per minute
});

/**
 * Login-specific rate limiter (very strict).
 */
const loginLimiter = createRateLimiter({
  windowMs: 900000, // 15 minutes
  maxRequests: 5 // 5 attempts per 15 minutes
});

module.exports = {
  addSecurityHeaders,
  sanitizeInput,
  createRateLimiter,
  adminApiLimiter,
  loginLimiter
};
