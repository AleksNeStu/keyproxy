'use strict';

const Router = require('./router');

// Route handler imports
const { isAdminAuthenticated, handleAuthCheck, handleAdminLogin, handleAdminLogout, handleGetCsrfToken, handleGetLoginStatus, handleChangePassword, handleUpgradePassword } = require('./adminAuth');
const { handleGetEnvVars, handleGetEnvFile, handleUpdateEnvVars, handleUpdateSettings, handleReloadConfig, handleGetRetryConfig, handleUpdateRetryConfig, handleGetGeneralSettings, handleUpdateGeneralSettings, handleGetEnvFiles, handleAddEnvFile, handleRemoveEnvFile, handleSwitchEnv, handleReorderEnvFiles, handleToggleEnvFileDisabled, handleSelectEnv } = require('./adminEnv');
const { handleToggleKey, handleReorderKeys, handleGetKeyUsage, handleGetKeyHistory, handleResetKeyHistory, handleTestKeyRecovery, handleGetRpm, handleUnfreezeKey, handleVaultGetKeys, handleVaultAddKey, handleVaultDeleteKey, handleVaultBanKey, handleVaultUnbanKey, handleVaultRestoreKey, handleVaultGetDeleted, handleVaultGetActiveKey, handleVaultGetAllActiveKeys, handleVaultGetImportSources, handleVaultAddImportSource, handleVaultRemoveImportSource, handleVaultPreviewImport, handleVaultPullImport } = require('./adminKeys');
const { handleToggleProvider, handleToggleSyncEnv, handleToggleGlobalSync, handleGetHealth, handleHealthCheckAll, handleHealthReset, handleGetRecoveryStatus, handleRecoveryScan, handleRecoveryProbe, handleTestApiKey, handleTestAllKeys, handleGetKeySources, handleGetSyncExclusive, handleToggleSyncExclusive } = require('./adminProviders');
const { handleGetNotifications, handleUpdateNotifications, handleTestNotification, handleGetTelegramSettings, handleUpdateTelegramSettings } = require('./adminNotifications');
const { handleGetStatus, handleGetAuditLog } = require('./adminStatus');
const { handleGetAnalytics, handleResetAnalytics, handleGetFallbacks, handleSetFallback, handleGetCircuitBreaker, handleCircuitBreakerAction, handleGetCacheStats, handleClearCache, handleCacheConfig, handleListVirtualKeys, handleCreateVirtualKey, handleRevokeVirtualKey, handleToggleVirtualKey, handleGetBudgets, handleGetAvailableKeys, handleSetBudget, handleRemoveBudget, handleGetKeyExpiry, handleExtendKey, handleExportConfig, handleImportConfig, handleFsList, handleFsDrives, handleGetLbStrategy, handleSetLbStrategy, handleSetLbWeight } = require('./adminAdvanced');
const { handleFetchModels, handleSaveModels } = require('./adminModels');
const { handleGetExclusions, handleAddExclusion, handleRemoveExclusion, handleToggleExclusion, handleTestExclusion } = require('./adminExclusions');
const { handleGetEnvSources, handleAddEnvSource, handleRemoveEnvSource, handlePreviewEnvSource, handlePullEnvSource } = require('./adminEnvSources');
const { handleGetAgentContext } = require('./adminMcp');

/**
 * Pre-auth routes: run before authentication/CSRF gate.
 * Static panel, auth check, CSRF token, login, logout.
 */
function createPreAuthRouter() {
  const router = new Router();

  // Static admin panel
  router.register({ method: 'GET', path: '/admin', handler: ctx => ctx.server.serveAdminPanel(ctx.res) });
  router.register({ method: 'GET', path: '/admin/', handler: ctx => ctx.server.serveAdminPanel(ctx.res) });

  // Auth check (no auth required)
  router.register({ method: 'GET', path: '/admin/api/auth', handler: ctx => handleAuthCheck(ctx.server, ctx.req, ctx.res) });

  // CSRF token (has own auth check inside)
  router.register({ method: 'GET', path: '/admin/api/csrf-token', handler: ctx => handleGetCsrfToken(ctx.server, ctx.req, ctx.res) });

  // Login status (no auth required — checked before rate limiter)
  router.register({ method: 'GET', path: '/admin/api/login-status', handler: ctx => handleGetLoginStatus(ctx.server, ctx.res) });

  // Login
  router.register({ method: 'POST', path: '/admin/login', handler: ctx => handleAdminLogin(ctx.server, ctx.req, ctx.res, ctx.body) });

  // Logout
  router.register({ method: 'POST', path: '/admin/logout', handler: ctx => handleAdminLogout(ctx.server, ctx.req, ctx.res) });

  return router;
}

