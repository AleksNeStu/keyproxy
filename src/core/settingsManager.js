const fs = require('fs');
const path = require('path');

/**
 * SettingsManager — Persistent JSON settings for KeyProxy.
 * Same debounced-save pattern as KeyVault, Analytics, KeyHistory.
 *
 * Storage: data/settings.json
 * Groups: general, performance, logging, retry, notifications
 */

const ENV_TO_SETTINGS = {
  // general
  PORT: { group: 'general', key: 'port', type: 'int', default: 8990 },
  CORS_ORIGIN: { group: 'general', key: 'corsOrigin', type: 'string', default: '*' },
  KEYPROXY_DEFAULT_TIMEOUT_MS: { group: 'general', key: 'defaultTimeoutMs', type: 'int', default: 60000 },
  EXTERNAL_ENV_PATH: { group: 'general', key: 'externalEnvPath', type: 'string', default: '' },
  // performance
  KEYPROXY_CACHE_ENABLED: { group: 'performance', key: 'cacheEnabled', type: 'bool', default: true },
  KEYPROXY_CACHE_TTL_SEC: { group: 'performance', key: 'cacheTtlSec', type: 'int', default: 300 },
  KEYPROXY_CACHE_MAX_ENTRIES: { group: 'performance', key: 'cacheMaxEntries', type: 'int', default: 1000 },
  KEYPROXY_CB_THRESHOLD: { group: 'performance', key: 'cbThreshold', type: 'int', default: 5 },
  KEYPROXY_CB_TIMEOUT_SEC: { group: 'performance', key: 'cbTimeoutSec', type: 'int', default: 30 },
  KEYPROXY_RECOVERY_ENABLED: { group: 'performance', key: 'recoveryEnabled', type: 'bool', default: true },
  KEYPROXY_RECOVERY_COOLDOWN_SEC: { group: 'performance', key: 'recoveryCooldownSec', type: 'int', default: 300 },
  KEYPROXY_AUTO_CHECK_KEYS: { group: 'performance', key: 'autoCheckKeys', type: 'bool', default: false },
  KEYPROXY_RATE_LIMIT_WINDOW_MS: { group: 'performance', key: 'rateLimitWindowMs', type: 'int', default: 60000 },
  KEYPROXY_RATE_LIMIT_MAX: { group: 'performance', key: 'rateLimitMax', type: 'int', default: 100 },
  DEFAULT_STATUS_CODES: { group: 'performance', key: 'defaultStatusCodes', type: 'string', default: '429' },
  // logging
  KEYPROXY_LOG_LEVEL: { group: 'logging', key: 'level', type: 'string', default: 'info' },
  KEYPROXY_LOG_BUFFER_MAX: { group: 'logging', key: 'bufferMax', type: 'int', default: 200 },
  KEYPROXY_LOG_FILE_MAX_MB: { group: 'logging', key: 'fileMaxMb', type: 'int', default: 10 },
  // retry (global)
  KEYPROXY_MAX_RETRIES: { group: 'retry', key: 'maxRetries', type: 'int', default: 3 },
  KEYPROXY_RETRY_DELAY_MS: { group: 'retry', key: 'delayMs', type: 'int', default: 1000 },
  KEYPROXY_RETRY_BACKOFF: { group: 'retry', key: 'backoff', type: 'float', default: 2.0 },
  // notifications
  SLACK_WEBHOOK_URL: { group: 'notifications', key: 'slackWebhookUrl', type: 'string', default: '' },
  SLACK_NOTIFY_ON: { group: 'notifications', key: 'slackNotifyOn', type: 'string', default: '' },
  TELEGRAM_NOTIFY_ON: { group: 'notifications', key: 'telegramNotifyOn', type: 'string', default: '' },
  KEEP_ALIVE_MINUTES: { group: 'notifications', key: 'keepAliveMinutes', type: 'int', default: 10 },
};

// Reverse map: group.key -> env var name
const SETTINGS_TO_ENV = {};
for (const [envKey, mapping] of Object.entries(ENV_TO_SETTINGS)) {
  SETTINGS_TO_ENV[`${mapping.group}.${mapping.key}`] = envKey;
}

function _emptySchema() {
  return {
    version: 1,
    general: {
      port: 8990,
      corsOrigin: '*',
      defaultTimeoutMs: 60000,
      externalEnvPath: '',
    },
    performance: {
      cacheEnabled: true,
      cacheTtlSec: 300,
      cacheMaxEntries: 1000,
      cbThreshold: 5,
      cbTimeoutSec: 30,
      recoveryEnabled: true,
      recoveryCooldownSec: 300,
      autoCheckKeys: false,
      rateLimitWindowMs: 60000,
      rateLimitMax: 100,
      defaultStatusCodes: '429',
    },
    logging: {
      level: 'info',
      bufferMax: 200,
      fileMaxMb: 10,
    },
    retry: {
      maxRetries: 3,
      delayMs: 1000,
      backoff: 2.0,
      perProvider: {},
    },
    notifications: {
      slackWebhookUrl: '',
      slackNotifyOn: '',
      telegramNotifyOn: '',
      keepAliveMinutes: 10,
    },
    metadata: {
      createdAt: new Date().toISOString(),
      lastModifiedAt: new Date().toISOString(),
      migratedFrom: null,
    },
  };
}

class SettingsManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'settings.json');
    this.data = _emptySchema();
    this.saveTimer = null;
    this.saveDelay = 3000;
    this.dirty = false;
    this._writing = false;

    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        // Merge with defaults for forward compat
        const defaults = _emptySchema();
        for (const group of Object.keys(defaults)) {
          if (group === 'metadata') continue;
          if (group === 'version') continue;
          if (typeof defaults[group] === 'object' && !Array.isArray(defaults[group])) {
            if (!parsed[group]) parsed[group] = {};
            for (const [key, val] of Object.entries(defaults[group])) {
              if (parsed[group][key] === undefined) parsed[group][key] = val;
            }
          }
        }
        if (!parsed.metadata) parsed.metadata = defaults.metadata;
        this.data = parsed;
        console.log(`[SETTINGS] Loaded from ${path.basename(this.filePath)}`);
      }
    } catch (err) {
      console.log(`[SETTINGS] Could not load: ${err.message}, using defaults`);
      this.data = _emptySchema();
    }
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this._flush(), this.saveDelay);
  }

  _flush() {
    if (!this.dirty || this._writing) return;
    this._writing = true;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      this.data.metadata.lastModifiedAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (err) {
      console.error(`[SETTINGS] Save failed: ${err.message}`);
    } finally {
      this._writing = false;
    }
  }

  flushSync() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this._flush();
  }

  // --- Migration ---

  needsMigration() {
    return this.data.metadata.migratedFrom === null;
  }

  runMigrationFromEnv(envVars) {
    console.log('[SETTINGS] Running first-time migration from .env...');
    for (const [envKey, mapping] of Object.entries(ENV_TO_SETTINGS)) {
      const raw = envVars[envKey];
      if (raw === undefined || raw === null) continue;
      let value;
      switch (mapping.type) {
        case 'int': value = parseInt(raw); break;
        case 'float': value = parseFloat(raw); break;
        case 'bool': value = raw === 'true'; break;
        default: value = raw;
      }
      if (isNaN(value) && mapping.type !== 'string') continue;
      this.data[mapping.group][mapping.key] = value;
    }

    // Migrate per-provider retry settings
    for (const [key, value] of Object.entries(envVars)) {
      let match;
      if ((match = key.match(/^(.+)_MAX_RETRIES$/)) && !key.startsWith('KEYPROXY_')) {
        const prov = match[1].toLowerCase();
        if (!this.data.retry.perProvider[prov]) this.data.retry.perProvider[prov] = {};
        this.data.retry.perProvider[prov].maxRetries = parseInt(value);
      } else if ((match = key.match(/^(.+)_RETRY_DELAY_MS$/)) && !key.startsWith('KEYPROXY_')) {
        const prov = match[1].toLowerCase();
        if (!this.data.retry.perProvider[prov]) this.data.retry.perProvider[prov] = {};
        this.data.retry.perProvider[prov].delayMs = parseInt(value);
      } else if ((match = key.match(/^(.+)_RETRY_BACKOFF$/)) && !key.startsWith('KEYPROXY_')) {
        const prov = match[1].toLowerCase();
        if (!this.data.retry.perProvider[prov]) this.data.retry.perProvider[prov] = {};
        this.data.retry.perProvider[prov].backoff = parseFloat(value);
      }
    }

    this.data.metadata.migratedFrom = 'env-file';
    this.flushSync();
    console.log('[SETTINGS] Migration complete');
  }

  // --- Getters ---

  get(group, key) {
    return this.data[group]?.[key];
  }

  getGroup(group) {
    if (!this.data[group]) return {};
    return { ...this.data[group] };
  }

  getAll() {
    const result = {};
    for (const [group, val] of Object.entries(this.data)) {
      if (group === 'metadata' || group === 'version') continue;
      result[group] = typeof val === 'object' && !Array.isArray(val) ? { ...val } : val;
    }
    return result;
  }

  /** Convert structured settings into flat env-var dict for Config overlay. */
  toEnvDict() {
    const result = {};
    for (const [groupKey, groupVal] of Object.entries(this.data)) {
      if (groupKey === 'metadata' || groupKey === 'version') continue;
      if (typeof groupVal !== 'object' || Array.isArray(groupVal)) continue;
      for (const [settingKey, settingVal] of Object.entries(groupVal)) {
        const envKey = SETTINGS_TO_ENV[`${groupKey}.${settingKey}`];
        if (envKey) {
          result[envKey] = typeof settingVal === 'boolean' ? String(settingVal) : String(settingVal);
        }
      }
    }
    // Per-provider retry overrides
    for (const [prov, cfg] of Object.entries(this.data.retry.perProvider || {})) {
      const upper = prov.toUpperCase();
      if (cfg.maxRetries !== undefined) result[`${upper}_MAX_RETRIES`] = String(cfg.maxRetries);
      if (cfg.delayMs !== undefined) result[`${upper}_RETRY_DELAY_MS`] = String(cfg.delayMs);
      if (cfg.backoff !== undefined) result[`${upper}_RETRY_BACKOFF`] = String(cfg.backoff);
    }
    return result;
  }

  // --- Setters ---

  set(group, key, value) {
    if (!this.data[group]) this.data[group] = {};
    this.data[group][key] = value;
    this._scheduleSave();
  }

  updateGroup(group, updates) {
    if (!this.data[group]) this.data[group] = {};
    Object.assign(this.data[group], updates);
    this._scheduleSave();
  }

  updateBulk(groupsObject) {
    for (const [group, updates] of Object.entries(groupsObject)) {
      if (!this.data[group]) this.data[group] = {};
      Object.assign(this.data[group], updates);
    }
    this._scheduleSave();
  }
}

module.exports = SettingsManager;
