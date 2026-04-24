const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const VirtualKeyManager = require('../../src/core/virtualKeys');

describe('VirtualKeyManager', () => {
  let vkm;
  let tempDir;
  let tempFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vkeys-test-'));
    tempFile = path.join(tempDir, 'virtual-keys.json');
    vkm = new VirtualKeyManager(tempFile);
  });

  afterEach(() => {
    if (vkm.saveTimer) {
      clearTimeout(vkm.saveTimer);
      vkm.saveTimer = null;
    }
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {}
  });

  describe('constructor', () => {
    it('starts with empty keys', () => {
      assert.equal(vkm.keys.size, 0);
    });

    it('loads from existing file', () => {
      const data = {
        keys: [{
          id: 'abc123',
          name: 'test-key',
          tokenHash: 'hash123',
          tokenPrefix: 'vk-abc',
          allowedProviders: [],
          allowedModels: [],
          rpmLimit: 0,
          expiresAt: null,
          createdBy: 'admin',
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          usageCount: 0,
          enabled: true
        }]
      };
      fs.writeFileSync(tempFile, JSON.stringify(data));

      const loaded = new VirtualKeyManager(tempFile);
      assert.equal(loaded.keys.size, 1);
      assert.equal(loaded.keys.get('abc123').name, 'test-key');
    });

    it('handles missing file gracefully', () => {
      const loaded = new VirtualKeyManager(path.join(tempDir, 'nonexistent.json'));
      assert.equal(loaded.keys.size, 0);
    });

    it('handles corrupt file gracefully', () => {
      fs.writeFileSync(tempFile, 'not-json');
      const loaded = new VirtualKeyManager(tempFile);
      assert.equal(loaded.keys.size, 0);
    });
  });

  describe('create', () => {
    it('creates a virtual key with all fields', () => {
      const result = vkm.create({
        name: 'test-key',
        allowedProviders: ['openai'],
        allowedModels: ['gpt-4'],
        rpmLimit: 60,
        createdBy: 'admin'
      });

      assert.ok(result.id, 'should have id');
      assert.ok(result.token, 'should have token');
      assert.ok(result.token.startsWith('vk-'), 'token should start with vk-');
      assert.equal(result.name, 'test-key');
      assert.deepEqual(result.allowedProviders, ['openai']);
      assert.deepEqual(result.allowedModels, ['gpt-4']);
      assert.equal(result.rpmLimit, 60);
      assert.equal(result.enabled, true);
    });

    it('generates default name when not provided', () => {
      const result = vkm.create({});
      assert.ok(result.name.startsWith('key-'));
    });

    it('generates unique IDs for each key', () => {
      const r1 = vkm.create({ name: 'key1' });
      const r2 = vkm.create({ name: 'key2' });
      assert.notEqual(r1.id, r2.id);
    });

    it('generates unique tokens', () => {
      const r1 = vkm.create({ name: 'key1' });
      const r2 = vkm.create({ name: 'key2' });
      assert.notEqual(r1.token, r2.token);
    });

    it('stores token hash, not plaintext', () => {
      const result = vkm.create({ name: 'test' });

      // The stored entry should have a hash, not the plaintext
      const stored = vkm.keys.get(result.id);
      assert.ok(stored.tokenHash);
      assert.notEqual(stored.tokenHash, result.token);
      assert.ok(stored.tokenPrefix.startsWith('vk-'));
    });

    it('stores the key in the map', () => {
      vkm.create({ name: 'test' });
      assert.equal(vkm.keys.size, 1);
    });
  });

  describe('validate', () => {
    it('validates a correct token', () => {
      const result = vkm.create({ name: 'test' });
      const entry = vkm.validate(result.token);

      assert.ok(entry);
      assert.equal(entry.name, 'test');
    });

    it('returns null for null token', () => {
      assert.equal(vkm.validate(null), null);
    });

    it('returns null for empty string', () => {
      assert.equal(vkm.validate(''), null);
    });

    it('returns null for non-vk token', () => {
      assert.equal(vkm.validate('invalid-token'), null);
    });

    it('returns null for wrong token', () => {
      vkm.create({ name: 'test' });
      assert.equal(vkm.validate('vk-wrongtoken123456789'), null);
    });

    it('returns null for disabled key', () => {
      const result = vkm.create({ name: 'test' });
      vkm.toggle(result.id); // disable it

      assert.equal(vkm.validate(result.token), null);
    });

    it('returns null for expired key', () => {
      const result = vkm.create({
        name: 'expired',
        expiresAt: new Date(Date.now() - 1000).toISOString() // expired
      });

      assert.equal(vkm.validate(result.token), null);
    });

    it('updates usage count on validation', () => {
      const result = vkm.create({ name: 'test' });
      vkm.validate(result.token);
      vkm.validate(result.token);

      const stored = vkm.keys.get(result.id);
      assert.equal(stored.usageCount, 2);
    });

    it('updates lastUsedAt on validation', () => {
      const result = vkm.create({ name: 'test' });
      const entry = vkm.validate(result.token);

      assert.ok(entry.lastUsedAt);
    });
  });

  describe('list', () => {
    it('returns empty array for no keys', () => {
      const list = vkm.list();
      assert.deepEqual(list, []);
    });

    it('returns all keys without token hashes', () => {
      vkm.create({ name: 'key1' });
      vkm.create({ name: 'key2' });

      const list = vkm.list();
      assert.equal(list.length, 2);

      for (const item of list) {
        assert.equal(item.tokenHash, undefined, 'should not expose tokenHash');
        assert.ok(item.id);
        assert.ok(item.name);
        assert.ok(item.tokenPrefix);
      }
    });
  });

  describe('revoke', () => {
    it('removes a key by id', () => {
      const result = vkm.create({ name: 'test' });
      const deleted = vkm.revoke(result.id);

      assert.equal(deleted, true);
      assert.equal(vkm.keys.size, 0);
    });

    it('returns false for non-existent id', () => {
      assert.equal(vkm.revoke('nonexistent'), false);
    });

    it('invalidates token after revoke', () => {
      const result = vkm.create({ name: 'test' });
      vkm.revoke(result.id);
      assert.equal(vkm.validate(result.token), null);
    });
  });

  describe('toggle', () => {
    it('toggles key from enabled to disabled', () => {
      const result = vkm.create({ name: 'test' });
      assert.equal(result.enabled, true);

      vkm.toggle(result.id);
      const stored = vkm.keys.get(result.id);
      assert.equal(stored.enabled, false);
    });

    it('toggles back to enabled', () => {
      const result = vkm.create({ name: 'test' });
      vkm.toggle(result.id);
      vkm.toggle(result.id);

      const stored = vkm.keys.get(result.id);
      assert.equal(stored.enabled, true);
    });

    it('returns false for non-existent id', () => {
      assert.equal(vkm.toggle('nonexistent'), false);
    });
  });

  describe('persistence', () => {
    it('flushes data to file', () => {
      vkm.create({ name: 'test' });
      vkm._flush();

      assert.ok(fs.existsSync(tempFile));
      const data = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
      assert.equal(data.keys.length, 1);
    });
  });
});
