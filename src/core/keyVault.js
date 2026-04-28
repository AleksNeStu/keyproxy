const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * KeyVault - Local JSON database for API key management.
 *
 * Single source of truth for keys, providers, and import sources.
 * Follows the same debounced-save pattern as KeyHistoryManager.
 *
 * Storage: data/keyvault.json
 * Key statuses: active | disabled | banned | deleted (soft)
 */
class KeyVault {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'keyvault.json');
    this.data = this._emptySchema();
    this.saveTimer = null;
    this.saveDelay = 3000;
    this.dirty = false;
    this._writing = false;

    this._load();
  }

  _emptySchema() {
    return {
      version: 1,
      providers: {},
      keys: [],
      importSources: [],
      metadata: {
        createdAt: new Date().toISOString(),
        lastModifiedAt: new Date().toISOString(),
        migratedFrom: null,
      },
    };
  }

  // --- Persistence (same pattern as KeyHistoryManager) ---

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.data = JSON.parse(raw);
        // Ensure schema fields exist for forward compat
        if (!this.data.keys) this.data.keys = [];
        if (!this.data.providers) this.data.providers = {};
        if (!this.data.importSources) this.data.importSources = [];
        if (!this.data.metadata) this.data.metadata = {};
        const pCount = Object.keys(this.data.providers).length;
        const kCount = this.data.keys.length;
        console.log(`[VAULT] Loaded ${pCount} providers, ${kCount} keys`);
      }
    } catch (err) {
      console.log(`[VAULT] Could not load vault, starting fresh: ${err.message}`);
      this.data = this._emptySchema();
    }
  }

  _scheduleSave() {
    this.dirty = true;
    this.data.metadata.lastModifiedAt = new Date().toISOString();
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._flush();
    }, this.saveDelay);
  }

  _flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this._writing = true;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), (err) => {
      this._writing = false;
      if (err) console.log(`[VAULT] Write failed: ${err.message}`);
      if (this.dirty) this._scheduleSave();
    });
  }

  flushSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = true;
    this.data.metadata.lastModifiedAt = new Date().toISOString();
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (err) {
      console.log(`[VAULT] Sync write failed: ${err.message}`);
    }
  }

  // --- ID generation ---

  _genId() {
    return crypto.randomBytes(4).toString('hex');
  }

  // --- Provider CRUD ---

  getProviders() {
    return { ...this.data.providers };
  }

  getProvider(name) {
    return this.data.providers[name] ? { ...this.data.providers[name] } : null;
  }

  /** Get freezeOnStatusCodes as a Set (for BaseProvider compatibility). */
  getFreezeOnStatusCodes(name) {
    const prov = this.data.providers[name];
    if (!prov || !prov.freezeOnStatusCodes) return new Set();
    return new Set(prov.freezeOnStatusCodes);
  }

  setProvider(name, config) {
    const existing = this.data.providers[name];
    this.data.providers[name] = {
      ...(existing || {}),
      ...config,
      name,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    // Normalize freezeOnStatusCodes to array for JSON storage
    if (this.data.providers[name].freezeOnStatusCodes instanceof Set) {
      this.data.providers[name].freezeOnStatusCodes = [...this.data.providers[name].freezeOnStatusCodes];
    }
    this._scheduleSave();
    return this.data.providers[name];
  }

  removeProvider(name) {
    if (!this.data.providers[name]) return false;
    delete this.data.providers[name];
    this._scheduleSave();
    return true;
  }

  // --- Key CRUD ---

  _findKey(id) {
    return this.data.keys.find(k => k.id === id);
  }

  _findKeyIndex(id) {
    return this.data.keys.findIndex(k => k.id === id);
  }

  addKey(providerName, keyValue, opts = {}) {
    // Check for duplicate key value in same provider
    const existing = this.data.keys.find(
      k => k.providerName === providerName && k.keyValue === keyValue && k.status !== 'deleted'
    );
    if (existing) return existing;

    const key = {
      id: this._genId(),
      providerName,
      keyValue,
      status: opts.disabled ? 'disabled' : 'active',
      weight: opts.weight || 5,
      disabled: !!opts.disabled,
      source: opts.source || 'manual',
      sourceType: opts.sourceType || 'manual',
      firstSeenAt: new Date().toISOString(),
      lastUsedAt: null,
      bannedAt: null,
      banReason: null,
      deletedAt: null,
      createdAt: new Date().toISOString(),
    };
    this.data.keys.push(key);
    this._scheduleSave();
    console.log(`[VAULT] Added key ${key.id} to ${providerName} (${key.status})`);
    return key;
  }

  addKeys(providerName, keyValues, opts = {}) {
    const results = [];
    for (const kv of keyValues) {
      const isDisabled = typeof kv === 'object' ? kv.disabled : false;
      const val = typeof kv === 'object' ? kv.key : kv;
      results.push(this.addKey(providerName, val, { ...opts, disabled: isDisabled }));
    }
    return results;
  }

  removeKey(id) {
    const idx = this._findKeyIndex(id);
    if (idx === -1) return false;
    const key = this.data.keys[idx];
    key.status = 'deleted';
    key.deletedAt = new Date().toISOString();
    this._scheduleSave();
    console.log(`[VAULT] Soft-deleted key ${id} from ${key.providerName}`);
    return true;
  }

  restoreKey(id) {
    const key = this._findKey(id);
    if (!key || key.status !== 'deleted') return false;
    key.status = key.disabled ? 'disabled' : 'active';
    key.deletedAt = null;
    this._scheduleSave();
    console.log(`[VAULT] Restored key ${id} in ${key.providerName}`);
    return true;
  }

  banKey(id, reason) {
    const key = this._findKey(id);
    if (!key || key.status === 'deleted') return false;
    key.status = 'banned';
    key.bannedAt = new Date().toISOString();
    key.banReason = reason || 'admin_ban';
    this._scheduleSave();
    console.log(`[VAULT] Banned key ${id} in ${key.providerName}: ${key.banReason}`);
    return true;
  }

  unbanKey(id) {
    const key = this._findKey(id);
    if (!key || key.status !== 'banned') return false;
    key.status = key.disabled ? 'disabled' : 'active';
    key.bannedAt = null;
    key.banReason = null;
    this._scheduleSave();
    console.log(`[VAULT] Unbanned key ${id} in ${key.providerName}`);
    return true;
  }

  toggleKey(id) {
    const key = this._findKey(id);
    if (!key || key.status === 'deleted' || key.status === 'banned') return false;
    if (key.status === 'active') {
      key.status = 'disabled';
      key.disabled = true;
    } else {
      key.status = 'active';
      key.disabled = false;
    }
    this._scheduleSave();
    return true;
  }

  updateKeyWeight(id, weight) {
    const key = this._findKey(id);
    if (!key) return false;
    key.weight = Math.max(1, Math.min(10, weight));
    this._scheduleSave();
    return true;
  }

  reorderKeys(providerName, orderedIds) {
    const providerKeys = this.data.keys.filter(k => k.providerName === providerName && k.status !== 'deleted');
    const otherKeys = this.data.keys.filter(k => k.providerName !== providerName || k.status === 'deleted');

    const reordered = [];
    for (const id of orderedIds) {
      const key = providerKeys.find(k => k.id === id);
      if (key) reordered.push(key);
    }
    // Append any keys not in the ordered list
    for (const key of providerKeys) {
      if (!reordered.includes(key)) reordered.push(key);
    }

    this.data.keys = [...otherKeys, ...reordered];
    this._scheduleSave();
    return true;
  }

  // --- Key queries ---

  getKeys(providerName = null) {
    let keys = this.data.keys;
    if (providerName) {
      keys = keys.filter(k => k.providerName === providerName);
    }
    return keys.filter(k => k.status !== 'deleted').map(k => ({ ...k }));
  }

  getActiveKeys(providerName) {
    return this.data.keys
      .filter(k => k.providerName === providerName && k.status === 'active')
      .map(k => ({ ...k }));
  }

  getActiveKeyValues(providerName) {
    return this.data.keys
      .filter(k => k.providerName === providerName && k.status === 'active')
      .map(k => k.keyValue);
  }

  getAllKeyValues(providerName) {
    return this.data.keys
      .filter(k => k.providerName === providerName && k.status !== 'deleted')
      .map(k => k.keyValue);
  }

  getBannedKeys(providerName = null) {
    let keys = this.data.keys.filter(k => k.status === 'banned');
    if (providerName) keys = keys.filter(k => k.providerName === providerName);
    return keys.map(k => ({ ...k }));
  }

  getDeletedKeys(providerName = null) {
    let keys = this.data.keys.filter(k => k.status === 'deleted');
    if (providerName) keys = keys.filter(k => k.providerName === providerName);
    return keys.map(k => ({ ...k }));
  }

  getAllKeysWithStatus(providerName = null) {
    let keys = this.data.keys;
    if (providerName) keys = keys.filter(k => k.providerName === providerName);
    return keys.map(k => ({ ...k }));
  }

  getKeyById(id) {
    const key = this._findKey(id);
    return key ? { ...key } : null;
  }

  getKeyCounts(providerName) {
    const keys = this.data.keys.filter(k => k.providerName === providerName);
    return {
      total: keys.filter(k => k.status !== 'deleted').length,
      active: keys.filter(k => k.status === 'active').length,
      disabled: keys.filter(k => k.status === 'disabled').length,
      banned: keys.filter(k => k.status === 'banned').length,
      deleted: keys.filter(k => k.status === 'deleted').length,
    };
  }

  // Compatibility: return keys in the format Config.parseApiKeysWithState() produces
  getKeysForConfig(providerName) {
    const keys = this.data.keys.filter(
      k => k.providerName === providerName && k.status !== 'deleted'
    );
    return {
      allKeys: keys.map(k => ({ key: k.keyValue, disabled: k.disabled || k.status === 'disabled' })),
      enabledKeys: keys.filter(k => k.status === 'active').map(k => k.keyValue),
    };
  }

  // --- Import Sources ---

  getImportSources() {
    return this.data.importSources.map(s => ({ ...s }));
  }

  addImportSource(opts) {
    const source = {
      id: this._genId(),
      name: opts.name || path.basename(opts.filePath),
      filePath: opts.filePath,
      enabled: opts.enabled !== false,
      priority: opts.priority || this.data.importSources.length + 1,
      ksync_excludes: Array.isArray(opts.ksync_excludes) ? opts.ksync_excludes : [],
      lastPulledAt: null,
      lastPullStatus: 'never',
      createdAt: new Date().toISOString(),
    };
    this.data.importSources.push(source);
    this._scheduleSave();
    console.log(`[VAULT] Added import source "${source.name}" (${source.filePath})`);
    return source;
  }

  /**
   * Check if a provider name matches any exclusion pattern (glob).
   * Reuses same glob→regex conversion as KeyExclusionManager.
   */
  _matchesExcludes(providerName, patterns) {
    if (!patterns || patterns.length === 0) return false;
    for (const pattern of patterns) {
      const type = /^[A-Za-z0-9_\-*?]+$/.test(pattern) ? 'glob' : 'regex';
      let regexStr;
      if (type === 'glob') {
        regexStr = '^' + pattern
          .replace(/[-[\]{}()+.,\\^$|#]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') + '$';
      } else {
        regexStr = pattern;
      }
      try {
        if (new RegExp(regexStr, 'i').test(providerName)) return true;
      } catch {}
    }
    return false;
  }

  removeImportSource(id) {
    const idx = this.data.importSources.findIndex(s => s.id === id);
    if (idx === -1) return false;
    const removed = this.data.importSources.splice(idx, 1)[0];
    this._scheduleSave();
    console.log(`[VAULT] Removed import source "${removed.name}"`);
    return true;
  }

  getImportSource(id) {
    const source = this.data.importSources.find(s => s.id === id);
    return source ? { ...source } : null;
  }

  /**
   * Preview what keys would be imported from a source.
   * Returns { newKeys: [{providerName, keyValue}], updatedKeys: [], unchangedKeys: [] }
   */
  previewImport(sourceId) {
    const source = this.data.importSources.find(s => s.id === sourceId);
    if (!source) return { error: 'Source not found' };

    const parsed = this._parseEnvFile(source.filePath);
    if (parsed.error) return parsed;

    const result = { newKeys: [], updatedKeys: [], unchangedKeys: [], excludedKeys: [] };
    const excludes = source.ksync_excludes || [];
    for (const [providerName, keys] of Object.entries(parsed.providers)) {
      for (const kv of keys) {
        const val = typeof kv === 'object' ? kv.key : kv;
        if (this._matchesExcludes(providerName, excludes)) {
          result.excludedKeys.push({ providerName, keyValue: val });
          continue;
        }
        const existing = this.data.keys.find(
          k => k.providerName === providerName && k.keyValue === val && k.status !== 'deleted'
        );
        if (existing) {
          result.unchangedKeys.push({ providerName, keyValue: val, keyId: existing.id });
        } else {
          result.newKeys.push({ providerName, keyValue: val });
        }
      }
    }
    return result;
  }

  /**
   * Pull keys from an import source. Last-write-wins for duplicates across sources.
   * Returns { imported: number, skipped: number, errors: [] }
   */
  pullImport(sourceId) {
    const source = this.data.importSources.find(s => s.id === sourceId);
    if (!source) return { error: 'Source not found' };

    const parsed = this._parseEnvFile(source.filePath);
    if (parsed.error) {
      source.lastPullStatus = `error: ${parsed.error}`;
      source.lastPulledAt = new Date().toISOString();
      this._scheduleSave();
      return parsed;
    }

    let imported = 0;
    let skipped = 0;
    let excluded = 0;
    const errors = [];
    const excludes = source.ksync_excludes || [];

    for (const [providerName, keys] of Object.entries(parsed.providers)) {
      // Ensure provider exists
      if (!this.data.providers[providerName] && parsed.providerConfigs[providerName]) {
        this.setProvider(providerName, parsed.providerConfigs[providerName]);
      }

      for (const kv of keys) {
        const val = typeof kv === 'object' ? kv.key : kv;
        const isDisabled = typeof kv === 'object' ? kv.disabled : false;

        if (this._matchesExcludes(providerName, excludes)) {
          excluded++;
          continue;
        }

        const existing = this.data.keys.find(
          k => k.providerName === providerName && k.keyValue === val && k.status !== 'deleted'
        );

        if (existing) {
          // Last-write-wins: update source tracking
          existing.source = `import:${source.id}`;
          existing.sourceType = 'env-file';
          if (isDisabled && existing.status === 'active') {
            existing.status = 'disabled';
            existing.disabled = true;
          } else if (!isDisabled && existing.status === 'disabled') {
            existing.status = 'active';
            existing.disabled = false;
          }
          skipped++;
        } else {
          this.addKey(providerName, val, {
            disabled: isDisabled,
            source: `import:${source.id}`,
            sourceType: 'env-file',
          });
          imported++;
        }
      }
    }

    source.lastPullStatus = 'success';
    source.lastPulledAt = new Date().toISOString();
    this._scheduleSave();

    console.log(`[VAULT] Import from "${source.name}": ${imported} new, ${skipped} existing, ${excluded} excluded`);
    return { imported, skipped, excluded, errors };
  }

  // --- Migration ---

  needsMigration() {
    return this.data.keys.length === 0 && Object.keys(this.data.providers).length === 0;
  }

  /**
   * Run migration from config (env-based key loading).
   * @param {object} config - Config instance with providers loaded from env
   * @param {object} knownDefaults - Provider defaults from config
   */
  runMigration(config, knownDefaults = {}) {
    if (!this.needsMigration()) {
      console.log('[VAULT] Already populated, skipping migration');
      return false;
    }

    console.log('[VAULT] Running first-time migration from .env files...');
    let totalProviders = 0;
    let totalKeys = 0;

    const providers = config.providers || new Map();
    const providerEntries = providers instanceof Map ? providers.entries() : Object.entries(providers);

    for (const [name, prov] of providerEntries) {
      // Create provider entry with defaults
      const defaults = knownDefaults[name] || {};
      this.setProvider(name, {
        apiType: prov.apiType || defaults.type || 'openai',
        baseUrl: prov.baseUrl || defaults.baseUrl || '',
        authHeader: prov.authHeader || defaults.authHeader || 'Authorization',
        authPrefix: prov.authPrefix || defaults.authPrefix || 'Bearer',
        category: prov.category || defaults.category || 'ai',
        disabled: prov.disabled || false,
        syncEnv: prov.syncEnv || false,
        defaultModel: prov.defaultModel || defaults.defaultModel || null,
        allowedModels: prov.allowedModels || defaults.allowedModels || [],
        freezeOnStatusCodes: defaults.freezeOnStatusCodes
          ? [...defaults.freezeOnStatusCodes]
          : [],
      });
      totalProviders++;

      // Import keys
      if (prov.allKeys && Array.isArray(prov.allKeys)) {
        for (const k of prov.allKeys) {
          this.addKey(name, k.key, {
            disabled: k.disabled || false,
            source: 'env:migration',
            sourceType: 'migration',
          });
          totalKeys++;
        }
      } else if (prov.keys && Array.isArray(prov.keys)) {
        for (const keyValue of prov.keys) {
          this.addKey(name, keyValue, {
            source: 'env:migration',
            sourceType: 'migration',
          });
          totalKeys++;
        }
      }
    }

    // Migrate existing import sources
    if (config.envSourceManager) {
      const sources = config.envSourceManager.getSources ? config.envSourceManager.getSources() : [];
      for (const src of sources) {
        this.addImportSource({
          name: src.name,
          filePath: src.filePath,
          enabled: !src.disabled,
          priority: src.order || 1,
        });
      }
    }

    this.data.metadata.migratedFrom = 'env-files';
    this.flushSync();
    console.log(`[VAULT] Migration complete: ${totalProviders} providers, ${totalKeys} keys`);
    return true;
  }

  // --- Internal ---

  /**
   * Parse a .env file and extract providers/keys using knownDefaults patterns.
   * Returns { providers: { name: [keys] }, providerConfigs: { name: config }, error?: string }
   */
  _parseEnvFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { error: `File not found: ${filePath}` };
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const envVars = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && value) envVars[key] = value;
      }

      // Use Config-style discovery logic
      return this._discoverProvidersFromEnv(envVars);
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * Discover providers from a flat env var object.
   * Mirrors Config.autoDiscoverGlobalKeys() logic.
   */
  _discoverProvidersFromEnv(envVars) {
    const providers = {};
    const providerConfigs = {};

    // Load knownDefaults for discovery patterns
    const knownDefaults = this._getKnownDefaults();

    for (const [envKey, envValue] of Object.entries(envVars)) {
      // Pattern: OPENAI_<NAME>_API_KEYS or OPENAI_<NAME>_API_KEY
      const match = envKey.match(/^(OPENAI|GEMINI)_(.+?)_API_KEY(S?)$/);
      if (!match) continue;

      const [, apiType, namePart, isMulti] = match;
      const providerName = namePart.toLowerCase();

      // Parse key values
      const rawKeys = isMulti ? envValue.split(',').map(k => k.trim()).filter(Boolean) : [envValue.trim()];
      const keys = [];
      for (const raw of rawKeys) {
        if (raw.startsWith('~')) {
          keys.push({ key: raw.substring(1), disabled: true });
        } else {
          keys.push({ key: raw, disabled: false });
        }
      }

      if (keys.length > 0) {
        // Last-write-wins: if provider already exists from a higher-priority source, overwrite
        providers[providerName] = keys;

        const defaults = knownDefaults[providerName] || {};
        providerConfigs[providerName] = {
          apiType: apiType.toLowerCase() === 'gemini' ? 'gemini' : 'openai',
          baseUrl: defaults.baseUrl || '',
          authHeader: defaults.authHeader || 'Authorization',
          authPrefix: defaults.authPrefix || 'Bearer',
          category: defaults.category || 'ai',
        };
      }
    }

    return { providers, providerConfigs };
  }

  _getKnownDefaults() {
    try {
      const Config = require('./config');
      if (Config.knownDefaults) return Config.knownDefaults;
      const config = new Config();
      return config.knownDefaults || {};
    } catch {
      return {};
    }
  }
}

module.exports = KeyVault;
