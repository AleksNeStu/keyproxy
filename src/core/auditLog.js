const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 5000;

class AuditLog {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'audit.json');
    this.entries = [];
    this.dirty = false;
    this.saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.entries = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (!Array.isArray(this.entries)) this.entries = [];
      }
    } catch {
      this.entries = [];
    }
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._flush();
    }, 5000);
  }

  _flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(this.filePath, JSON.stringify(this.entries, null, 2), (err) => {
      if (err) console.log(`[AUDIT] Write failed: ${err.message}`);
      if (this.dirty) this._scheduleSave();
    });
  }

  flushSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = true;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
      this.dirty = false;
    } catch (err) {
      console.log(`[AUDIT] Sync write failed: ${err.message}`);
    }
  }

  log(action, details = {}) {
    this.entries.push({
      ts: new Date().toISOString(),
      action,
      ...details
    });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    this._scheduleSave();
  }

  query(limit = 100, offset = 0) {
    return this.entries.slice(-(limit + offset)).slice(0, limit).reverse();
  }

  reset() {
    this.entries = [];
    this._scheduleSave();
  }
}

module.exports = AuditLog;
