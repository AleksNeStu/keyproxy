// Global timestamp prefix for all console output
function tsPrefix() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const origLog = console.log;
console.log = (...args) => {
  const t = tsPrefix();
  if (typeof args[0] === 'string') {
    origLog(`${t} ${args[0]}`, ...args.slice(1));
  } else {
    origLog(t, ...args);
  }
};
const origErr = console.error;
console.error = (...args) => {
  const t = tsPrefix();
  if (typeof args[0] === 'string') {
    origErr(`${t} ${args[0]}`, ...args.slice(1));
  } else {
    origErr(t, ...args);
  }
};

const Config = require('./src/core/config');
const Auth = require('./src/core/auth');
const KeyRotator = require('./src/core/keyRotator');
const GeminiClient = require('./src/providers/gemini');
const OpenAIClient = require('./src/providers/openai');
const ProxyServer = require('./src/server');
const KeyVault = require('./src/core/keyVault');
const SettingsManager = require('./src/core/settingsManager');

function main() {
  try {
    // Create SettingsManager before Config — it's the settings data source
    const settingsManager = new SettingsManager();

    // First-time migration: if settings.json doesn't exist, migrate from .env
    if (settingsManager.needsMigration()) {
      console.log('[INIT] Settings file not found, running first-time migration from .env...');
      const localEnvPath = require('path').join(process.cwd(), '.env');
      const fs = require('fs');
      let envVars = {};
      if (fs.existsSync(localEnvPath)) {
        const Config = require('./src/core/config');
        envVars = Config.prototype.parseEnvFile ? {} : {};
        // Parse .env manually for migration
        const content = fs.readFileSync(localEnvPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          envVars[key] = val;
        }
      }
      settingsManager.runMigrationFromEnv(envVars);
    }

    // Create KeyVault before Config — it's the key data source
    const vault = new KeyVault();

    // First-time migration: if vault is empty, do a preliminary Config load from env,
    // migrate to vault, then let Config read from vault.
    if (vault.needsMigration()) {
      console.log('[INIT] Vault is empty, running first-time migration from .env files...');
      const tempConfig = new Config(); // Load from env for migration source
      const knownDefaults = tempConfig.knownDefaults || {};
      vault.runMigration(tempConfig, knownDefaults);
    }

    const config = new Config({ keyVault: vault, settingsManager });
    // Config constructor already called loadConfig(), which reads from vault

    // Migrate admin password from .env to hash file if needed
    const envPassword = config.envVars.ADMIN_PASSWORD;
    if (envPassword && !Auth.loadHashFromFile()) {
      Auth.migrateFromEnv(envPassword);
      Auth.removePasswordFromEnv(require('path').join(process.cwd(), '.env'));
      console.log('[INIT] Admin password migrated from .env to secure hash file');
    }

    // Initialize Destination Manager
    const destMgr = require('./src/destinations/manager');
    if (process.platform === 'win32') {
      const WindowsEnv = require('./src/destinations/windowsEnv');
      destMgr.register(WindowsEnv);
    }

    console.log(`[INIT] Destination Manager initialized with ${destMgr.destinations.length} targets`);

    // Initialize Key Exclusion Manager
    const KeyExclusionManager = require('./src/core/exclusions');
    const exclusionManager = new KeyExclusionManager();

    // Initialize Environment Source Manager (legacy, kept for migration only)
    // Import sources are now managed by KeyVault

    // Initialize legacy clients for backward compatibility
    let geminiClient = null;
    let openaiClient = null;

    if (config.hasGeminiKeys()) {
      const geminiKeyRotator = new KeyRotator(config.getGeminiApiKeys(), 'gemini');
      geminiClient = new GeminiClient(geminiKeyRotator, config.getGeminiBaseUrl());
      console.log('[INIT] Legacy Gemini client initialized');
    } else if (config.hasAdminPassword()) {
      console.log('[INIT] No legacy Gemini keys found - can be configured via admin panel');
    }

    if (config.hasOpenaiKeys()) {
      const openaiKeyRotator = new KeyRotator(config.getOpenaiApiKeys(), 'openai');
      openaiClient = new OpenAIClient(openaiKeyRotator, config.getOpenaiBaseUrl());
      console.log('[INIT] Legacy OpenAI client initialized');
    } else if (config.hasAdminPassword()) {
      console.log('[INIT] No legacy OpenAI keys found - can be configured via admin panel');
    }

    const server = new ProxyServer(config, geminiClient, openaiClient);
    server.exclusionManager = exclusionManager;
    server.keyVault = vault;
    server.settingsManager = settingsManager;
    server.start();

    process.on('SIGINT', () => {
      console.log('\nShutting down server...');
      server.stop();
      vault.flushSync();
      settingsManager.flushSync();
      process.exit(0);
    });

  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

const TelegramBot = require('./src/core/telegramBot');
module.exports = { Config, KeyRotator, GeminiClient, OpenAIClient, ProxyServer, TelegramBot };
