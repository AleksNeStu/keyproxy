/**
 * SlidingWindowCounter - Per-key RPM tracking with 60-second window.
 * Informational only, no enforcement.
 */
const { maskApiKey } = require('./utils');

class SlidingWindowCounter {
  constructor(windowMs = 60000) {
    this.windowMs = windowMs;
    this.counters = new Map(); // key -> timestamps[]
  }

  /**
   * Record a request for a key.
   */
  record(key) {
    if (!key) return;
    if (!this.counters.has(key)) {
      this.counters.set(key, []);
    }
    this.counters.get(key).push(Date.now());
  }

  /**
   * Get current RPM for a key (requests in last 60s).
   */
  getRpm(key) {
    const timestamps = this.counters.get(key);
    if (!timestamps) return 0;
    const cutoff = Date.now() - this.windowMs;
    // Prune old entries
    while (timestamps.length > 0 && timestamps[0] < cutoff) {
      timestamps.shift();
    }
    return timestamps.length;
  }

  /**
   * Get RPM for all tracked keys.
   */
  getAllRpm() {
    const result = {};
    for (const [key] of this.counters.entries()) {
      const masked = maskApiKey(key);
      result[masked] = this.getRpm(key);
    }
    return result;
  }

  /**
   * Prune all expired entries (call periodically).
   */
  prune() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.counters.entries()) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.counters.delete(key);
      }
    }
  }
}

/**
 * Known provider rate limits (informational presets).
 */
const PROVIDER_RATE_LIMITS = {
  openai: { free: 3, paid: 500, label: 'OpenAI' },
  gemini: { free: 15, paid: 2000, label: 'Gemini' },
  groq: { free: 30, paid: 30, label: 'Groq' },
  anthropic: { free: 5, paid: 1000, label: 'Anthropic' }
};

/**
 * Get heat color based on RPM vs known limit.
 * Returns: green, yellow, orange, red
 */
function getRpmHeat(rpm, providerType) {
  const limits = PROVIDER_RATE_LIMITS[providerType];
  if (!limits) return 'green';
  const limit = limits.free;
  const pct = rpm / limit;
  if (pct >= 1) return 'red';
  if (pct >= 0.75) return 'orange';
  if (pct >= 0.5) return 'yellow';
  return 'green';
}

module.exports = { SlidingWindowCounter };
