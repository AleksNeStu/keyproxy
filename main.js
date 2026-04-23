const Config = require('./src/core/config');
const Auth = require('./src/core/auth');
const KeyRotator = require('./src/core/keyRotator');
const GeminiClient = require('./src/providers/gemini');
const OpenAIClient = require('./src/providers/openai');
const ProxyServer = require('./src/server');

function main() {
  try {
    const config = new Config();

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
    destMgr.setExclusionManager(exclusionManager);

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
    server.start();

    process.on('SIGINT', () => {
      console.log('\nShutting down server...');
      server.stop();
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
