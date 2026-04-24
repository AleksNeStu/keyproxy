const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const KeyHistoryManager = require('../../src/core/keyHistory');

describe('KeyHistoryManager', () => {
  let tempDir;
  let historyFile;
  let manager;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyhistory-test-'));
    historyFile = path.join(tempDir, 'key-history.json');
  });

  afterEach(() => {
    // Clean up temp directory
    if (manager) {
      manager.flushSync();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor & initialization', () => {
    it('uses default file path when none provided', () => {
      const defaultManager = new KeyHistoryManager(null);
      assert.ok(defaultManager.filePath.includes('key-history.json'));
    });

    it('uses custom file path when provided', () => {
      manager = new KeyHistoryManager(historyFile);
      assert.strictEqual(manager.filePath, historyFile);
    });

    it('initializes with empty data structure', () => {
      manager = new KeyHistoryManager(historyFile);
      assert.deepStrictEqual(manager.data, { providers: {} });
    });

    it('loads existing data from file', () => {
      // Create existing history file
      const existingData = {
        providers: {
          openai: {
            keys: {
              'abc123': {
                status: 'active',
                lastUsed: '2026-04-20T10:00:00.000Z',
                rotatedOutAt: null,
                rotationReason: null,
                rotationCount: 0,
                recoveryAttempts: 0,
                lastRecoveryAttempt: null
              }
            }
          }
        }
      };
      fs.writeFileSync(historyFile, JSON.stringify(existingData, null, 2));

      manager = new KeyHistoryManager(historyFile);
      assert.ok(manager.data.providers.openai);
      assert.strictEqual(manager.data.providers.openai.keys.abc123.status, 'active');
    });

    it('handles corrupt data file gracefully', () => {
      // Write invalid JSON
      fs.writeFileSync(historyFile, 'invalid json {{{');

      manager = new KeyHistoryManager(historyFile);
      assert.deepStrictEqual(manager.data, { providers: {} });
    });
  });

  describe('hashing', () => {
    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('generates consistent hash for same key', () => {
      const key = 'sk-test123456789';
      const hash1 = manager.hashKey(key);
      const hash2 = manager.hashKey(key);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 16);
    });

    it('generates different hashes for different keys', () => {
      const key1 = 'sk-test123456789';
      const key2 = 'sk-test987654321';

      assert.notStrictEqual(manager.hashKey(key1), manager.hashKey(key2));
    });

    it('generates hexadecimal hash', () => {
      const hash = manager.hashKey('sk-test');
      assert.match(hash, /^[a-f0-9]{16}$/);
    });
  });

  describe('key status recording', () => {
    const testKey = 'sk-test123456789';

    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('records key as active', () => {
      manager.recordKeyActive('openai', testKey);

      const status = manager.getKeyStatus('openai', testKey);
      assert.strictEqual(status.status, 'active');
      assert.ok(status.lastUsed);
    });

    it('records key as exhausted with status code', () => {
      manager.recordKeyExhausted('openai', testKey, 429);

      const status = manager.getKeyStatus('openai', testKey);
      assert.strictEqual(status.status, 'exhausted');
      assert.strictEqual(status.rotationReason, '429');
      assert.ok(status.rotatedOutAt);
      assert.strictEqual(status.rotationCount, 1);
    });

    it('increments rotation count on repeated exhaustion', () => {
      manager.recordKeyExhausted('openai', testKey, 429);
      manager.recordKeyExhausted('openai', testKey, 503);

      const status = manager.getKeyStatus('openai', testKey);
      assert.strictEqual(status.rotationCount, 2);
    });

    it('transitions from active to exhausted', () => {
      manager.recordKeyActive('openai', testKey);
      manager.recordKeyExhausted('openai', testKey, 429);

      const status = manager.getKeyStatus('openai', testKey);
      assert.strictEqual(status.status, 'exhausted');
    });

    it('tracks recovery attempts when exhausted again', () => {
      manager.recordKeyExhausted('openai', testKey, 429);
      // Simulate a recovery attempt
      const hash = manager.hashKey(testKey);
      manager.data.providers.openai.keys[hash].lastRecoveryAttempt = new Date().toISOString();
      manager.data.providers.openai.keys[hash].status = 'exhausted';

      // Exhaust again after recovery attempt
      manager.recordKeyExhausted('openai', testKey, 429);

      const status = manager.getKeyStatus('openai', testKey);
      assert.strictEqual(status.recoveryAttempts, 1);
    });
  });

  describe('querying key status', () => {
    const testKey = 'sk-test123456789';

    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('returns fresh status for unknown key', () => {
      const status = manager.getKeyStatus('openai', testKey);
      assert.deepStrictEqual(status, { status: 'fresh' });
    });

    it('returns full status for known key', () => {
      manager.recordKeyActive('openai', testKey);

      const status = manager.getKeyStatus('openai', testKey);
      assert.strictEqual(status.status, 'active');
      assert.ok(status.lastUsed);
    });

    it('returns empty object for unknown provider', () => {
      const status = manager.getKeyStatus('unknown', testKey);
      assert.deepStrictEqual(status, { status: 'fresh' });
    });

    it('gets provider history with all keys', () => {
      const key1 = 'sk-key111111111';
      const key2 = 'sk-key222222222';

      manager.recordKeyActive('openai', key1);
      manager.recordKeyExhausted('openai', key2, 429);

      const history = manager.getProviderHistory('openai');
      const hash1 = manager.hashKey(key1);
      const hash2 = manager.hashKey(key2);

      assert.ok(history[hash1]);
      assert.ok(history[hash2]);
      assert.strictEqual(history[hash1].status, 'active');
      assert.strictEqual(history[hash2].status, 'exhausted');
    });

    it('returns empty object for unknown provider history', () => {
      const history = manager.getProviderHistory('unknown');
      assert.deepStrictEqual(history, {});
    });

    it('gets all provider histories', () => {
      const openaiKey = 'sk-openai123';
      const geminiKey = 'AI-gemini456';

      manager.recordKeyActive('openai', openaiKey);
      manager.recordKeyActive('gemini', geminiKey);

      const allHistory = manager.getAllHistory();

      assert.ok(allHistory.openai);
      assert.ok(allHistory.gemini);
      assert.ok(Object.keys(allHistory).length >= 2);
    });
  });

  describe('key management', () => {
    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('syncs provider keys - adds new keys', () => {
      const keys = ['sk-key1', 'sk-key2', 'sk-key3'];

      manager.syncProviderKeys('openai', keys);

      const history = manager.getProviderHistory('openai');
      assert.strictEqual(Object.keys(history).length, 3);
    });

    it('syncs provider keys - removes old keys', () => {
      const keys1 = ['sk-key1', 'sk-key2', 'sk-key3'];
      const keys2 = ['sk-key1', 'sk-key3']; // key2 removed

      manager.syncProviderKeys('openai', keys1);
      manager.syncProviderKeys('openai', keys2);

      const history = manager.getProviderHistory('openai');
      assert.strictEqual(Object.keys(history).length, 2);
    });

    it('syncs provider keys - preserves status of existing keys', () => {
      const keys = ['sk-key1', 'sk-key2'];

      manager.syncProviderKeys('openai', keys);
      manager.recordKeyExhausted('openai', 'sk-key1', 429);

      // Sync again with same keys
      manager.syncProviderKeys('openai', keys);

      const status = manager.getKeyStatus('openai', 'sk-key1');
      assert.strictEqual(status.status, 'exhausted');
      assert.strictEqual(status.rotationCount, 1);
    });

    it('resets provider history', () => {
      const key = 'sk-test';
      manager.recordKeyActive('openai', key);

      manager.resetProvider('openai');

      const history = manager.getProviderHistory('openai');
      assert.deepStrictEqual(history, {});
    });

    it('resets all history', () => {
      manager.recordKeyActive('openai', 'sk-key1');
      manager.recordKeyActive('gemini', 'sk-key2');

      manager.resetAll();

      const allHistory = manager.getAllHistory();
      assert.deepStrictEqual(allHistory, {});
    });
  });

  describe('recovery management', () => {
    const exhaustedKey = 'sk-exhausted';
    const freshKey = 'sk-fresh';

    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);

      // Set up exhausted key
      manager.recordKeyActive('openai', exhaustedKey);
      manager.recordKeyExhausted('openai', exhaustedKey, 429);

      // Set up fresh key
      manager.recordKeyActive('openai', freshKey);
    });

    it('gets exhausted keys past cooldown period', () => {
      // Manually set rotatedOutAt to 10 minutes ago
      const hash = manager.hashKey(exhaustedKey);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      manager.data.providers.openai.keys[hash].rotatedOutAt = tenMinutesAgo;

      const exhausted = manager.getExhaustedKeys('openai', 5 * 60 * 1000); // 5 min cooldown

      assert.strictEqual(exhausted.length, 1);
      assert.strictEqual(exhausted[0].hash, hash);
      assert.strictEqual(exhausted[0].rotationReason, '429');
    });

    it('filters by cooldown period', () => {
      // Set rotatedOutAt to 2 minutes ago
      const hash = manager.hashKey(exhaustedKey);
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      manager.data.providers.openai.keys[hash].rotatedOutAt = twoMinutesAgo;

      // 5 min cooldown, should return empty
      const exhausted = manager.getExhaustedKeys('openai', 5 * 60 * 1000);

      assert.strictEqual(exhausted.length, 0);
    });

    it('resolves full key when provided', () => {
      const hash = manager.hashKey(exhaustedKey);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      manager.data.providers.openai.keys[hash].rotatedOutAt = tenMinutesAgo;

      const allKeys = [exhaustedKey, freshKey];
      const exhausted = manager.getExhaustedKeys('openai', 5 * 60 * 1000, allKeys);

      assert.strictEqual(exhausted.length, 1);
      assert.strictEqual(exhausted[0].fullKey, exhaustedKey);
    });

    it('respects max recovery attempts', () => {
      const hash = manager.hashKey(exhaustedKey);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      manager.data.providers.openai.keys[hash].rotatedOutAt = tenMinutesAgo;
      manager.data.providers.openai.keys[hash].recoveryAttempts = 3;

      // Max 2 attempts, should return empty
      const exhausted = manager.getExhaustedKeys('openai', 5 * 60 * 1000, [], 2);

      assert.strictEqual(exhausted.length, 0);
    });

    it('recovers exhausted key successfully', () => {
      const hash = manager.hashKey(exhaustedKey);

      const recovered = manager.recoverKey('openai', exhaustedKey);

      assert.strictEqual(recovered, true);

      const status = manager.getKeyStatus('openai', exhaustedKey);
      assert.strictEqual(status.status, 'active');
      assert.strictEqual(status.rotatedOutAt, null);
      assert.strictEqual(status.rotationReason, null);
      assert.strictEqual(status.recoveryAttempts, 0);
    });

    it('returns false when recovering non-exhausted key', () => {
      const recovered = manager.recoverKey('openai', freshKey);

      assert.strictEqual(recovered, false);
    });

    it('returns false when recovering unknown key', () => {
      const recovered = manager.recoverKey('openai', 'sk-unknown');

      assert.strictEqual(recovered, false);
    });

    it('resets recovery attempts for a key', () => {
      const hash = manager.hashKey(exhaustedKey);
      manager.data.providers.openai.keys[hash].recoveryAttempts = 5;

      const reset = manager.resetRecoveryAttempts('openai', exhaustedKey);

      assert.strictEqual(reset, true);

      const status = manager.getKeyStatus('openai', exhaustedKey);
      assert.strictEqual(status.recoveryAttempts, 0);
      assert.strictEqual(status.lastRecoveryAttempt, null);
    });

    it('returns false when resetting recovery for unknown key', () => {
      const reset = manager.resetRecoveryAttempts('openai', 'sk-unknown');

      assert.strictEqual(reset, false);
    });
  });

  describe('utility functions', () => {
    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('builds status map for all keys', () => {
      const key1 = 'sk-key1';
      const key2 = 'sk-key2';

      manager.recordKeyActive('openai', key1);
      manager.recordKeyExhausted('openai', key2, 429);

      const statusMap = manager.getStatusMap('openai', [key1, key2]);

      assert.ok(statusMap[key1]);
      assert.ok(statusMap[key2]);
      assert.strictEqual(statusMap[key1].status, 'active');
      assert.strictEqual(statusMap[key2].status, 'exhausted');
      assert.ok(statusMap[key1].hash);
      assert.ok(statusMap[key2].hash);
    });

    it('includes hash in status map', () => {
      const key = 'sk-test';
      manager.recordKeyActive('openai', key);

      const statusMap = manager.getStatusMap('openai', [key]);

      assert.strictEqual(statusMap[key].hash, manager.hashKey(key));
    });
  });

  describe('data persistence', () => {
    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('schedules debounced save on operations', async () => {
      manager.recordKeyActive('openai', 'sk-test');

      // File should not exist immediately (debounced)
      assert.ok(!fs.existsSync(historyFile));

      // Use flushSync for immediate persistence
      manager.flushSync();

      assert.ok(fs.existsSync(historyFile));
    });

    it('persists data to file on flushSync', () => {
      manager.recordKeyActive('openai', 'sk-test');
      manager.flushSync();

      const savedData = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      assert.ok(savedData.providers);
    });

    it('handles write errors gracefully', () => {
      const invalidManager = new KeyHistoryManager('/invalid/path/history.json');

      assert.doesNotThrow(() => {
        invalidManager.recordKeyActive('openai', 'sk-test');
        invalidManager.flushSync();
      });
    });

    it('handles write to non-existent directory gracefully', () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'history.json');
      const nestedManager = new KeyHistoryManager(nestedPath);

      nestedManager.recordKeyActive('openai', 'sk-test');

      // Should not throw even though directory doesn't exist
      assert.doesNotThrow(() => {
        nestedManager.flushSync();
      });

      // File should NOT be created (directory doesn't exist)
      assert.ok(!fs.existsSync(nestedPath));
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      manager = new KeyHistoryManager(historyFile);
    });

    it('handles empty key list in sync', () => {
      manager.syncProviderKeys('openai', []);

      const history = manager.getProviderHistory('openai');
      assert.deepStrictEqual(history, {});
    });

    it('throws on null keys during hashing', () => {
      // hashKey uses crypto which requires a string
      assert.throws(() => {
        manager.hashKey(null);
      });
      assert.throws(() => {
        manager.hashKey(undefined);
      });
    });

    it('handles special characters in keys', () => {
      const specialKey = 'sk-test_!@#$%^&*()';

      assert.doesNotThrow(() => {
        manager.recordKeyActive('openai', specialKey);
        const status = manager.getKeyStatus('openai', specialKey);
        assert.strictEqual(status.status, 'active');
      });
    });

    it('handles very long keys', () => {
      const longKey = 'sk-' + 'a'.repeat(1000);

      assert.doesNotThrow(() => {
        manager.recordKeyActive('openai', longKey);
        const hash = manager.hashKey(longKey);
        assert.strictEqual(hash.length, 16); // Hash should always be 16 chars
      });
    });
  });
});
