const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * KeyExclusionManager — Exclude API keys by name patterns from destination sync.
 * Patterns match against environment variable names (e.g. CLOUDFLARE_* excludes
 * CLOUDFLARE_API_KEY, CLOUDFLARE_TOKEN, etc.).
 * Data persisted to data/key-exclusions.json.
 */
class KeyExclusionManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'key-exclusions.json');
    this.patterns = [];
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.patterns = Array.isArray(data.patterns) ? data.patterns : [];
        console.log(`[EXCLUSIONS] Loaded ${this.patterns.length} exclusion pattern(s)`);
      }
    } catch {
      this.patterns = [];
    }
  }

  _save() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify({ patterns: this.patterns }, null, 2));
      } catch (err) {
        console.error(`[EXCLUSIONS] Save failed: ${err.message}`);
      }
    }, 3000);
  }

  _generateId() {
    return crypto.randomBytes(4).toString('hex');
  }

  _detectType(pattern) {
    if (/^[A-Za-z0-9_\-*?]+$/.test(pattern)) return 'glob';
    return 'regex';
  }

  _compilePattern(entry) {
    let regexStr;
    if (entry.type === 'glob') {
      regexStr = '^' + entry.pattern
        .replace(/[-[\]{}()+.,\\^$|#]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') + '$';
    } else {
      regexStr = entry.pattern;
    }
    return new RegExp(regexStr, 'i');
  }

  _validatePattern(pattern, type) {
    try {
      if (type === 'glob') {
        const regexStr = '^' + pattern
          .replace(/[-[\]{}()+.,\\^$|#]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.') + '$';
        new RegExp(regexStr);
      } else {
        new RegExp(pattern);
      }
      return { valid: true };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  add({ pattern, type, description }) {
    if (!pattern || typeof pattern !== 'string' || !pattern.trim()) {
      return { error: 'Pattern is required' };
    }

    const detectedType = type || this._detectType(pattern);
    const validation = this._validatePattern(pattern, detectedType);
    if (!validation.valid) {
      return { error: `Invalid pattern: ${validation.error}` };
    }

    const entry = {
      id: this._generateId(),
      pattern: pattern.trim(),
      type: detectedType,
      enabled: true,
      description: description || '',
      createdAt: new Date().toISOString()
    };

    this.patterns.push(entry);
    this._save();
    console.log(`[EXCLUSIONS] Added pattern: ${entry.pattern} (${entry.type})`);
    return entry;
  }

  remove(id) {
    const index = this.patterns.findIndex(p => p.id === id);
    if (index === -1) return { error: 'Pattern not found' };
    const removed = this.patterns.splice(index, 1)[0];
    this._save();
    console.log(`[EXCLUSIONS] Removed pattern: ${removed.pattern}`);
    return { success: true };
  }

  toggle(id) {
    const entry = this.patterns.find(p => p.id === id);
    if (!entry) return { error: 'Pattern not found' };
    entry.enabled = !entry.enabled;
    delete entry._compiledRegex;
    this._save();
    console.log(`[EXCLUSIONS] Pattern ${entry.pattern} ${entry.enabled ? 'enabled' : 'disabled'}`);
    return entry;
  }

  list() {
    return this.patterns.map(({ _compiledRegex, ...rest }) => rest);
  }

  isExcluded(envVarName) {
    for (const entry of this.patterns) {
      if (!entry.enabled) continue;
      if (!entry._compiledRegex) {
        entry._compiledRegex = this._compilePattern(entry);
      }
      if (entry._compiledRegex.test(envVarName)) {
        return true;
      }
    }
    return false;
  }

  testPattern(name) {
    for (const entry of this.patterns) {
      if (!entry.enabled) continue;
      if (!entry._compiledRegex) {
        entry._compiledRegex = this._compilePattern(entry);
      }
      if (entry._compiledRegex.test(name)) {
        return { excluded: true, matchedBy: entry.pattern };
      }
    }
    return { excluded: false, matchedBy: null };
  }

  clearAll() {
    this.patterns = [];
    this._save();
    console.log('[EXCLUSIONS] All patterns cleared');
    return { success: true };
  }

  reload() {
    this._load();
    console.log('[EXCLUSIONS] Reloaded from disk');
  }
}

module.exports = KeyExclusionManager;
