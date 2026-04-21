const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Virtual API Key Manager.
 * Generates vk-xxxx keys that map to scoped provider access.
 * Stored in data/virtual-keys.json.
 */
class VirtualKeyManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'virtual-keys.json');
    this.keys = new Map();
    this.saveTimer = null;
    this.dirty = false;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const data = JSON.parse(raw);
        for (const entry of (data.keys || [])) {
          this.keys.set(entry.id, entry);
        }
        console.log(`[VKEYS] Loaded ${this.keys.size} virtual keys`);
      }
    } catch {
      console.log('[VKEYS] Starting fresh — no virtual keys file');
    }
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._flush();
    }, 3000);
  }

  _flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const data = { keys: Array.from(this.keys.values()) };
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.log(`[VKEYS] Save failed: ${err.message}`);
    }
  }

  /**
   * Generate a new virtual key.
   */
  create({ name, allowedProviders = [], allowedModels = [], rpmLimit = 0, expiresAt = null, createdBy = 'admin' }) {
    const id = crypto.randomBytes(16).toString('hex');
    const token = `vk-${crypto.randomBytes(24).toString('hex')}`;
    const hashedToken = this._hashToken(token);

    const entry = {
      id,
      name: name || `key-${id.substring(0, 8)}`,
      tokenHash: hashedToken,
      tokenPrefix: token.substring(0, 7), // vk-xxxxx for display
      allowedProviders,
      allowedModels,
      rpmLimit,
      expiresAt,
      createdBy,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      usageCount: 0,
      enabled: true
    };

    this.keys.set(id, entry);
    this._scheduleSave();
    console.log(`[VKEYS] Created virtual key '${entry.name}' (${entry.tokenPrefix}...)`);

    // Return the plain token only once — it's never stored in plaintext
    return { id, token, ...entry };
  }

  /**
   * Validate a virtual key token and return its config.
   */
  validate(token) {
    if (!token || !token.startsWith('vk-')) return null;

    const hashedToken = this._hashToken(token);
    for (const [id, entry] of this.keys.entries()) {
      if (entry.tokenHash === hashedToken && entry.enabled) {
        // Check expiry
        if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
          return null;
        }
        // Update usage
        entry.lastUsedAt = new Date().toISOString();
        entry.usageCount++;
        this._scheduleSave();
        return entry;
      }
    }
    return null;
  }

  /**
   * List all virtual keys (without token hashes).
   */
  list() {
    return Array.from(this.keys.values()).map(k => ({
      id: k.id,
      name: k.name,
      tokenPrefix: k.tokenPrefix,
      allowedProviders: k.allowedProviders,
      allowedModels: k.allowedModels,
      rpmLimit: k.rpmLimit,
      expiresAt: k.expiresAt,
      createdBy: k.createdBy,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      usageCount: k.usageCount,
      enabled: k.enabled
    }));
  }

  /**
   * Revoke (delete) a virtual key.
   */
  revoke(id) {
    const deleted = this.keys.delete(id);
    if (deleted) {
      this._scheduleSave();
      console.log(`[VKEYS] Revoked virtual key ${id}`);
    }
    return deleted;
  }

  /**
   * Toggle a virtual key enabled/disabled.
   */
  toggle(id) {
    const entry = this.keys.get(id);
    if (!entry) return false;
    entry.enabled = !entry.enabled;
    this._scheduleSave();
    return true;
  }

  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

module.exports = VirtualKeyManager;
