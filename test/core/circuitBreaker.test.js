const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const CircuitBreaker = require('../../src/core/circuitBreaker');

describe('CircuitBreaker', () => {
  let cb;

  beforeEach(() => {
    cb = new CircuitBreaker(3, 100); // threshold=3, timeout=100ms for fast tests
  });

  describe('constructor', () => {
    it('uses defaults when no arguments', () => {
      const c = new CircuitBreaker();
      assert.equal(c.threshold, 5);
      assert.equal(c.timeoutMs, 30000);
      assert.equal(c.providers.size, 0);
    });

    it('accepts custom threshold and timeout', () => {
      const c = new CircuitBreaker(10, 60000);
      assert.equal(c.threshold, 10);
      assert.equal(c.timeoutMs, 60000);
    });

    it('exposes STATE constants', () => {
      assert.equal(CircuitBreaker.STATE.CLOSED, 'closed');
      assert.equal(CircuitBreaker.STATE.OPEN, 'open');
      assert.equal(CircuitBreaker.STATE.HALF_OPEN, 'half-open');
    });
  });

  describe('initial state', () => {
    it('starts in closed state for any provider', () => {
      const result = cb.check('openai');
      assert.equal(result.allowed, true);
      assert.equal(result.state, 'closed');
    });
  });

  describe('state transitions: closed -> open', () => {
    it('stays closed below threshold', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      const result = cb.check('openai');
      assert.equal(result.state, 'closed');
      assert.equal(result.allowed, true);
    });

    it('opens at threshold failures', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      const result = cb.check('openai');
      assert.equal(result.state, 'open');
      assert.equal(result.allowed, false);
    });

    it('tracks failure count correctly', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      const state = cb.getState('openai');
      assert.equal(state.failures, 2);
    });
  });

  describe('state transitions: open -> half-open', () => {
    it('stays open before timeout elapses', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      // Immediately check — should still be open
      const result = cb.check('openai');
      assert.equal(result.state, 'open');
      assert.equal(result.allowed, false);
    });

    it('transitions to half-open after timeout', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      // Wait for timeout
      const start = Date.now();
      while (Date.now() - start < 110) {}

      const result = cb.check('openai');
      assert.equal(result.state, 'half-open');
      assert.equal(result.allowed, true);
    });
  });

  describe('state transitions: half-open -> closed', () => {
    it('closes on success after half-open', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      // Wait for timeout -> half-open
      const start = Date.now();
      while (Date.now() - start < 110) {}
      cb.check('openai');

      // Record success
      cb.recordSuccess('openai');
      const result = cb.check('openai');
      assert.equal(result.state, 'closed');
      assert.equal(result.allowed, true);
    });

    it('resets failure count on recovery', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      const start = Date.now();
      while (Date.now() - start < 110) {}
      cb.check('openai');
      cb.recordSuccess('openai');

      const state = cb.getState('openai');
      assert.equal(state.failures, 0);
      assert.equal(state.totalRecoveries, 1);
    });
  });

  describe('state transitions: half-open -> open (re-open)', () => {
    it('re-opens on failure during half-open probe', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      const start = Date.now();
      while (Date.now() - start < 110) {}
      cb.check('openai'); // transition to half-open

      cb.recordFailure('openai'); // probe fails

      const result = cb.check('openai');
      assert.equal(result.state, 'open');
      assert.equal(result.allowed, false);
    });

    it('increments totalOpens on re-open', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      const start = Date.now();
      while (Date.now() - start < 110) {}
      cb.check('openai');
      cb.recordFailure('openai');

      const state = cb.getState('openai');
      assert.equal(state.totalOpens, 2); // initial open + re-open
    });
  });

  describe('recordSuccess in closed state', () => {
    it('resets failure count', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordSuccess('openai');

      const state = cb.getState('openai');
      assert.equal(state.failures, 0);
    });
  });

  describe('forceClose', () => {
    it('force-closes an open circuit', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      cb.forceClose('openai');

      const result = cb.check('openai');
      assert.equal(result.state, 'closed');
      assert.equal(result.allowed, true);
    });

    it('resets failures and openedAt', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.forceClose('openai');

      const state = cb.getState('openai');
      assert.equal(state.failures, 0);
      assert.equal(state.openedAt, null);
    });
  });

  describe('forceOpen', () => {
    it('force-opens a closed circuit', () => {
      cb.forceOpen('openai');

      const result = cb.check('openai');
      assert.equal(result.state, 'open');
      assert.equal(result.allowed, false);
    });

    it('increments totalOpens', () => {
      cb.forceOpen('openai');
      const state = cb.getState('openai');
      assert.equal(state.totalOpens, 1);
    });
  });

  describe('getState', () => {
    it('returns full state for a provider', () => {
      cb.recordFailure('openai');
      const state = cb.getState('openai');

      assert.equal(state.state, 'closed');
      assert.equal(state.failures, 1);
      assert.equal(state.threshold, 3);
      assert.equal(state.timeoutMs, 100);
      assert.equal(state.openedAt, null);
      assert.ok(state.lastFailureTime);
      assert.equal(state.totalOpens, 0);
      assert.equal(state.totalRecoveries, 0);
    });
  });

  describe('getAllStates', () => {
    it('returns states for all tracked providers', () => {
      cb.recordFailure('openai');
      cb.recordFailure('anthropic');

      const all = cb.getAllStates();
      assert.ok(all.openai);
      assert.ok(all.anthropic);
      assert.equal(all.openai.failures, 1);
      assert.equal(all.anthropic.failures, 1);
    });
  });

  describe('configure', () => {
    it('updates threshold', () => {
      cb.configure({ threshold: 10 });
      assert.equal(cb.threshold, 10);
    });

    it('updates timeoutMs', () => {
      cb.configure({ timeoutMs: 5000 });
      assert.equal(cb.timeoutMs, 5000);
    });

    it('only updates provided fields', () => {
      const origThreshold = cb.threshold;
      cb.configure({ timeoutMs: 999 });
      assert.equal(cb.threshold, origThreshold);
    });
  });

  describe('multiple providers', () => {
    it('tracks providers independently', () => {
      cb.recordFailure('openai');
      cb.recordFailure('openai');
      cb.recordFailure('openai');

      const openai = cb.check('openai');
      const anthropic = cb.check('anthropic');

      assert.equal(openai.state, 'open');
      assert.equal(anthropic.state, 'closed');
    });
  });
});
