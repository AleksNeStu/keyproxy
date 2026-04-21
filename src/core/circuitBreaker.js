/**
 * CircuitBreaker - Per-provider circuit breaker pattern.
 *
 * States: closed (normal) → open (failing) → half-open (probing)
 *
 * - After threshold consecutive failures, opens the circuit (503 immediately).
 * - After timeout, transitions to half-open (allows one probe request).
 * - If probe succeeds, closes the circuit. If it fails, re-opens.
 *
 * Config: KEYPROXY_CB_THRESHOLD (default: 5), KEYPROXY_CB_TIMEOUT_SEC (default: 30)
 */

const STATE = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half-open' };

class CircuitBreaker {
  constructor(threshold = 5, timeoutMs = 30000) {
    this.threshold = threshold;
    this.timeoutMs = timeoutMs;
    this.providers = new Map();
  }

  _ensure(name) {
    if (!this.providers.has(name)) {
      this.providers.set(name, {
        state: STATE.CLOSED,
        failures: 0,
        lastFailureTime: null,
        openedAt: null,
        totalOpens: 0,
        totalRecoveries: 0
      });
    }
    return this.providers.get(name);
  }

  /**
   * Record a successful request. Closes circuit if half-open.
   */
  recordSuccess(providerName) {
    const cb = this._ensure(providerName);
    if (cb.state === STATE.HALF_OPEN) {
      cb.state = STATE.CLOSED;
      cb.failures = 0;
      cb.totalRecoveries++;
      console.log(`[CB] ${providerName} circuit CLOSED (recovered)`);
    } else if (cb.state === STATE.CLOSED) {
      cb.failures = 0;
    }
  }

  /**
   * Record a failure. Opens circuit if threshold reached.
   */
  recordFailure(providerName) {
    const cb = this._ensure(providerName);
    cb.failures++;
    cb.lastFailureTime = Date.now();

    if (cb.state === STATE.HALF_OPEN) {
      // Probe failed, re-open
      cb.state = STATE.OPEN;
      cb.openedAt = Date.now();
      cb.totalOpens++;
      console.log(`[CB] ${providerName} circuit re-OPENED (probe failed, ${cb.failures} consecutive failures)`);
    } else if (cb.failures >= this.threshold) {
      cb.state = STATE.OPEN;
      cb.openedAt = Date.now();
      cb.totalOpens++;
      console.log(`[CB] ${providerName} circuit OPENED (${cb.failures} consecutive failures, threshold: ${this.threshold})`);
    }
  }

  /**
   * Check if a request is allowed for this provider.
   * Returns { allowed: boolean, state: string }
   */
  check(providerName) {
    const cb = this._ensure(providerName);

    if (cb.state === STATE.CLOSED) {
      return { allowed: true, state: STATE.CLOSED };
    }

    if (cb.state === STATE.OPEN) {
      const elapsed = Date.now() - cb.openedAt;
      if (elapsed >= this.timeoutMs) {
        // Transition to half-open
        cb.state = STATE.HALF_OPEN;
        console.log(`[CB] ${providerName} circuit HALF-OPEN (timeout: ${this.timeoutMs}ms elapsed)`);
        return { allowed: true, state: STATE.HALF_OPEN };
      }
      return { allowed: false, state: STATE.OPEN };
    }

    // HALF_OPEN — allow one probe
    return { allowed: true, state: STATE.HALF_OPEN };
  }

  /**
   * Force-close a circuit (admin action).
   */
  forceClose(providerName) {
    const cb = this._ensure(providerName);
    cb.state = STATE.CLOSED;
    cb.failures = 0;
    cb.openedAt = null;
    console.log(`[CB] ${providerName} circuit force-CLOSED`);
  }

  /**
   * Force-open a circuit (admin action).
   */
  forceOpen(providerName) {
    const cb = this._ensure(providerName);
    cb.state = STATE.OPEN;
    cb.openedAt = Date.now();
    cb.totalOpens++;
    console.log(`[CB] ${providerName} circuit force-OPENED`);
  }

  /**
   * Get circuit state for a provider.
   */
  getState(providerName) {
    const cb = this._ensure(providerName);
    return {
      state: cb.state,
      failures: cb.failures,
      threshold: this.threshold,
      timeoutMs: this.timeoutMs,
      openedAt: cb.openedAt,
      lastFailureTime: cb.lastFailureTime,
      totalOpens: cb.totalOpens,
      totalRecoveries: cb.totalRecoveries
    };
  }

  /**
   * Get all circuit states (for admin UI).
   */
  getAllStates() {
    const result = {};
    for (const [name] of this.providers.entries()) {
      result[name] = this.getState(name);
    }
    return result;
  }

  /**
   * Configure threshold and timeout at runtime.
   */
  configure({ threshold, timeoutMs }) {
    if (threshold !== undefined) this.threshold = threshold;
    if (timeoutMs !== undefined) this.timeoutMs = timeoutMs;
  }
}

CircuitBreaker.STATE = STATE;

module.exports = CircuitBreaker;
