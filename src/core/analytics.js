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
    this._writing = false;
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
    const dataToSave = JSON.stringify(this.data, null, 2);
    this._writing = true;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(this.filePath, dataToSave, (err) => {
      this._writing = false;
      if (err) {
        console.log(`[ANALYTICS] Write failed: ${err.message}`);
        // Don't clear dirty — will retry on next schedule
      } else {
        this.dirty = false;
      }
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
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
      this.dirty = false;
    } catch (err) {
      console.log(`[ANALYTICS] Sync write failed: ${err.message}`);
    }
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
        models: {},
        latencyBuckets: { '<100': 0, '100-250': 0, '250-500': 0, '500-1000': 0, '1000-3000': 0, '3000-10000': 0, '>10000': 0 }
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

    // Latency bucket assignment
    if (latencyMs < 100) prov.latencyBuckets['<100']++;
    else if (latencyMs < 250) prov.latencyBuckets['100-250']++;
    else if (latencyMs < 500) prov.latencyBuckets['250-500']++;
    else if (latencyMs < 1000) prov.latencyBuckets['500-1000']++;
    else if (latencyMs < 3000) prov.latencyBuckets['1000-3000']++;
    else if (latencyMs < 10000) prov.latencyBuckets['3000-10000']++;
    else prov.latencyBuckets['>10000']++;

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
      dailyLatency: [],
      latencyBuckets: { '<100': 0, '100-250': 0, '250-500': 0, '500-1000': 0, '1000-3000': 0, '3000-10000': 0, '>10000': 0 },
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

      // Daily latency average
      const dayAvgLatency = day.totalRequests > 0 ? Math.round(day.totalLatencyMs / day.totalRequests) : 0;
      summary.dailyLatency.push({ date, avgMs: dayAvgLatency });

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

        // Accumulate into summary totals
        summary.totalInputTokens += prov.estimatedInputTokens;
        summary.totalOutputTokens += prov.estimatedOutputTokens;

        // Aggregate latency buckets
        if (prov.latencyBuckets) {
          for (const [bucket, count] of Object.entries(prov.latencyBuckets)) {
            summary.latencyBuckets[bucket] = (summary.latencyBuckets[bucket] || 0) + count;
          }
        }

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

    // Compute percentile estimates from bucket distribution
    summary.p50LatencyMs = this._estimatePercentile(summary.latencyBuckets, 0.50);
    summary.p95LatencyMs = this._estimatePercentile(summary.latencyBuckets, 0.95);
    summary.p99LatencyMs = this._estimatePercentile(summary.latencyBuckets, 0.99);

    // Top keys by usage
    summary.topKeys = Object.entries(keyMap)
      .map(([key, stats]) => ({ key, ...stats }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 20);

    summary.modelBreakdown = modelMap;

    return summary;
  }

  /**
   * Estimate a latency percentile from bucket distribution.
   * Uses the midpoint of each bucket range for approximation.
   * @param {Object} buckets - { '<100': n, '100-250': n, ... }
   * @param {number} percentile - 0-1 (e.g. 0.95 for p95)
   * @returns {number} estimated latency in ms
   */
  _estimatePercentile(buckets, percentile) {
    const bucketDefs = [
      { key: '<100', min: 0, max: 100 },
      { key: '100-250', min: 100, max: 250 },
      { key: '250-500', min: 250, max: 500 },
      { key: '500-1000', min: 500, max: 1000 },
      { key: '1000-3000', min: 1000, max: 3000 },
      { key: '3000-10000', min: 3000, max: 10000 },
      { key: '>10000', min: 10000, max: 30000 },
    ];

    const total = bucketDefs.reduce((s, b) => s + (buckets[b.key] || 0), 0);
    if (total === 0) return 0;

    const target = total * percentile;
    let cumulative = 0;

    for (const bucket of bucketDefs) {
      const count = buckets[bucket.key] || 0;
      cumulative += count;
      if (cumulative >= target) {
        // Interpolate within this bucket
        const prevCumulative = cumulative - count;
        const fraction = (target - prevCumulative) / count;
        return Math.round(bucket.min + fraction * (bucket.max - bucket.min));
      }
    }

    // Fallback: return upper bound of last bucket
    return bucketDefs[bucketDefs.length - 1].max;
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
