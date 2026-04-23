const fs = require('fs');
const path = require('path');
const { maskApiKey } = require('./utils');
const { estimateCost, estimateTokens, extractModel } = require('./pricing');

class AnalyticsTracker {
  constructor(filePath = null) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'analytics.json');
    this.data = { days: {} };
    this.saveTimer = null;
    this.saveDelay = 10000; // 10s debounce
    this.dirty = false;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (!this.data.days) this.data.days = {};
      }
    } catch (err) {
      console.log(`[ANALYTICS] Could not load file, starting fresh: ${err.message}`);
      this.data = { days: {} };
    }
  }

  _scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this._flush();
    }, this.saveDelay);
  }

  _flush() {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.log(`[ANALYTICS] Write failed: ${err.message}`);
    }
  }

  flushSync() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = true;
    this._flush();
  }

  _dayKey(ts) {
    return new Date(ts).toISOString().slice(0, 10);
  }

  _ensureDay(dayKey) {
    if (!this.data.days[dayKey]) {
      this.data.days[dayKey] = {
        providers: {},
        totalRequests: 0,
        totalErrors: 0,
        totalLatencyMs: 0
      };
    }
    return this.data.days[dayKey];
  }

  _ensureProvider(day, providerName) {
    if (!day.providers[providerName]) {
      day.providers[providerName] = {
        requests: 0,
        errors: 0,
        latencyMs: 0,
        estimatedInputTokens: 0,
        estimatedOutputTokens: 0,
        estimatedCost: 0,
        keys: {},
        models: {}
      };
    }
    return day.providers[providerName];
  }

  /**
   * Record a completed request.
   */
  recordRequest({ provider, statusCode, latencyMs, requestBody, responseBody, apiKey, apiType }) {
    const dayKey = this._dayKey(Date.now());
    const day = this._ensureDay(dayKey);
    const prov = this._ensureProvider(day, provider);

    day.totalRequests++;
    day.totalLatencyMs += latencyMs;
    prov.requests++;
    prov.latencyMs += latencyMs;

    if (statusCode >= 400) {
      day.totalErrors++;
      prov.errors++;
    }

    // Token estimation
    const model = extractModel(requestBody, null);
    const inputTokens = estimateTokens(requestBody);
    const outputTokens = estimateTokens(responseBody);

    prov.estimatedInputTokens += inputTokens;
    prov.estimatedOutputTokens += outputTokens;

    const cost = estimateCost(apiType, model, inputTokens, outputTokens);
    prov.estimatedCost += cost.totalCost;

    // Per-key tracking (masked)
    if (apiKey) {
      const masked = maskApiKey(apiKey);
      if (!prov.keys[masked]) {
        prov.keys[masked] = { requests: 0, errors: 0, estimatedCost: 0 };
      }
      prov.keys[masked].requests++;
      if (statusCode >= 400) prov.keys[masked].errors++;
      prov.keys[masked].estimatedCost += cost.totalCost;
    }

    // Per-model tracking
    if (model) {
      if (!prov.models[model]) {
        prov.models[model] = { requests: 0, estimatedCost: 0 };
      }
      prov.models[model].requests++;
      prov.models[model].estimatedCost += cost.totalCost;
    }

    this._scheduleSave();
  }

  /**
   * Query analytics for a date range.
   * @param {string} range - '7d', '30d', 'all'
   */
  query(range = '7d') {
    const now = new Date();
    const days = Object.entries(this.data.days)
      .filter(([date]) => {
        if (range === 'all') return true;
        const daysBack = range === '30d' ? 30 : 7;
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - daysBack);
        return new Date(date) >= cutoff;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const summary = {
      totalRequests: 0,
      totalErrors: 0,
      totalLatencyMs: 0,
      totalCost: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      providers: {},
      dailyRequests: [],
      dailyCost: [],
      topKeys: [],
      modelBreakdown: {}
    };

    const keyMap = {};
    const modelMap = {};

    for (const [date, day] of days) {
      summary.totalRequests += day.totalRequests;
      summary.totalErrors += day.totalErrors;
      summary.totalLatencyMs += day.totalLatencyMs;

      summary.dailyRequests.push({ date, count: day.totalRequests });

      let dayCost = 0;

      for (const [provName, prov] of Object.entries(day.providers)) {
        if (!summary.providers[provName]) {
          summary.providers[provName] = {
            requests: 0, errors: 0, latencyMs: 0,
            estimatedCost: 0, estimatedInputTokens: 0, estimatedOutputTokens: 0
          };
        }
        const sp = summary.providers[provName];
        sp.requests += prov.requests;
        sp.errors += prov.errors;
        sp.latencyMs += prov.latencyMs;
        sp.estimatedCost += prov.estimatedCost;
        sp.estimatedInputTokens += prov.estimatedInputTokens;
        sp.estimatedOutputTokens += prov.estimatedOutputTokens;

        dayCost += prov.estimatedCost;

        for (const [key, stats] of Object.entries(prov.keys)) {
          if (!keyMap[key]) keyMap[key] = { requests: 0, errors: 0, estimatedCost: 0 };
          keyMap[key].requests += stats.requests;
          keyMap[key].errors += stats.errors;
          keyMap[key].estimatedCost += stats.estimatedCost;
        }

        for (const [model, stats] of Object.entries(prov.models)) {
          if (!modelMap[model]) modelMap[model] = { requests: 0, estimatedCost: 0 };
          modelMap[model].requests += stats.requests;
          modelMap[model].estimatedCost += stats.estimatedCost;
        }
      }

      summary.totalCost += dayCost;
      summary.dailyCost.push({ date, cost: Math.round(dayCost * 10000) / 10000 });
    }

    // Compute avg latency
    summary.avgLatencyMs = summary.totalRequests > 0
      ? Math.round(summary.totalLatencyMs / summary.totalRequests) : 0;

    // Top keys by usage
    summary.topKeys = Object.entries(keyMap)
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 20);

    summary.modelBreakdown = modelMap;

    return summary;
  }

  /**
   * Purge data older than N days.
   */
  purge(olderThanDays = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let purged = 0;
    for (const date of Object.keys(this.data.days)) {
      if (date < cutoffStr) {
        delete this.data.days[date];
        purged++;
      }
    }
    if (purged > 0) {
      console.log(`[ANALYTICS] Purged ${purged} days of data older than ${olderThanDays} days`);
      this._scheduleSave();
    }
    return purged;
  }

  reset() {
    this.data = { days: {} };
    this._scheduleSave();
  }
}

module.exports = AnalyticsTracker;
