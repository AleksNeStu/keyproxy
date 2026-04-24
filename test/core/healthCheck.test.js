const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const HealthMonitor = require('../../src/core/healthCheck');

function createMockServer(config = {}) {
  return {
    config: {
      providers: config.providers || new Map(),
      getProvider: config.getProvider || (() => null),
      envVars: config.envVars || {}
    },
    providerClients: config.providerClients || new Map(),
    logBuffer: config.logBuffer || [],
    historyManager: config.historyManager || null,
    notifier: config.notifier || null
  };
}

describe('HealthMonitor', () => {
  let monitor;
  let server;

  beforeEach(() => {
    server = createMockServer();
    monitor = new HealthMonitor(server);
  });

  describe('constructor', () => {
    it('initializes with default values', () => {
      assert.equal(monitor.intervalMs, 5 * 60 * 1000);
      assert.equal(monitor.timer, null);
      assert.equal(monitor.statusCache.size, 0);
      assert.equal(monitor.lastFullCheck, null);
      assert.equal(monitor.recoveryEnabled, true);
    });
  });

  describe('maskApiKey', () => {
    it('masks a key showing first 8 and last 4 chars', () => {
      const masked = monitor.maskApiKey('sk-1234567890abcdefghijklmnop');
      assert.equal(masked, 'sk-12345...mnop');
    });

    it('returns *** for short keys', () => {
      assert.equal(monitor.maskApiKey('short'), '***');
    });

    it('returns *** for null', () => {
      assert.equal(monitor.maskApiKey(null), '***');
    });

    it('returns *** for empty string', () => {
      assert.equal(monitor.maskApiKey(''), '***');
    });
  });

  describe('stop', () => {
    it('stops the interval timer', () => {
      monitor.timer = setInterval(() => {}, 10000);
      monitor.stop();
      assert.equal(monitor.timer, null);
    });

    it('handles stop when no timer', () => {
      assert.doesNotThrow(() => monitor.stop());
    });
  });

  describe('checkProvider', () => {
    it('returns null for non-existent provider', () => {
      const result = monitor.checkProvider('nonexistent');
      assert.equal(result, null);
    });

    it('returns status for disabled provider', () => {
      const providers = new Map();
      providers.set('disabled-prov', {
        apiType: 'openai',
        baseUrl: 'https://api.example.com',
        disabled: true,
        keys: ['key1'],
        allKeys: null
      });

      const server = createMockServer({
        providers,
        getProvider: (name) => providers.get(name)
      });
      const monitor = new HealthMonitor(server);

      const status = monitor.checkProvider('disabled-prov');
      assert.equal(status.status, 'disabled');
      assert.equal(status.disabled, true);
    });

    it('returns failed status for provider with no keys', () => {
      const providers = new Map();
      providers.set('no-keys', {
        apiType: 'openai',
        baseUrl: 'https://api.example.com',
        disabled: false,
        keys: [],
        allKeys: null
      });

      const server = createMockServer({
        providers,
        getProvider: (name) => providers.get(name)
      });
      const monitor = new HealthMonitor(server);

      const status = monitor.checkProvider('no-keys');
      assert.equal(status.status, 'failed');
      assert.equal(status.lastError, 'No enabled keys');
    });

    it('returns active status for healthy provider', () => {
      const providers = new Map();
      providers.set('healthy', {
        apiType: 'openai',
        baseUrl: 'https://api.example.com',
        disabled: false,
        keys: ['key1'],
        allKeys: null
      });

      const server = createMockServer({
        providers,
        getProvider: (name) => providers.get(name),
        providerClients: new Map()
      });
      const monitor = new HealthMonitor(server);

      const status = monitor.checkProvider('healthy');
      assert.equal(status.name, 'healthy');
      assert.equal(status.apiType, 'openai');
      assert.equal(status.totalKeys, 1);
      assert.equal(status.enabledKeys, 1);
    });

    it('aggregates from log buffer', () => {
      const providers = new Map();
      providers.set('prov', {
        apiType: 'openai',
        baseUrl: 'https://api.example.com',
        disabled: false,
        keys: ['key1'],
        allKeys: null
      });

      const logBuffer = [
        { provider: 'prov', responseTime: 100, statusCode: 200, timestamp: new Date().toISOString() },
        { provider: 'prov', responseTime: 200, statusCode: 500, timestamp: new Date().toISOString() }
      ];

      const server = createMockServer({
        providers,
        getProvider: (name) => providers.get(name),
        providerClients: new Map(),
        logBuffer
      });
      const monitor = new HealthMonitor(server);

      const status = monitor.checkProvider('prov');
      assert.equal(status.avgResponseTime, 150);
      assert.equal(status.failedRequests, 1);
    });
  });

  describe('getAllStatuses', () => {
    it('returns statuses for all providers', () => {
      const providers = new Map();
      providers.set('prov1', {
        apiType: 'openai',
        baseUrl: 'https://api.example.com',
        disabled: false,
        keys: ['key1'],
        allKeys: null
      });
      providers.set('prov2', {
        apiType: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        disabled: false,
        keys: ['key1'],
        allKeys: null
      });

      const server = createMockServer({
        providers,
        getProvider: (name) => providers.get(name),
        providerClients: new Map()
      });
      const monitor = new HealthMonitor(server);

      const statuses = monitor.getAllStatuses();
      assert.equal(statuses.length, 2);
    });
  });

  describe('getSummary', () => {
    it('returns summary with counts', () => {
      const providers = new Map();
      providers.set('active-prov', {
        apiType: 'openai',
        baseUrl: 'https://api.example.com',
        disabled: false,
        keys: ['key1'],
        allKeys: null
      });

      const server = createMockServer({
        providers,
        getProvider: (name) => providers.get(name),
        providerClients: new Map()
      });
      const monitor = new HealthMonitor(server);

      const summary = monitor.getSummary();
      assert.equal(summary.total, 1);
      assert.ok(typeof summary.active === 'number');
      assert.ok(typeof summary.degraded === 'number');
      assert.ok(typeof summary.failed === 'number');
      assert.ok(typeof summary.disabled === 'number');
    });
  });

  describe('getRecoveryStatus', () => {
    it('returns recovery config without history manager', () => {
      const status = monitor.getRecoveryStatus();
      assert.equal(status.recoveryEnabled, true);
      assert.ok(status.baseCooldownSec > 0);
      assert.ok(status.maxAttempts > 0);
      assert.deepEqual(status.keys, []);
    });
  });
});
