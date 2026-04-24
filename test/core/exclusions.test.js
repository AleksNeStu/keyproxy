const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const KeyExclusionManager = require('../../src/core/exclusions');

describe('KeyExclusionManager', () => {
  let mgr;
  let tempDir;
  let tempFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'excl-test-'));
    tempFile = path.join(tempDir, 'exclusions.json');
    mgr = new KeyExclusionManager(tempFile);
  });

  afterEach(() => {
    if (mgr._saveTimer) {
      clearTimeout(mgr._saveTimer);
      mgr._saveTimer = null;
    }
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {}
  });

  describe('constructor', () => {
    it('starts with no patterns', () => {
      assert.equal(mgr.patterns.length, 0);
    });

    it('loads existing patterns from file', () => {
      const data = { patterns: [{ id: 'abc', pattern: 'TEST_*', type: 'glob', enabled: true, description: '', createdAt: '' }] };
      fs.writeFileSync(tempFile, JSON.stringify(data));

      const loaded = new KeyExclusionManager(tempFile);
      assert.equal(loaded.patterns.length, 1);
    });

    it('handles missing file gracefully', () => {
      const loaded = new KeyExclusionManager(path.join(tempDir, 'nonexistent.json'));
      assert.equal(loaded.patterns.length, 0);
    });

    it('handles corrupt file gracefully', () => {
      fs.writeFileSync(tempFile, 'not-json');
      const loaded = new KeyExclusionManager(tempFile);
      assert.equal(loaded.patterns.length, 0);
    });
  });

  describe('add', () => {
    it('adds a glob pattern', () => {
      const result = mgr.add({ pattern: 'CLOUDFLARE_*' });
      assert.ok(result.id);
      assert.equal(result.pattern, 'CLOUDFLARE_*');
      assert.equal(result.type, 'glob');
      assert.equal(result.enabled, true);
    });

    it('adds a regex pattern', () => {
      const result = mgr.add({ pattern: '^AWS_.*', type: 'regex' });
      assert.equal(result.type, 'regex');
    });

    it('auto-detects glob type', () => {
      const result = mgr.add({ pattern: 'PREFIX_*' });
      assert.equal(result.type, 'glob');
    });

    it('auto-detects regex type for complex patterns', () => {
      const result = mgr.add({ pattern: '^(AWS|GCP)_' });
      assert.equal(result.type, 'regex');
    });

    it('rejects empty pattern', () => {
      const result = mgr.add({ pattern: '' });
      assert.ok(result.error);
    });

    it('rejects null pattern', () => {
      const result = mgr.add({ pattern: null });
      assert.ok(result.error);
    });

    it('rejects duplicate pattern', () => {
      mgr.add({ pattern: 'TEST_*' });
      const result = mgr.add({ pattern: 'TEST_*' });
      assert.ok(result.error);
      assert.ok(result.error.includes('already exists'));
    });

    it('rejects invalid regex', () => {
      const result = mgr.add({ pattern: '[invalid', type: 'regex' });
      assert.ok(result.error);
    });

    it('trims whitespace from pattern', () => {
      const result = mgr.add({ pattern: '  TEST_*  ' });
      assert.equal(result.pattern, 'TEST_*');
    });

    it('stores description', () => {
      const result = mgr.add({ pattern: 'TEST_*', description: 'Exclude test keys' });
      assert.equal(result.description, 'Exclude test keys');
    });

    it('generates unique IDs', () => {
      const r1 = mgr.add({ pattern: 'TEST1_*' });
      const r2 = mgr.add({ pattern: 'TEST2_*' });
      assert.notEqual(r1.id, r2.id);
    });
  });

  describe('remove', () => {
    it('removes a pattern by id', () => {
      const added = mgr.add({ pattern: 'TEST_*' });
      const result = mgr.remove(added.id);

      assert.ok(result.success);
      assert.equal(mgr.patterns.length, 0);
    });

    it('returns error for non-existent id', () => {
      const result = mgr.remove('nonexistent');
      assert.ok(result.error);
    });
  });

  describe('toggle', () => {
    it('toggles pattern from enabled to disabled', () => {
      const added = mgr.add({ pattern: 'TEST_*' });
      const result = mgr.toggle(added.id);

      assert.equal(result.enabled, false);
    });

    it('toggles back to enabled', () => {
      const added = mgr.add({ pattern: 'TEST_*' });
      mgr.toggle(added.id);
      const result = mgr.toggle(added.id);

      assert.equal(result.enabled, true);
    });

    it('returns error for non-existent id', () => {
      const result = mgr.toggle('nonexistent');
      assert.ok(result.error);
    });
  });

  describe('list', () => {
    it('returns empty array for no patterns', () => {
      assert.deepEqual(mgr.list(), []);
    });

    it('returns all patterns without internal fields', () => {
      mgr.add({ pattern: 'TEST_*' });
      mgr.add({ pattern: 'OTHER_*' });

      const list = mgr.list();
      assert.equal(list.length, 2);

      for (const item of list) {
        assert.equal(item._compiledRegex, undefined);
        assert.ok(item.id);
        assert.ok(item.pattern);
      }
    });
  });

  describe('isExcluded', () => {
    it('matches glob pattern', () => {
      mgr.add({ pattern: 'CLOUDFLARE_*' });
      assert.equal(mgr.isExcluded('CLOUDFLARE_API_KEY'), true);
      assert.equal(mgr.isExcluded('CLOUDFLARE_TOKEN'), true);
      assert.equal(mgr.isExcluded('OPENAI_API_KEY'), false);
    });

    it('matches exact name with glob *', () => {
      mgr.add({ pattern: 'EXACT_KEY' });
      assert.equal(mgr.isExcluded('EXACT_KEY'), true);
      assert.equal(mgr.isExcluded('EXACT_KEY_OTHER'), false);
    });

    it('matches regex pattern', () => {
      mgr.add({ pattern: '^(AWS|GCP)_', type: 'regex' });
      assert.equal(mgr.isExcluded('AWS_SECRET_KEY'), true);
      assert.equal(mgr.isExcluded('GCP_API_KEY'), true);
      assert.equal(mgr.isExcluded('OPENAI_KEY'), false);
    });

    it('ignores disabled patterns', () => {
      const added = mgr.add({ pattern: 'DISABLED_*' });
      mgr.toggle(added.id); // disable
      assert.equal(mgr.isExcluded('DISABLED_KEY'), false);
    });

    it('returns false when no patterns', () => {
      assert.equal(mgr.isExcluded('ANY_KEY'), false);
    });

    it('is case insensitive', () => {
      mgr.add({ pattern: 'test_*' });
      assert.equal(mgr.isExcluded('TEST_KEY'), true);
      assert.equal(mgr.isExcluded('test_key'), true);
    });

    it('matches glob with ? single char', () => {
      mgr.add({ pattern: 'KEY_?' });
      assert.equal(mgr.isExcluded('KEY_A'), true);
      assert.equal(mgr.isExcluded('KEY_AB'), false);
    });
  });

  describe('testPattern', () => {
    it('returns matchedBy for matching pattern', () => {
      mgr.add({ pattern: 'CLOUDFLARE_*' });
      const result = mgr.testPattern('CLOUDFLARE_API_KEY');
      assert.equal(result.excluded, true);
      assert.equal(result.matchedBy, 'CLOUDFLARE_*');
    });

    it('returns excluded false for non-matching', () => {
      const result = mgr.testPattern('ANY_KEY');
      assert.equal(result.excluded, false);
      assert.equal(result.matchedBy, null);
    });
  });

  describe('clearAll', () => {
    it('removes all patterns', () => {
      mgr.add({ pattern: 'TEST1_*' });
      mgr.add({ pattern: 'TEST2_*' });

      const result = mgr.clearAll();
      assert.ok(result.success);
      assert.equal(mgr.patterns.length, 0);
    });
  });

  describe('reload', () => {
    it('reloads patterns from disk', () => {
      mgr.add({ pattern: 'TEST_*' });
      mgr._saveTimer = null; // clear timer
      mgr._flush && mgr._flush(); // flush if method exists

      // Write different data to file
      const data = { patterns: [{ id: 'new', pattern: 'RELOADED_*', type: 'glob', enabled: true, description: '', createdAt: '' }] };
      fs.writeFileSync(tempFile, JSON.stringify(data));

      mgr.reload();
      assert.equal(mgr.patterns.length, 1);
      assert.equal(mgr.patterns[0].pattern, 'RELOADED_*');
    });
  });
});
