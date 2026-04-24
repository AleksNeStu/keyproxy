const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AnalyticsTracker = require('../../src/core/analytics');

describe('AnalyticsTracker', () => {
  let tempDir;
  let analyticsFile;
  let tracker;

  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analytics-test-'));
    analyticsFile = path.join(tempDir, 'analytics.json');
  });

  afterEach(() => {
    // Clean up temp directory
    if (tracker) {
      tracker.flushSync();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor & initialization', () => {
    it('uses default file path when none provided', () => {
      const defaultTracker = new AnalyticsTracker(null);
      assert.ok(defaultTracker.filePath.includes('analytics.json'));
    });

    it('uses custom file path when provided', () => {
      tracker = new AnalyticsTracker(analyticsFile);
      assert.strictEqual(tracker.filePath, analyticsFile);
    });

    it('initializes with empty data structure', () => {
      tracker = new AnalyticsTracker(analyticsFile);
      assert.deepStrictEqual(tracker.data, { days: {} });
    });

    it('loads existing data from file', () => {
      // Create existing analytics file
      const existingData = {
        days: {
          '2026-04-20': {
            totalRequests: 100,
            totalErrors: 5,
            totalLatencyMs: 50000,
            providers: {}
          }
        }
      };
      fs.writeFileSync(analyticsFile, JSON.stringify(existingData, null, 2));

      tracker = new AnalyticsTracker(analyticsFile);
      assert.strictEqual(tracker.data.days['2026-04-20'].totalRequests, 100);
    });

    it('handles corrupt data file gracefully', () => {
      // Write invalid JSON
      fs.writeFileSync(analyticsFile, 'invalid json {{{');

      tracker = new AnalyticsTracker(analyticsFile);
      assert.deepStrictEqual(tracker.data, { days: {} });
    });
  });

  describe('request recording', () => {
    beforeEach(() => {
      tracker = new AnalyticsTracker(analyticsFile);
    });

    it('records basic request data', () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 150,
        requestBody: { model: 'gpt-4', messages: [{ role: 'user', content: 'test' }] },
        responseBody: { choices: [{ message: { content: 'response' } }] },
        apiKey: 'sk-test123',
        apiType: 'OPENAI'
      });

      const today = new Date().toISOString().slice(0, 10);
      assert.ok(tracker.data.days[today]);
      assert.strictEqual(tracker.data.days[today].totalRequests, 1);
      assert.strictEqual(tracker.data.days[today].providers.openai.requests, 1);
    });

    it('tracks errors separately from successful requests', () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 429,
        latencyMs: 100,
        requestBody: {},
        responseBody: {},
        apiKey: 'sk-test',
        apiType: 'OPENAI'
      });

      const today = new Date().toISOString().slice(0, 10);
      assert.strictEqual(tracker.data.days[today].totalErrors, 1);
      assert.strictEqual(tracker.data.days[today].providers.openai.errors, 1);
    });

    it('assigns latency to correct bucket', () => {
      const testCases = [
        { latency: 50, bucket: '<100' },
        { latency: 150, bucket: '100-250' },
        { latency: 300, bucket: '250-500' },
        { latency: 750, bucket: '500-1000' },
        { latency: 2000, bucket: '1000-3000' },
        { latency: 5000, bucket: '3000-10000' },
        { latency: 15000, bucket: '>10000' }
      ];

      testCases.forEach(({ latency, bucket }) => {
        tracker.recordRequest({
          provider: 'openai',
          statusCode: 200,
          latencyMs: latency,
          requestBody: {},
          responseBody: {},
          apiKey: 'sk-test',
          apiType: 'OPENAI'
        });
      });

      const today = new Date().toISOString().slice(0, 10);
      const buckets = tracker.data.days[today].providers.openai.latencyBuckets;

      testCases.forEach(({ bucket }) => {
        assert.strictEqual(buckets[bucket], 1, `Bucket ${bucket} should have 1 request`);
      });
    });

    it('tracks per-key statistics with masked keys', () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 100,
        requestBody: {},
        responseBody: {},
        apiKey: 'sk-abc123xyz789',
        apiType: 'OPENAI'
      });

      const today = new Date().toISOString().slice(0, 10);
      const keys = tracker.data.days[today].providers.openai.keys;
      assert.ok(Object.keys(keys).length > 0);
      const maskedKey = Object.keys(keys)[0];
      assert.ok(maskedKey.includes('...'));
      assert.strictEqual(keys[maskedKey].requests, 1);
    });

    it('tracks per-model statistics', () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 100,
        requestBody: { model: 'gpt-4-turbo', messages: [] },
        responseBody: {},
        apiKey: 'sk-test',
        apiType: 'OPENAI'
      });

      const today = new Date().toISOString().slice(0, 10);
      const models = tracker.data.days[today].providers.openai.models;
      assert.ok(models['gpt-4-turbo']);
      assert.strictEqual(models['gpt-4-turbo'].requests, 1);
    });

    it('accumulates multiple requests for same provider', () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordRequest({
          provider: 'openai',
          statusCode: 200,
          latencyMs: 100,
          requestBody: {},
          responseBody: {},
          apiKey: 'sk-test',
          apiType: 'OPENAI'
        });
      }

      const today = new Date().toISOString().slice(0, 10);
      assert.strictEqual(tracker.data.days[today].providers.openai.requests, 5);
    });
  });

  describe('data persistence', () => {
    beforeEach(() => {
      tracker = new AnalyticsTracker(analyticsFile);
    });

    it('schedules debounced save on recordRequest', async () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 100,
        requestBody: {},
        responseBody: {},
        apiKey: 'sk-test',
        apiType: 'OPENAI'
      });

      // File should not exist immediately (debounced)
      assert.ok(!fs.existsSync(analyticsFile) || fs.readFileSync(analyticsFile, 'utf8') === '{}');

      // Use flushSync for immediate persistence
      tracker.flushSync();

      assert.ok(fs.existsSync(analyticsFile));
    });

    it('persists data to file on flushSync', () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 100,
        requestBody: {},
        responseBody: {},
        apiKey: 'sk-test',
        apiType: 'OPENAI'
      });

      tracker.flushSync();

      const savedData = JSON.parse(fs.readFileSync(analyticsFile, 'utf8'));
      assert.ok(savedData.days);
    });

    it('handles write errors gracefully', () => {
      // Use an invalid path
      const invalidTracker = new AnalyticsTracker('/invalid/path/analytics.json');

      assert.doesNotThrow(() => {
        invalidTracker.recordRequest({
          provider: 'openai',
          statusCode: 200,
          latencyMs: 100,
          requestBody: {},
          responseBody: {},
          apiKey: 'sk-test',
          apiType: 'OPENAI'
        });
        invalidTracker.flushSync();
      });
    });

    it('creates directory if it does not exist', () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'analytics.json');
      const nestedTracker = new AnalyticsTracker(nestedPath);

      nestedTracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 100,
        requestBody: {},
        responseBody: {},
        apiKey: 'sk-test',
        apiType: 'OPENAI'
      });

      nestedTracker.flushSync();

      assert.ok(fs.existsSync(nestedPath));
    });
  });

  describe('query & aggregation', () => {
    beforeEach(() => {
      tracker = new AnalyticsTracker(analyticsFile);

      // Record some test data across multiple days
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const formatDate = (date) => date.toISOString().slice(0, 10);

      // Manually inject data for different days
      tracker.data.days = {
        [formatDate(today)]: {
          totalRequests: 100,
          totalErrors: 5,
          totalLatencyMs: 15000,
          providers: {
            openai: {
              requests: 60,
              errors: 3,
              latencyMs: 9000,
              estimatedInputTokens: 10000,
              estimatedOutputTokens: 5000,
              estimatedCost: 0.15,
              keys: {},
              models: {},
              latencyBuckets: { '<100': 20, '100-250': 30, '250-500': 10 }
            },
            gemini: {
              requests: 40,
              errors: 2,
              latencyMs: 6000,
              estimatedInputTokens: 8000,
              estimatedOutputTokens: 4000,
              estimatedCost: 0.06,
              keys: {},
              models: {},
              latencyBuckets: { '<100': 15, '100-250': 25 }
            }
          }
        },
        [formatDate(yesterday)]: {
          totalRequests: 80,
          totalErrors: 2,
          totalLatencyMs: 12000,
          providers: {
            openai: {
              requests: 50,
              errors: 1,
              latencyMs: 7500,
              estimatedInputTokens: 8000,
              estimatedOutputTokens: 4000,
              estimatedCost: 0.12,
              keys: {},
              models: {},
              latencyBuckets: {}
            },
            gemini: {
              requests: 30,
              errors: 1,
              latencyMs: 4500,
              estimatedInputTokens: 6000,
              estimatedOutputTokens: 3000,
              estimatedCost: 0.045,
              keys: {},
              models: {},
              latencyBuckets: {}
            }
          }
        }
      };
    });

    it('returns summary for 7d range', () => {
      const result = tracker.query('7d');

      assert.strictEqual(result.totalRequests, 180);
      assert.strictEqual(result.totalErrors, 7);
      assert.strictEqual(result.totalCost, 0.375);
    });

    it('filters data by date range', () => {
      const result7d = tracker.query('7d');
      const resultAll = tracker.query('all');

      assert.strictEqual(result7d.totalRequests, 180);
      assert.strictEqual(resultAll.totalRequests, 180);
    });

    it('calculates average latency', () => {
      const result = tracker.query('7d');

      // (15000 + 12000) / 180 = 150ms
      assert.strictEqual(result.avgLatencyMs, 150);
    });

    it('aggregates provider statistics', () => {
      const result = tracker.query('7d');

      assert.ok(result.providers.openai);
      assert.strictEqual(result.providers.openai.requests, 110);
      assert.strictEqual(result.providers.gemini.requests, 70);
    });

    it('provides daily breakdown', () => {
      const result = tracker.query('7d');

      assert.ok(Array.isArray(result.dailyRequests));
      assert.strictEqual(result.dailyRequests.length, 2);
      assert.ok(result.dailyRequests.some(d => d.count === 100));
      assert.ok(result.dailyRequests.some(d => d.count === 80));
    });

    it('aggregates latency buckets', () => {
      const result = tracker.query('7d');

      assert.strictEqual(result.latencyBuckets['<100'], 35);
      assert.strictEqual(result.latencyBuckets['100-250'], 55);
    });

    it('returns empty summary for no data', () => {
      const emptyTracker = new AnalyticsTracker(analyticsFile);
      const result = emptyTracker.query('7d');

      assert.strictEqual(result.totalRequests, 0);
      assert.strictEqual(result.totalErrors, 0);
      assert.strictEqual(result.avgLatencyMs, 0);
    });
  });

  describe('percentile estimation', () => {
    beforeEach(() => {
      tracker = new AnalyticsTracker(analyticsFile);
    });

    it('estimates p50 latency from buckets', () => {
      // Create data where p50 should be around 150ms
      // Distribution: 30 in <100, 40 in 100-250, 30 in 250-500
      // p50 (50th request) falls in the 100-250 bucket
      tracker.data.days = {
        '2026-04-20': {
          totalRequests: 100,
          totalErrors: 0,
          totalLatencyMs: 15000,
          providers: {
            openai: {
              requests: 100,
              errors: 0,
              latencyMs: 15000,
              estimatedInputTokens: 0,
              estimatedOutputTokens: 0,
              estimatedCost: 0,
              keys: {},
              models: {},
              latencyBuckets: { '<100': 30, '100-250': 40, '250-500': 30 }
            }
          }
        }
      };

      const result = tracker.query('all');
      // p50 at 50th percentile: 50th request falls in 100-250 bucket
      assert.ok(result.p50LatencyMs >= 100);
      assert.ok(result.p50LatencyMs <= 250);
    });

    it('estimates p95 latency from buckets', () => {
      // Distribution: 20, 30, 40, 10
      // Cumulative: 20, 50, 90, 100
      // p95 (95th request) falls in 500-1000 bucket
      tracker.data.days = {
        '2026-04-20': {
          totalRequests: 100,
          totalErrors: 0,
          totalLatencyMs: 20000,
          providers: {
            openai: {
              requests: 100,
              errors: 0,
              latencyMs: 20000,
              estimatedInputTokens: 0,
              estimatedOutputTokens: 0,
              estimatedCost: 0,
              keys: {},
              models: {},
              latencyBuckets: { '<100': 20, '100-250': 30, '250-500': 40, '500-1000': 10 }
            }
          }
        }
      };

      const result = tracker.query('all');
      // p95 at 95th percentile: 95th request falls in 500-1000 bucket
      assert.ok(result.p95LatencyMs >= 500);
      assert.ok(result.p95LatencyMs <= 1000);
    });

    it('returns 0 for empty buckets', () => {
      const result = tracker.query('all');

      assert.strictEqual(result.p50LatencyMs, 0);
      assert.strictEqual(result.p95LatencyMs, 0);
      assert.strictEqual(result.p99LatencyMs, 0);
    });

    it('handles single bucket case', () => {
      tracker.data.days = {
        '2026-04-20': {
          totalRequests: 50,
          totalErrors: 0,
          totalLatencyMs: 5000,
          providers: {
            openai: {
              requests: 50,
              errors: 0,
              latencyMs: 5000,
              estimatedInputTokens: 0,
              estimatedOutputTokens: 0,
              estimatedCost: 0,
              keys: {},
              models: {},
              latencyBuckets: { '100-250': 50 }
            }
          }
        }
      };

      const result = tracker.query('all');
      assert.ok(result.p50LatencyMs > 0);
    });
  });

  describe('data management', () => {
    beforeEach(() => {
      tracker = new AnalyticsTracker(analyticsFile);

      // Create old data
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      tracker.data.days = {
        [oldDate.toISOString().slice(0, 10)]: {
          totalRequests: 100,
          totalErrors: 5,
          totalLatencyMs: 15000,
          providers: {}
        },
        [new Date().toISOString().slice(0, 10)]: {
          totalRequests: 50,
          totalErrors: 2,
          totalLatencyMs: 7500,
          providers: {}
        }
      };
    });

    it('purges data older than specified days', () => {
      const purgedCount = tracker.purge(90);

      assert.strictEqual(purgedCount, 1);
      assert.strictEqual(Object.keys(tracker.data.days).length, 1);
    });

    it('uses 90 day default when not specified', () => {
      tracker.purge();

      assert.strictEqual(Object.keys(tracker.data.days).length, 1);
    });

    it('returns 0 when no data to purge', () => {
      const freshTracker = new AnalyticsTracker(analyticsFile);
      const purged = freshTracker.purge(90);

      assert.strictEqual(purged, 0);
    });

    it('resets all data', () => {
      tracker.reset();

      assert.deepStrictEqual(tracker.data, { days: {} });
      assert.strictEqual(Object.keys(tracker.data.days).length, 0);
    });
  });

  describe('edge cases and error handling', () => {
    beforeEach(() => {
      tracker = new AnalyticsTracker(analyticsFile);
    });

    it('handles request with missing fields gracefully', () => {
      assert.doesNotThrow(() => {
        tracker.recordRequest({
          provider: 'openai',
          statusCode: 200,
          latencyMs: 100,
          requestBody: null,
          responseBody: null,
          apiKey: null,
          apiType: 'OPENAI'
        });
      });
    });

    it('handles request without api key', () => {
      tracker.recordRequest({
        provider: 'openai',
        statusCode: 200,
        latencyMs: 100,
        requestBody: {},
        responseBody: {},
        apiKey: null,
        apiType: 'OPENAI'
      });

      const today = new Date().toISOString().slice(0, 10);
      assert.strictEqual(tracker.data.days[today].totalRequests, 1);
    });

    it('handles query with invalid range', () => {
      tracker.data.days = {
        '2026-04-20': {
          totalRequests: 10,
          totalErrors: 0,
          totalLatencyMs: 1000,
          providers: {}
        }
      };

      // Invalid range should default to 'all'
      const result = tracker.query('invalid');
      assert.strictEqual(result.totalRequests, 10);
    });
  });
});
