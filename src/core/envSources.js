const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class EnvSourceManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'env-sources.json');
    this.sources = [];
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.sources = Array.isArray(data.sources) ? data.sources : [];
        console.log(`[ENV-SOURCES] Loaded ${this.sources.length} source(s)`);
      }
    } catch {
      this.sources = [];
    }
  }

  _save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify({ sources: this.sources }, null, 2));
      } catch (err) {
        console.error(`[ENV-SOURCES] Save failed: ${err.message}`);
      }
    }, 3000);
  }

  _generateId() {
    return crypto.randomBytes(4).toString('hex');
  }

  add({ name, filePath }) {
    if (!name || !name.trim()) return { error: 'Name is required' };
    if (!filePath || !filePath.trim()) return { error: 'File path is required' };

    const resolvedPath = path.resolve(filePath.trim());
    if (!fs.existsSync(resolvedPath)) {
      return { error: `File not found: ${resolvedPath}` };
    }

    const existing = this.sources.find(s => s.filePath === resolvedPath);
    if (existing) return { error: 'This file is already registered as a source' };

    const entry = {
      id: this._generateId(),
      name: name.trim(),
      filePath: resolvedPath,
      lastPulledAt: null,
      lastPullStatus: 'never',
      createdAt: new Date().toISOString()
    };

    this.sources.push(entry);
    this._save();
    console.log(`[ENV-SOURCES] Added source: "${entry.name}" → ${resolvedPath}`);
    return entry;
  }

  remove(id) {
    const index = this.sources.findIndex(s => s.id === id);
    if (index === -1) return { error: 'Source not found' };
    const removed = this.sources.splice(index, 1)[0];
    this._save();
    console.log(`[ENV-SOURCES] Removed source: "${removed.name}"`);
    return { success: true };
  }

  list() {
    return this.sources.map(s => ({ ...s }));
  }

  get(id) {
    const source = this.sources.find(s => s.id === id);
    return source ? { ...source } : null;
  }

  updatePullStatus(id, status) {
    const source = this.sources.find(s => s.id === id);
    if (!source) return;
    source.lastPulledAt = new Date().toISOString();
    source.lastPullStatus = status;
    this._save();
  }

  /**
   * Parse source env file and find keys not in current config.
   * @param {string} sourceId
   * @param {object} config - Config instance (uses parseEnvFile + autoDiscoverGlobalKeys)
   * @returns {object} { sourceId, sourceName, totalVars, newKeys: {}, existingKeys: [], parseErrors: [] }
   */
  previewNewKeys(sourceId, config) {
    const source = this.sources.find(s => s.id === sourceId);
    if (!source) return { error: 'Source not found' };

    if (!fs.existsSync(source.filePath)) {
      return { error: `Source file not found: ${source.filePath}` };
    }

    try {
      const content = fs.readFileSync(source.filePath, 'utf8');
      const sourceVars = config.parseEnvFile(content);

      // Normalize keys using the same discovery logic as startup
      const discovered = {};
      config.autoDiscoverGlobalKeys(sourceVars, discovered);

      // Also include any direct _API_KEYS entries from the source file
      for (const [key, value] of Object.entries(sourceVars)) {
        if (key.endsWith('_API_KEYS') && value) {
          if (!discovered[key]) {
            discovered[key] = value;
          } else {
            // Merge keys
            const existing = discovered[key].split(',').map(k => k.trim()).filter(Boolean);
            const incoming = value.split(',').map(k => k.trim()).filter(Boolean);
            const merged = [...new Set([...existing, ...incoming])];
            discovered[key] = merged.join(',');
          }
        }
        // Include BASE_URL, ACCESS_KEY etc. from source
        if ((key.endsWith('_BASE_URL') || key.endsWith('_ACCESS_KEY') || key.endsWith('_DEFAULT_MODEL')) && value) {
          if (!discovered[key]) discovered[key] = value;
        }
      }

      // Diff against current config envVars
      const currentEnvVars = config.envVars;
      const newKeys = {};
      const existingKeys = [];
      const parseErrors = [];

      for (const [key, value] of Object.entries(discovered)) {
        if (key.endsWith('_API_KEYS')) {
          // For key lists, find individual keys not already present
          const incomingKeys = value.split(',').map(k => k.trim()).filter(Boolean);
          const currentRaw = currentEnvVars[key] || '';
          const currentKeys = currentRaw.split(',').map(k => k.trim()).filter(Boolean);

          const newIndividualKeys = incomingKeys.filter(k => {
            const cleanK = k.startsWith('~') ? k.substring(1) : k;
            return !currentKeys.some(ck => {
              const cleanCk = ck.startsWith('~') ? ck.substring(1) : ck;
              return cleanCk === cleanK;
            });
          });

          if (newIndividualKeys.length > 0) {
            newKeys[key] = newIndividualKeys.join(',');
          } else if (incomingKeys.length > 0) {
            existingKeys.push(key);
          }
        } else {
          // For non-key settings (BASE_URL etc.), only add if completely missing
          if (!currentEnvVars[key]) {
            newKeys[key] = value;
          } else {
            existingKeys.push(key);
          }
        }
      }

      const totalNewKeyEntries = Object.keys(newKeys).filter(k => k.endsWith('_API_KEYS')).length;
      const totalNewKeys = Object.entries(newKeys)
        .filter(([k]) => k.endsWith('_API_KEYS'))
        .reduce((sum, [, v]) => sum + v.split(',').filter(Boolean).length, 0);

      return {
        sourceId: source.id,
        sourceName: source.name,
        filePath: source.filePath,
        totalVars: Object.keys(sourceVars).length,
        totalNewProviders: totalNewKeyEntries,
        totalNewKeys,
        newKeys,
        existingKeys,
        parseErrors
      };
    } catch (err) {
      return { error: `Failed to parse source file: ${err.message}` };
    }
  }

  /**
   * Merge previewed new keys into current envVars, write .env, reload config.
   * @param {string} sourceId
   * @param {object} server - ProxyServer instance (needs config + writeEnvFile + reinitializeClients)
   * @returns {object} { success, imported }
   */
  pullKeys(sourceId, server) {
    const preview = this.previewNewKeys(sourceId, server.config);
    if (preview.error) return preview;

    if (Object.keys(preview.newKeys).length === 0) {
      this.updatePullStatus(sourceId, 'no-new-keys');
      return { success: true, message: 'No new keys to import', imported: {} };
    }

    // Merge new keys into current envVars
    const envVars = { ...server.config.envVars };
    for (const [key, value] of Object.entries(preview.newKeys)) {
      if (key.endsWith('_API_KEYS') && envVars[key]) {
        // Append to existing key list
        const current = envVars[key].split(',').map(k => k.trim()).filter(Boolean);
        const incoming = value.split(',').map(k => k.trim()).filter(Boolean);
        envVars[key] = [...new Set([...current, ...incoming])].join(',');
      } else {
        envVars[key] = value;
      }
    }

    // Write updated .env and reload
    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();

    this.updatePullStatus(sourceId, 'success');
    console.log(`[ENV-SOURCES] Pulled ${preview.totalNewKeys} new key(s) from "${preview.sourceName}"`);

    return {
      success: true,
      imported: {
        providers: preview.totalNewProviders,
        keys: preview.totalNewKeys,
        details: preview.newKeys
      }
    };
  }

  reload() {
    this._load();
    console.log('[ENV-SOURCES] Reloaded from disk');
  }
}

module.exports = EnvSourceManager;
