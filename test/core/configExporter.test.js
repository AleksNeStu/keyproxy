const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const ConfigExporter = require('../../src/core/configExporter');

function createMockConfig(providers = {}, envVars = {}) {
  const providerMap = new Map();
  for (const [name, config] of Object.entries(providers)) {
    providerMap.set(name, {
      apiType: config.apiType || 'openai',
      baseUrl: config.baseUrl || 'https://api.example.com',
      disabled: config.disabled || false,
      keys: config.keys || ['key1'],
      allKeys: config.allKeys || null,
      ...config
    });
  }

  return {
    getProviders: () => providerMap,
    getPort: () => 3000,
    envVars
  };
}

describe('ConfigExporter', () => {
  let tempDir;
  let tempEnvFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-export-test-'));
    tempEnvFile = path.join(tempDir, '.env');
  });

  afterEach(() => {
    try {
      if (fs.existsSync(tempEnvFile)) fs.unlinkSync(tempEnvFile);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    } catch {}
  });

  describe('constructor', () => {
    it('uses provided env file path', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);
      assert.equal(exporter.envFilePath, tempEnvFile);
    });
  });

  describe('exportConfig', () => {
    it('exports configuration without secrets', () => {
      const config = createMockConfig(
        { openai: { apiType: 'openai', baseUrl: 'https://api.openai.com', keys: ['sk-123'] } },
        { ADMIN_PASSWORD: 'secret123', SOME_KEY: 'apikey', SAFE_VAR: 'value' }
      );
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.exportConfig(false);

      assert.equal(result.version, 1);
      assert.ok(result.exportedAt);
      assert.equal(result.includeSecrets, false);
      assert.equal(result.config.port, 3000);
      assert.equal(result.config.envVars.ADMIN_PASSWORD, '***REDACTED***');
      assert.equal(result.config.envVars.SOME_KEY, '***REDACTED***');
      assert.equal(result.config.envVars.SAFE_VAR, 'value');
    });

    it('exports provider info without secrets', () => {
      const config = createMockConfig(
        { openai: { apiType: 'openai', baseUrl: 'https://api.openai.com', keys: ['sk-1', 'sk-2'] } }
      );
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.exportConfig(false);

      assert.ok(result.config.providers.openai);
      assert.equal(result.config.providers.openai.apiType, 'openai');
      assert.equal(result.config.providers.openai.keys, 2); // count only
    });

    it('exports with secrets when includeSecrets is true', () => {
      const config = createMockConfig(
        { openai: { apiType: 'openai', baseUrl: 'https://api.openai.com', keys: ['sk-123'] } },
        { ADMIN_PASSWORD: 'secret123' }
      );
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.exportConfig(true);

      assert.equal(result.includeSecrets, true);
      assert.equal(result.config.envVars.ADMIN_PASSWORD, 'secret123');
      assert.deepEqual(result.config.providers.openai.keys, ['sk-123']);
    });

    it('exports allKeys when present', () => {
      const config = createMockConfig(
        { openai: { allKeys: [{ key: 'sk-1' }, { key: 'sk-2' }], keys: ['sk-1'] } }
      );
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.exportConfig(false);
      assert.equal(result.config.providers.openai.keys, 2); // allKeys length
    });

    it('redacts SLACK_WEBHOOK_URL and TELEGRAM_BOT_TOKEN', () => {
      const config = createMockConfig(
        {},
        { SLACK_WEBHOOK_URL: 'https://hooks.slack.com/xxx', TELEGRAM_BOT_TOKEN: '123456:ABC' }
      );
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.exportConfig(false);
      assert.equal(result.config.envVars.SLACK_WEBHOOK_URL, '***REDACTED***');
      assert.equal(result.config.envVars.TELEGRAM_BOT_TOKEN, '***REDACTED***');
    });

    it('includes disabled flag for providers', () => {
      const config = createMockConfig(
        { openai: { disabled: true, keys: ['sk-1'] } }
      );
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.exportConfig(false);
      assert.equal(result.config.providers.openai.disabled, true);
    });
  });

  describe('importConfig', () => {
    it('rejects invalid import data', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      assert.throws(() => exporter.importConfig(null), /missing config/);
      assert.throws(() => exporter.importConfig({}), /missing config/);
      assert.throws(() => exporter.importConfig({ config: {} }), /Unsupported import version/);
    });

    it('rejects unsupported version', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      assert.throws(() => exporter.importConfig({ version: 99, config: {} }), /Unsupported import version/);
    });

    it('imports in merge mode', () => {
      // Write existing env
      fs.writeFileSync(tempEnvFile, 'EXISTING_VAR=old_value\n');

      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.importConfig({
        version: 1,
        config: {
          envVars: { NEW_VAR: 'new_value' },
          providers: { openai: { apiType: 'openai' } }
        }
      }, 'merge');

      assert.equal(result.success, true);
      assert.equal(result.mode, 'merge');
      assert.equal(result.providersImported, 1);

      // Check file has both old and new
      const content = fs.readFileSync(tempEnvFile, 'utf8');
      assert.ok(content.includes('EXISTING_VAR=old_value'));
      assert.ok(content.includes('NEW_VAR=new_value'));
    });

    it('imports in replace mode', () => {
      fs.writeFileSync(tempEnvFile, 'OLD_VAR=will_be_replaced\n');

      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      exporter.importConfig({
        version: 1,
        config: {
          envVars: { NEW_VAR: 'replaced' },
          providers: {}
        }
      }, 'replace');

      const content = fs.readFileSync(tempEnvFile, 'utf8');
      assert.ok(!content.includes('OLD_VAR'));
      assert.ok(content.includes('NEW_VAR=replaced'));
    });

    it('handles missing envVars in import data', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.importConfig({
        version: 1,
        config: { providers: {} }
      });

      assert.equal(result.success, true);
    });

    it('handles missing providers in import data', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      const result = exporter.importConfig({
        version: 1,
        config: { envVars: {} }
      });

      assert.equal(result.providersImported, 0);
    });
  });

  describe('_readEnv', () => {
    it('reads env vars from file', () => {
      fs.writeFileSync(tempEnvFile, 'KEY1=value1\nKEY2=value2\n');

      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      const env = exporter._readEnv();
      assert.equal(env.KEY1, 'value1');
      assert.equal(env.KEY2, 'value2');
    });

    it('skips comments and empty lines', () => {
      fs.writeFileSync(tempEnvFile, '# comment\n\nKEY1=value1\n  \n');

      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      const env = exporter._readEnv();
      assert.equal(Object.keys(env).length, 1);
      assert.equal(env.KEY1, 'value1');
    });

    it('returns empty object for missing file', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, path.join(tempDir, 'nonexistent'));

      const env = exporter._readEnv();
      assert.deepEqual(env, {});
    });

    it('handles values with equals signs', () => {
      fs.writeFileSync(tempEnvFile, 'KEY=value=with=equals\n');

      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      const env = exporter._readEnv();
      assert.equal(env.KEY, 'value=with=equals');
    });
  });

  describe('_writeEnv', () => {
    it('writes env vars to file', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      exporter._writeEnv({ KEY1: 'value1', KEY2: 'value2' });

      const content = fs.readFileSync(tempEnvFile, 'utf8');
      assert.ok(content.includes('KEY1=value1'));
      assert.ok(content.includes('KEY2=value2'));
    });

    it('quotes values with spaces', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      exporter._writeEnv({ KEY: 'value with spaces' });

      const content = fs.readFileSync(tempEnvFile, 'utf8');
      assert.ok(content.includes('KEY="value with spaces"'));
    });

    it('quotes values with hash', () => {
      const config = createMockConfig();
      const exporter = new ConfigExporter(config, tempEnvFile);

      exporter._writeEnv({ KEY: 'value#hash' });

      const content = fs.readFileSync(tempEnvFile, 'utf8');
      assert.ok(content.includes('KEY="value#hash"'));
    });
  });
});
