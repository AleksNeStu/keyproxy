const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const MetricsCollector = require('../../src/core/metrics');

describe('MetricsCollector', () => {
  let metrics;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  describe('constructor', () => {
    it('initializes empty counters, gauges, histograms', () => {
      assert.deepEqual(metrics.counters, {});
      assert.deepEqual(metrics.gauges, {});
      assert.deepEqual(metrics.histograms, {});
    });
  });

  describe('incCounter', () => {
    it('creates a new counter with value 1 by default', () => {
      metrics.incCounter('requests_total');
      assert.equal(metrics.counters['requests_total'].value, 1);
    });

    it('increments existing counter', () => {
      metrics.incCounter('requests_total');
      metrics.incCounter('requests_total');
      metrics.incCounter('requests_total');
      assert.equal(metrics.counters['requests_total'].value, 3);
    });

    it('uses custom increment value', () => {
      metrics.incCounter('requests_total', {}, 5);
      assert.equal(metrics.counters['requests_total'].value, 5);
    });

    it('creates separate counters for different labels', () => {
      metrics.incCounter('requests_total', { provider: 'openai' });
      metrics.incCounter('requests_total', { provider: 'anthropic' });

      assert.equal(Object.keys(metrics.counters).length, 2);
    });

    it('uses same counter for same labels', () => {
      metrics.incCounter('requests_total', { provider: 'openai' });
      metrics.incCounter('requests_total', { provider: 'openai' });

      assert.equal(Object.keys(metrics.counters).length, 1);
      assert.equal(Object.values(metrics.counters)[0].value, 2);
    });
  });

  describe('setGauge', () => {
    it('sets a gauge value', () => {
      metrics.setGauge('active_keys', { provider: 'openai' }, 5);
      assert.equal(metrics.gauges['active_keys{provider="openai"}'].value, 5);
    });

    it('overwrites previous gauge value', () => {
      metrics.setGauge('active_keys', {}, 10);
      metrics.setGauge('active_keys', {}, 20);
      assert.equal(metrics.gauges['active_keys'].value, 20);
    });

    it('handles empty labels', () => {
      metrics.setGauge('uptime', {}, 42);
      assert.ok(metrics.gauges['uptime']);
    });
  });

  describe('observeHistogram', () => {
    it('creates a new histogram', () => {
      metrics.observeHistogram('response_time', { provider: 'openai' }, 100);
      const h = metrics.histograms['response_time{provider="openai"}'];
      assert.equal(h.count, 1);
      assert.equal(h.sum, 100);
      assert.deepEqual(h.values, [100]);
    });

    it('accumulates observations', () => {
      metrics.observeHistogram('response_time', {}, 100);
      metrics.observeHistogram('response_time', {}, 200);
      metrics.observeHistogram('response_time', {}, 300);

      const h = metrics.histograms['response_time'];
      assert.equal(h.count, 3);
      assert.equal(h.sum, 600);
      assert.deepEqual(h.values, [100, 200, 300]);
    });

    it('keeps only last 1000 observations', () => {
      for (let i = 0; i < 1100; i++) {
        metrics.observeHistogram('response_time', {}, i);
      }
      const h = metrics.histograms['response_time'];
      assert.equal(h.values.length, 1000);
      assert.equal(h.count, 1100);
      assert.equal(h.sum > 0, true);
    });
  });

  describe('_labelKey', () => {
    it('returns name only when no labels', () => {
      assert.equal(metrics._labelKey('test', {}), 'test');
    });

    it('returns name with sorted labels', () => {
      const key = metrics._labelKey('test', { b: '2', a: '1' });
      assert.equal(key, 'test{a="1",b="2"}');
    });
  });

  describe('_escapeLabelValue', () => {
    it('escapes backslashes', () => {
      assert.equal(metrics._escapeLabelValue('a\\b'), 'a\\\\b');
    });

    it('escapes double quotes', () => {
      assert.equal(metrics._escapeLabelValue('a"b'), 'a\\"b');
    });

    it('escapes newlines', () => {
      assert.equal(metrics._escapeLabelValue('a\nb'), 'a\\nb');
    });

    it('converts non-strings to strings', () => {
      assert.equal(metrics._escapeLabelValue(42), '42');
    });
  });

  describe('render', () => {
    it('renders counter in Prometheus format', () => {
      metrics.incCounter('requests_total', { provider: 'openai' });
      const output = metrics.render();

      assert.ok(output.includes('# HELP requests_total KeyProxy requests_total'));
      assert.ok(output.includes('# TYPE requests_total counter'));
      assert.ok(output.includes('requests_total{provider="openai"} 1'));
    });

    it('renders gauge in Prometheus format', () => {
      metrics.setGauge('active_keys', { provider: 'openai' }, 5);
      const output = metrics.render();

      assert.ok(output.includes('# TYPE active_keys gauge'));
      assert.ok(output.includes('active_keys{provider="openai"} 5'));
    });

    it('renders histogram with sum, count, and quantiles', () => {
      for (let i = 1; i <= 100; i++) {
        metrics.observeHistogram('response_time', { provider: 'openai' }, i);
      }
      const output = metrics.render();

      assert.ok(output.includes('# TYPE response_time histogram'));
      assert.ok(output.includes('response_time_sum{provider="openai"}'));
      assert.ok(output.includes('response_time_count{provider="openai"} 100'));
      assert.ok(output.includes('quantile="0.5"'));
      assert.ok(output.includes('quantile="0.9"'));
      assert.ok(output.includes('quantile="0.99"'));
    });

    it('renders histogram without labels', () => {
      metrics.observeHistogram('latency', {}, 50);
      const output = metrics.render();

      assert.ok(output.includes('latency_sum 50'));
      assert.ok(output.includes('latency_count 1'));
      assert.ok(output.includes('latency{quantile="0.5"} 50'));
    });

    it('renders empty output when no metrics', () => {
      const output = metrics.render();
      assert.equal(output, '\n');
    });

    it('only emits HELP and TYPE once per metric name', () => {
      metrics.incCounter('requests_total', { provider: 'openai' });
      metrics.incCounter('requests_total', { provider: 'anthropic' });

      const output = metrics.render();
      const helpCount = (output.match(/# HELP requests_total/g) || []).length;
      const typeCount = (output.match(/# TYPE requests_total counter/g) || []).length;

      assert.equal(helpCount, 1);
      assert.equal(typeCount, 1);
    });
  });

  describe('reset', () => {
    it('clears all metrics', () => {
      metrics.incCounter('test');
      metrics.setGauge('gauge', {}, 5);
      metrics.observeHistogram('hist', {}, 10);

      metrics.reset();

      assert.deepEqual(metrics.counters, {});
      assert.deepEqual(metrics.gauges, {});
      assert.deepEqual(metrics.histograms, {});
    });
  });

  describe('cleanup', () => {
    it('removes stale histogram entries', () => {
      metrics.observeHistogram('stale_metric', {}, 10);
      // Manually set lastObserved to old time
      metrics.histograms['stale_metric'].lastObserved = Date.now() - 7200000; // 2 hours ago

      metrics.observeHistogram('fresh_metric', {}, 20);

      metrics.cleanup(3600000); // 1 hour threshold

      assert.ok(!metrics.histograms['stale_metric'], 'stale entry should be removed');
      assert.ok(metrics.histograms['fresh_metric'], 'fresh entry should remain');
    });

    it('keeps entries within threshold', () => {
      metrics.observeHistogram('fresh', {}, 10);
      metrics.cleanup(3600000);
      assert.ok(metrics.histograms['fresh']);
    });

    it('enforces hard cap of 500 entries', () => {
      for (let i = 0; i < 510; i++) {
        metrics.observeHistogram(`metric_${i}`, {}, i);
      }

      metrics.cleanup(0); // Don't remove based on staleness

      assert.ok(
        Object.keys(metrics.histograms).length <= 500,
        `Should have at most 500 entries, got ${Object.keys(metrics.histograms).length}`
      );
    });
  });
});
