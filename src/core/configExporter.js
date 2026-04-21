const fs = require('fs');
const path = require('path');

/**
 * ConfigExporter - Import/export KeyProxy configuration for backup and migration.
 */
class ConfigExporter {
  constructor(config, envFilePath) {
    this.config = config;
    this.envFilePath = envFilePath || path.join(process.cwd(), '.env');
  }

  /**
   * Export all configuration as a JSON object.
   * @param {boolean} includeSecrets - Whether to include actual API keys
   */
  exportConfig(includeSecrets = false) {
    const providers = this.config.getProviders();
    const providersData = {};

    for (const [name, prov] of providers.entries()) {
      providersData[name] = {
        apiType: prov.apiType,
        baseUrl: prov.baseUrl,
        disabled: prov.disabled || false,
        keys: includeSecrets
          ? (prov.allKeys ? prov.allKeys.map(k => k.key) : prov.keys)
          : (prov.allKeys ? prov.allKeys.length : prov.keys.length)
      };
    }

    const envVars = { ...this.config.envVars };

    // Always redact sensitive values unless includeSecrets
    if (!includeSecrets) {
      const sensitiveKeys = ['ADMIN_PASSWORD', 'SLACK_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN',
        ...Object.keys(envVars).filter(k => k.endsWith('_KEY'))];
      for (const key of sensitiveKeys) {
        if (envVars[key]) envVars[key] = '***REDACTED***';
      }
    }

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      includeSecrets,
      config: {
        port: this.config.getPort(),
        envVars,
        providers: providersData
      }
    };
  }

  /**
   * Import configuration from JSON data.
   * @param {object} importData - The imported config data
   * @param {'merge'|'replace'} mode - How to apply the import
   */
  importConfig(importData, mode = 'merge') {
    if (!importData || !importData.config) {
      throw new Error('Invalid import data: missing config');
    }
    if (importData.version !== 1) {
      throw new Error('Unsupported import version: ' + importData.version);
    }

    const { config } = importData;

    if (mode === 'replace') {
      // Clear existing provider data and replace entirely
      this._writeEnv(config.envVars || {});
    } else {
      // Merge: read current env, overlay imported values
      const currentEnv = this._readEnv();
      const merged = { ...currentEnv, ...(config.envVars || {}) };
      this._writeEnv(merged);
    }

    return { success: true, mode, providersImported: Object.keys(config.providers || {}).length };
  }

  _readEnv() {
    const envVars = {};
    try {
      if (fs.existsSync(this.envFilePath)) {
        const content = fs.readFileSync(this.envFilePath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.substring(0, eqIdx).trim();
            const val = trimmed.substring(eqIdx + 1).trim();
            envVars[key] = val;
          }
        }
      }
    } catch {}
    return envVars;
  }

  _writeEnv(envVars) {
    const lines = [];
    for (const [key, value] of Object.entries(envVars)) {
      if (value.includes(' ') || value.includes('#')) {
        lines.push(`${key}="${value}"`);
      } else {
        lines.push(`${key}=${value}`);
      }
    }
    fs.writeFileSync(this.envFilePath, lines.join('\n') + '\n');
  }
}

module.exports = ConfigExporter;
