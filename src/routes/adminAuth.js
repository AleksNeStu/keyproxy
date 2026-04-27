/**
 * Admin authentication route handlers.
 * Login, logout, session check, password management.
 */

const crypto = require('crypto');
const Auth = require('../core/auth');
const { sendError, parseCookies } = require('./httpHelpers');
const { refreshCsrfToken } = require('../middleware/csrf');
const { validatePasswordStrength } = require('../middleware/validation');

/**
 * Check if the current request is authenticated via session cookie.
 */
function isAdminAuthenticated(server, req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies.adminSession === server.adminSessionToken && server.adminSessionToken !== null;
}

/**
 * Generate a random session token.
 */
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Handle admin login.
 * POST /admin/login
 */
async function handleAdminLogin(server, req, res, body) {
  try {
    // Check if login is currently blocked
    if (server.loginBlockedUntil && Date.now() < server.loginBlockedUntil) {
      const remainingSeconds = Math.ceil((server.loginBlockedUntil - Date.now()) / 1000);
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: `Too many failed login attempts. Please wait ${remainingMinutes} minute(s).`,
        blockedUntil: server.loginBlockedUntil,
        remainingSeconds: remainingSeconds
      }));
      return;
    }

    const data = JSON.parse(body);
    const adminPassword = server.getAdminPassword();

    console.log('[SECURITY] Login attempt, password provided:', data.password ? 'yes' : 'no');
    console.log('[SECURITY] Admin password configured:', adminPassword ? 'yes' : 'no');

    if (Auth.verifyPassword(data.password, adminPassword)) {
      // Successful login - reset counters
      server.failedLoginAttempts = 0;
      server.loginBlockedUntil = null;
      server.adminSessionToken = generateSessionToken();

      // Generate and store CSRF token
      const csrfToken = refreshCsrfToken(server);

      console.log('[SECURITY] Successful admin login');

      // Set session cookie (expires in 24 hours)
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
      const upgradeAvailable = !Auth.isHash(adminPassword) && !Auth.loadHashFromFile();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `adminSession=${server.adminSessionToken}; HttpOnly; SameSite=Strict; Expires=${expires}; Path=/admin`
      });
      res.end(JSON.stringify({
        success: true,
        passwordUpgradeAvailable: upgradeAvailable,
        csrfToken: csrfToken
      }));
      console.log('[SECURITY] Session token set, CSRF token generated, cookie sent');
    } else {
      // Failed login - increment counter
      server.failedLoginAttempts++;
      const attemptsRemaining = 5 - server.failedLoginAttempts;

      // Block if reached 5 attempts
      if (server.failedLoginAttempts >= 5) {
        server.loginBlockedUntil = Date.now() + (5 * 60 * 1000); // 5 minutes
        console.log('[SECURITY] Login blocked due to 5 failed attempts. Blocked until:', new Date(server.loginBlockedUntil).toISOString());
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Too many failed login attempts. Please wait 5 minutes.',
          blockedUntil: server.loginBlockedUntil,
          remainingSeconds: 300
        }));
      } else {
        console.log(`[SECURITY] Failed login attempt ${server.failedLoginAttempts}/5`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Invalid password. ${attemptsRemaining} attempt(s) remaining.`,
          attemptsRemaining: attemptsRemaining
        }));
      }
    }
  } catch (error) {
    sendError(res, 400, 'Invalid request');
  }
}

/**
 * Handle admin logout.
 * POST /admin/logout
 */
function handleAdminLogout(server, req, res) {
  server.adminSessionToken = null;
  server.csrfToken = null; // Clear CSRF token on logout
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'adminSession=; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/admin'
  });
  res.end(JSON.stringify({ success: true }));
}

/**
 * Handle auth check.
 * GET /admin/api/auth
 */
function handleAuthCheck(server, req, res) {
  const isAuthenticated = isAdminAuthenticated(server, req);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ authenticated: isAuthenticated }));
}

/**
 * Handle password change.
 * POST /admin/api/change-password
 */
async function handleChangePassword(server, req, res, body) {
  try {
    const { currentPassword, newPassword } = JSON.parse(body);
    if (!currentPassword || !newPassword) {
      sendError(res, 400, 'Missing currentPassword or newPassword');
      return;
    }

    // Validate password strength
    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      sendError(res, 400, `Password too weak: ${strengthCheck.errors.join(', ')}`);
      return;
    }

    const adminPassword = server.getAdminPassword();
    if (!Auth.verifyPassword(currentPassword, adminPassword)) {
      sendError(res, 401, 'Current password is incorrect');
      return;
    }

    const hashed = Auth.hashPassword(newPassword);
    Auth.saveHashToFile(hashed);
    const path = require('path');
    Auth.removePasswordFromEnv(path.join(process.cwd(), '.env'));
    server.clearAdminPasswordCache();
    server.auditLog.log('change_password', {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to change password');
  }
}

/**
 * Handle password upgrade to hashed format.
 * POST /admin/api/upgrade-password
 */
async function handleUpgradePassword(server, req, res) {
  try {
    const adminPassword = server.getAdminPassword();
    if (!adminPassword) {
      sendError(res, 400, 'No admin password configured');
      return;
    }

    const hash = Auth.isHash(adminPassword)
      ? adminPassword
      : Auth.hashPassword(adminPassword);

    Auth.saveHashToFile(hash);
    const path = require('path');
    Auth.removePasswordFromEnv(path.join(process.cwd(), '.env'));
    server.clearAdminPasswordCache();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to upgrade password');
  }
}

/**
 * GET /admin/api/csrf-token — get or generate CSRF token.
 * Has its own auth check (runs before the main auth gate).
 */
function handleGetCsrfToken(server, req, res) {
  if (!isAdminAuthenticated(server, req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }
  const { getCsrfToken } = require('../middleware/csrf');
  const currentToken = getCsrfToken(server);
  if (!currentToken) {
    const newToken = refreshCsrfToken(server);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ csrfToken: newToken }));
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ csrfToken: currentToken }));
  }
}

/**
 * GET /admin/api/login-status — check if login is rate-limited.
 */
function handleGetLoginStatus(server, res) {
  const now = Date.now();
  const isBlocked = server.loginBlockedUntil && now < server.loginBlockedUntil;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    blocked: isBlocked,
    blockedUntil: server.loginBlockedUntil,
    remainingSeconds: isBlocked ? Math.ceil((server.loginBlockedUntil - now) / 1000) : 0,
    failedAttempts: server.failedLoginAttempts
  }));
}

module.exports = {
  isAdminAuthenticated,
  generateSessionToken,
  handleAdminLogin,
  handleAdminLogout,
  handleAuthCheck,
  handleChangePassword,
  handleUpgradePassword,
  handleGetCsrfToken,
  handleGetLoginStatus
};
