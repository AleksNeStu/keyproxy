class MetricsCollector {
  constructor() {
    this.counters = {};
    this.gauges = {};
    this.histograms = {};
  }

  incCounter(name, labels = {}, value = 1) {
    const key = this._labelKey(name, labels);
    if (!this.counters[key]) {
      this.counters[key] = { name, labels, value: 0 };
    }
    this.counters[key].value += value;
  }

  setGauge(name, labels, value) {
    const key = this._labelKey(name, labels);
    this.gauges[key] = { name, labels, value };
  }

  observeHistogram(name, labels, value) {
    const key = this._labelKey(name, labels);
    if (!this.histograms[key]) {
      this.histograms[key] = { name, labels, values: [], sum: 0, count: 0, lastObserved: 0 };
    }
    this.histograms[key].values.push(value);
    this.histograms[key].sum += value;
    this.histograms[key].count++;
    this.histograms[key].lastObserved = Date.now();
    // Keep only last 1000 observations to bound memory
    if (this.histograms[key].values.length > 1000) {
      this.histograms[key].values.shift();
    }
  }

  _labelKey(name, labels) {
    const parts = Object.entries(labels).sort().map(([k, v]) => `${k}="${v}"`);
    return parts.length ? `${name}{${parts.join(',')}}` : name;
  }

  render() {
    const lines = [];
    const seen = new Set();

    const renderEntry = (entry, type) => {
      const metricName = entry.name;
      if (!seen.has(metricName)) {
        lines.push(`# HELP ${metricName} KeyProxy ${metricName}`);
        lines.push(`# TYPE ${metricName} ${type}`);
        seen.add(metricName);
      }
      const labelStr = Object.entries(entry.labels)
        .sort()
        .map(([k, v]) => `${k}="${this._escapeLabelValue(v)}"`)
        .join(',');
      const suffix = labelStr ? `{${labelStr}}` : '';
      if (type === 'histogram') {
        const h = entry;
        lines.push(`${metricName}_sum${suffix} ${h.sum}`);
        lines.push(`${metricName}_count${suffix} ${h.count}`);
        // Quantile approximations from stored values
        const sorted = [...h.values].sort((a, b) => a - b);
        if (sorted.length > 0) {
          const p50 = sorted[Math.floor(sorted.length * 0.5)];
          const p90 = sorted[Math.floor(sorted.length * 0.9)];
          const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
          lines.push(`${metricName}{${labelStr ? labelStr + ',' : ''}quantile="0.5"} ${p50}`);
          lines.push(`${metricName}{${labelStr ? labelStr + ',' : ''}quantile="0.9"} ${p90}`);
          lines.push(`${metricName}{${labelStr ? labelStr + ',' : ''}quantile="0.99"} ${p99}`);
        }
      } else {
        lines.push(`${metricName}${suffix} ${entry.value}`);
      }
    };

    for (const entry of Object.values(this.counters)) renderEntry(entry, 'counter');
    for (const entry of Object.values(this.gauges)) renderEntry(entry, 'gauge');
    for (const entry of Object.values(this.histograms)) renderEntry(entry, 'histogram');

    return lines.join('\n') + '\n';
  }

  _escapeLabelValue(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  reset() {
    this.counters = {};
    this.gauges = {};
    this.histograms = {};
  }

  /**
   * Remove histogram entries that have not been observed recently (stale keys
   * from rotated/removed providers) and enforce a hard cap on total keys.
   * Call periodically (e.g. every 5 minutes) to bound memory over long uptimes.
   * @param {number} staleThresholdMs - Evict keys idle longer than this (default 1 hour)
   */
  cleanup(staleThresholdMs = 3600000) {
    const now = Date.now();
    const keys = Object.keys(this.histograms);
    // Remove histograms with no recent observations
    for (const key of keys) {
      if (now - this.histograms[key].lastObserved > staleThresholdMs) {
        delete this.histograms[key];
      }
    }
    // Hard cap: if still too many unique keys, evict the stalest ones
    const remaining = Object.keys(this.histograms);
    if (remaining.length > 500) {
      remaining.sort((a, b) => this.histograms[a].lastObserved - this.histograms[b].lastObserved);
      const toRemove = remaining.slice(0, remaining.length - 500);
      for (const key of toRemove) {
        delete this.histograms[key];
      }
    }
  }
}

module.exports = MetricsCollector;