/**
 * Authenticated routes: run after auth check and CSRF validation.
 */
function createAuthenticatedRouter() {
  const router = new Router();

  // ─── Env ────────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/env', handler: ctx => handleGetEnvVars(ctx.server, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/env-file', handler: ctx => handleGetEnvFile(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/env', handler: ctx => handleUpdateEnvVars(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Key testing ────────────────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/test', handler: ctx => handleTestApiKey(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/test-all-keys', handler: ctx => handleTestAllKeys(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/key-sources', handler: ctx => handleGetKeySources(ctx.server, ctx.res) });

  // ─── Logs ───────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/logs', handler: ctx => ctx.server.handleGetLogs(ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/response/', prefix: true, handler: ctx => ctx.server.handleGetResponse(ctx.res, ctx.path) });
  router.register({ method: 'GET', path: '/admin/api/provider-logs', handler: ctx => {
    const url = new URL(ctx.req.url, 'http://localhost');
    const query = Object.fromEntries(url.searchParams.entries());
    ctx.server.handleGetProviderLogs(ctx.res, query);
  }});

  // ─── Key management ─────────────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/reorder-keys', handler: ctx => handleReorderKeys(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'GET', path: '/admin/api/key-usage', handler: ctx => handleGetKeyUsage(ctx.server, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/key-history', handler: ctx => handleGetKeyHistory(ctx.server, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/key-history/', prefix: true, handler: ctx => handleGetKeyHistory(ctx.server, ctx.res, ctx.path.split('/').pop()) });
  router.register({ method: 'POST', path: '/admin/api/key-history/reset/', prefix: true, handler: ctx => handleResetKeyHistory(ctx.server, ctx.req, ctx.res, ctx.path.split('/').pop()) });
  router.register({ method: 'POST', path: '/admin/api/key-test', handler: ctx => handleTestKeyRecovery(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/unfreeze-key', handler: ctx => handleUnfreezeKey(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/toggle-key', handler: ctx => handleToggleKey(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Vault key management ──────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/vault/keys', handler: ctx => handleVaultGetKeys(ctx.server, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/vault/keys/', prefix: true, handler: ctx => handleVaultGetKeys(ctx.server, ctx.res, ctx.path.split('/').pop()) });
  router.register({ method: 'POST', path: '/admin/api/vault/keys', handler: ctx => handleVaultAddKey(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'DELETE', path: '/admin/api/vault/keys/', prefix: true, handler: ctx => handleVaultDeleteKey(ctx.server, ctx.res, ctx.path.split('/').pop()) });
  router.register({ method: 'POST', path: '/admin/api/vault/keys/', prefix: true, handler: ctx => {
    const parts = ctx.path.split('/');
    const keyId = parts[parts.length - 2];
    const action = parts[parts.length - 1];
    if (action === 'ban') return handleVaultBanKey(ctx.server, ctx.req, ctx.res, ctx.body, keyId);
    if (action === 'unban') return handleVaultUnbanKey(ctx.server, ctx.res, keyId);
    if (action === 'restore') return handleVaultRestoreKey(ctx.server, ctx.res, keyId);
    ctx.res.writeHead(400, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ error: 'Unknown vault key action' }));
  }});
  router.register({ method: 'GET', path: '/admin/api/vault/deleted', handler: ctx => handleVaultGetDeleted(ctx.server, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/vault/active-keys', handler: ctx => handleVaultGetAllActiveKeys(ctx.server, ctx.res) });

  // ─── Vault import sources ────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/vault/import-sources', handler: ctx => handleVaultGetImportSources(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/vault/import-sources', handler: ctx => handleVaultAddImportSource(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'DELETE', path: '/admin/api/vault/import-sources', handler: ctx => handleVaultRemoveImportSource(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/vault/import/', prefix: true, handler: ctx => {
    const parts = ctx.path.split('/');
    const sourceId = parts[parts.length - 2] || parts[parts.length - 1];
    const action = parts[parts.length - 1];
    if (action === 'preview') return handleVaultPreviewImport(ctx.server, ctx.req, ctx.res, sourceId);
    return handleVaultPullImport(ctx.server, ctx.req, ctx.res, sourceId);
  }});
  router.register({ method: 'GET', path: '/admin/api/vault/active-key/', prefix: true, handler: ctx => handleVaultGetActiveKey(ctx.server, ctx.res, ctx.path.split('/').pop()) });

  // ─── Provider management ────────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/toggle-provider', handler: ctx => handleToggleProvider(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/toggle-sync-env', handler: ctx => handleToggleSyncEnv(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/toggle-global-sync', handler: ctx => handleToggleGlobalSync(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'GET', path: '/admin/api/sync-exclusive', handler: ctx => handleGetSyncExclusive(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/sync-exclusive', handler: ctx => handleToggleSyncExclusive(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Password management ────────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/upgrade-password', handler: ctx => handleUpgradePassword(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/change-password', handler: ctx => handleChangePassword(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Telegram ───────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/telegram', handler: ctx => handleGetTelegramSettings(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/telegram', handler: ctx => handleUpdateTelegramSettings(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Config ─────────────────────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/reload', handler: ctx => handleReloadConfig(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/retry-config', handler: ctx => handleGetRetryConfig(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/retry-config', handler: ctx => handleUpdateRetryConfig(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/settings', handler: ctx => handleUpdateSettings(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'GET', path: '/admin/api/general-settings', handler: ctx => handleGetGeneralSettings(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/general-settings', handler: ctx => handleUpdateGeneralSettings(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Env files ──────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/env-files', handler: ctx => handleGetEnvFiles(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/env-files', handler: ctx => handleAddEnvFile(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'DELETE', path: '/admin/api/env-files', handler: ctx => handleRemoveEnvFile(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/switch-env', handler: ctx => handleSwitchEnv(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/reorder-env-files', handler: ctx => handleReorderEnvFiles(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/toggle-env-file-disabled', handler: ctx => handleToggleEnvFileDisabled(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Env sources ────────────────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/env-sources/preview', handler: ctx => handlePreviewEnvSource(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/env-sources/pull', handler: ctx => handlePullEnvSource(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'GET', path: '/admin/api/env-sources', handler: ctx => handleGetEnvSources(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/env-sources', handler: ctx => handleAddEnvSource(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'DELETE', path: '/admin/api/env-sources', handler: ctx => handleRemoveEnvSource(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Recovery ───────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/recovery-status', handler: ctx => handleGetRecoveryStatus(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/recovery/scan', handler: ctx => handleRecoveryScan(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/recovery/probe/', prefix: true, handler: ctx => handleRecoveryProbe(ctx.server, ctx.req, ctx.res, ctx.path) });

  // ─── Health ─────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/health', handler: ctx => handleGetHealth(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/health/check-all', handler: ctx => handleHealthCheckAll(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/health/reset', handler: ctx => handleHealthReset(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Notifications ──────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/notifications', handler: ctx => handleGetNotifications(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/notifications', handler: ctx => handleUpdateNotifications(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/notifications/test', handler: ctx => handleTestNotification(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Analytics ──────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/analytics', handler: ctx => handleGetAnalytics(ctx.server, ctx.res, ctx.params) });
  router.register({ method: 'POST', path: '/admin/api/analytics/reset', handler: ctx => handleResetAnalytics(ctx.server, ctx.req, ctx.res) });

  // ─── Audit log ──────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/audit-log', handler: ctx => handleGetAuditLog(ctx.server, ctx.res, ctx.params) });

  // ─── Fallbacks ──────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/fallbacks', handler: ctx => handleGetFallbacks(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/fallbacks', handler: ctx => handleSetFallback(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Circuit breaker ────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/circuit-breaker', handler: ctx => handleGetCircuitBreaker(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/circuit-breaker/', prefix: true, handler: ctx => handleCircuitBreakerAction(ctx.server, ctx.req, ctx.res, ctx.path, ctx.body) });

  // ─── Config import/export ───────────────────────────────────
  router.register({ method: 'POST', path: '/admin/api/export-config', handler: ctx => handleExportConfig(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/import-config', handler: ctx => handleImportConfig(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Status ─────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/status', handler: ctx => handleGetStatus(ctx.server, ctx.res, ctx.params) });
  router.register({ method: 'GET', path: '/admin/api/rpm', handler: ctx => handleGetRpm(ctx.server, ctx.res) });

  // ─── Cache ──────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/cache', handler: ctx => handleGetCacheStats(ctx.server, ctx.res) });
  router.register({ method: 'DELETE', path: '/admin/api/cache', handler: ctx => handleClearCache(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/cache/config', handler: ctx => handleCacheConfig(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Virtual keys ───────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/virtual-keys', handler: ctx => handleListVirtualKeys(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/virtual-keys', handler: ctx => handleCreateVirtualKey(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'DELETE', path: '/admin/api/virtual-keys/', prefix: true, handler: ctx => handleRevokeVirtualKey(ctx.server, ctx.req, ctx.res, ctx.path) });
  router.register({ method: 'POST', path: '/admin/api/virtual-keys/', prefix: true, handler: ctx => handleToggleVirtualKey(ctx.server, ctx.req, ctx.res, ctx.path) });

  // ─── Budgets ────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/budgets', handler: ctx => handleGetBudgets(ctx.server, ctx.res) });
  router.register({ method: 'GET', path: '/admin/api/budgets/available-keys', handler: ctx => handleGetAvailableKeys(ctx.server, ctx.res) });
  router.register({ method: 'DELETE', path: '/admin/api/budgets/', prefix: true, handler: ctx => handleRemoveBudget(ctx.server, ctx.req, ctx.res, ctx.path) });
  router.register({ method: 'POST', path: '/admin/api/budgets', handler: ctx => handleSetBudget(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Key expiry ─────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/key-expiry', handler: ctx => handleGetKeyExpiry(ctx.server, ctx.res, ctx.params) });
  router.register({ method: 'POST', path: '/admin/api/key-extend', handler: ctx => handleExtendKey(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Env selection ──────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/select-env', handler: ctx => handleSelectEnv(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/select-env', handler: ctx => handleSelectEnv(ctx.server, ctx.req, ctx.res) });

  // ─── File system ────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/fs-list', handler: ctx => handleFsList(ctx.server, ctx.res, ctx.params.path) });
  router.register({ method: 'GET', path: '/admin/api/fs-drives', handler: ctx => handleFsDrives(ctx.server, ctx.res) });

  // ─── Load balancing ─────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/lb-strategy', handler: ctx => handleGetLbStrategy(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/lb-strategy', handler: ctx => handleSetLbStrategy(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/lb-weight', handler: ctx => handleSetLbWeight(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Models ─────────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/models', handler: ctx => handleFetchModels(ctx.server, ctx.req, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/models', handler: ctx => handleSaveModels(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Exclusions ─────────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/exclusions', handler: ctx => handleGetExclusions(ctx.server, ctx.res) });
  router.register({ method: 'POST', path: '/admin/api/exclusions', handler: ctx => handleAddExclusion(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'DELETE', path: '/admin/api/exclusions', handler: ctx => handleRemoveExclusion(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/exclusions/toggle', handler: ctx => handleToggleExclusion(ctx.server, ctx.req, ctx.res, ctx.body) });
  router.register({ method: 'POST', path: '/admin/api/exclusions/test', handler: ctx => handleTestExclusion(ctx.server, ctx.req, ctx.res, ctx.body) });

  // ─── Agent context ──────────────────────────────────────────
  router.register({ method: 'GET', path: '/admin/api/agent-context', handler: ctx => handleGetAgentContext(ctx.server, ctx.res, ctx.params) });

  return router;
}

module.exports = { createPreAuthRouter, createAuthenticatedRouter };
