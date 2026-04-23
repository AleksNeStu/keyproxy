/**
 * Admin authentication route handlers.
 * Login, logout, session check, password management.
 */

const crypto = require('crypto');
const Auth = require('../core/auth');
const { sendError, parseCookies } = require('./httpHelpers');

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

      console.log('[SECURITY] Successful admin login');

      // Set session cookie (expires in 24 hours)
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toUTCString();
      const upgradeAvailable = !Auth.isHash(adminPassword) && !Auth.loadHashFromFile();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': `adminSession=${server.adminSessionToken}; HttpOnly; Secure; SameSite=Strict; Expires=${expires}; Path=/admin`
      });
      res.end(JSON.stringify({ success: true, passwordUpgradeAvailable: upgradeAvailable }));
      console.log('[SECURITY] Session token set, cookie sent');
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
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'adminSession=; HttpOnly; Secure; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/admin'
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

    if (newPassword.length < 6) {
      sendError(res, 400, 'New password must be at least 6 characters');
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to upgrade password');
  }
}

module.exports = {
  isAdminAuthenticated,
  generateSessionToken,
  handleAdminLogin,
  handleAdminLogout,
  handleAuthCheck,
  handleChangePassword,
  handleUpgradePassword
};
