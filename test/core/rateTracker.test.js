const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SlidingWindowCounter } = require('../../src/core/rateTracker');

describe('SlidingWindowCounter', () => {
  let tracker;

  beforeEach(() => {
    tracker = new SlidingWindowCounter(60000);
  });

  describe('constructor', () => {
    it('uses default window of 60000ms', () => {
      const t = new SlidingWindowCounter();
      assert.equal(t.windowMs, 60000);
    });

    it('accepts custom window', () => {
      const t = new SlidingWindowCounter(30000);
      assert.equal(t.windowMs, 30000);
    });
  });

  describe('record', () => {
    it('records a request for a key', () => {
      tracker.record('test-key');
      assert.equal(tracker.counters.get('test-key').length, 1);
    });

    it('handles multiple records for same key', () => {
      tracker.record('test-key');
      tracker.record('test-key');
      tracker.record('test-key');
      assert.equal(tracker.counters.get('test-key').length, 3);
    });

    it('handles multiple keys independently', () => {
      tracker.record('key1');
      tracker.record('key2');
      tracker.record('key1');

      assert.equal(tracker.counters.get('key1').length, 2);
      assert.equal(tracker.counters.get('key2').length, 1);
    });

    it('ignores null/undefined key', () => {
      tracker.record(null);
      tracker.record(undefined);
      assert.equal(tracker.counters.size, 0);
    });

    it('ignores empty string key', () => {
      tracker.record('');
      assert.equal(tracker.counters.size, 0);
    });
  });

  describe('getRpm', () => {
    it('returns 0 for unknown key', () => {
      assert.equal(tracker.getRpm('unknown'), 0);
    });

    it('returns count of recent requests', () => {
      tracker.record('key1');
      tracker.record('key1');
      tracker.record('key1');

      assert.equal(tracker.getRpm('key1'), 3);
    });

    it('prunes old entries on get', () => {
      const shortTracker = new SlidingWindowCounter(10); // 10ms window
      shortTracker.record('key1');

      const start = Date.now();
      while (Date.now() - start < 20) {} // wait for expiry

      assert.equal(shortTracker.getRpm('key1'), 0);
    });
  });

  describe('getAllRpm', () => {
    it('returns RPM for all tracked keys with masked names', () => {
      tracker.record('sk-1234567890abcdef');
      tracker.record('sk-1234567890abcdef');
      tracker.record('sk-abcdefghij123456');

      const all = tracker.getAllRpm();
      assert.equal(Object.keys(all).length, 2);

      // Keys should be masked
      for (const masked of Object.keys(all)) {
        assert.ok(masked.includes('...'), `Key should be masked: ${masked}`);
      }
    });

    it('returns empty object when no keys tracked', () => {
      const all = tracker.getAllRpm();
      assert.deepEqual(all, {});
    });
  });

  describe('prune', () => {
    it('removes expired entries', () => {
      const shortTracker = new SlidingWindowCounter(10);
      shortTracker.record('key1');

      const start = Date.now();
      while (Date.now() - start < 20) {}

      shortTracker.prune();
      assert.equal(shortTracker.counters.has('key1'), false);
    });

    it('keeps fresh entries', () => {
      tracker.record('key1');
      tracker.prune();
      assert.equal(tracker.counters.has('key1'), true);
    });

    it('removes empty counter entries', () => {
      const shortTracker = new SlidingWindowCounter(10);
      shortTracker.record('key1');

      const start = Date.now();
      while (Date.now() - start < 20) {}

      shortTracker.prune();
      assert.equal(shortTracker.counters.size, 0);
    });
  });
});
