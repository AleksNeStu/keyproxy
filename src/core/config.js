const fs = require('fs');
const path = require('path');

class Config {
  constructor() {
    this.port = null;
    this.providers = new Map(); // Map of provider_name -> { apiType, keys, baseUrl }
    this.geminiApiKeys = [];
    this.openaiApiKeys = [];
    this.baseUrl = null;
    this.envVars = {}; // Stored merged configuration
    this.loadConfig();
  }

  getEffectiveEnvVars() {
    return { ...this.envVars };
  }

  loadConfig() {
    const localEnvPath = path.join(process.cwd(), '.env');
    console.log(`[CONFIG] Loading local configuration from ${localEnvPath}`);
    
    // 1. Load local env first
    let envVars = {};
    if (fs.existsSync(localEnvPath)) {
      const localEnvContent = fs.readFileSync(localEnvPath, 'utf8');
      envVars = { ...this.parseEnvFile(localEnvContent) };
    }

    // Determine rootEnvPath from local env or default
    const rootEnvPath = envVars.EXTERNAL_ENV_PATH 
      ? path.resolve(process.cwd(), envVars.EXTERNAL_ENV_PATH) 
      : path.resolve(process.cwd(), '../../.env');

    // 2. Load global env and merge (local takes priority for settings, but keys accumulate)
    if (fs.existsSync(rootEnvPath)) {
      console.log(`[CONFIG] Loading global configuration from ${rootEnvPath}`);
      const rootEnvContent = fs.readFileSync(rootEnvPath, 'utf8');
      const rootEnvVars = this.parseEnvFile(rootEnvContent);
      
      // Auto-discover keys from root and merge into envVars
      this.autoDiscoverGlobalKeys(rootEnvVars, envVars);
      
      // Merge other root vars if not defined locally
      for (const [key, value] of Object.entries(rootEnvVars)) {
        if (!envVars[key]) envVars[key] = value;
      }
    }

    if (Object.keys(envVars).length === 0) {
      console.error('\n❌ ERROR: No .env configuration found!');
      throw new Error('Configuration missing');
    }

    // Resolve port: .env takes priority, then process.env, then fail
    const port = envVars.PORT || process.env.PORT;
    const adminPassword = envVars.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

    const missingFields = [];
    if (!port) missingFields.push('PORT');
    if (!adminPassword) missingFields.push('ADMIN_PASSWORD');

    if (missingFields.length > 0) {
      console.error('\n❌ ERROR: Required fields missing!');
      console.error(`Missing fields: ${missingFields.join(', ')}`);
      throw new Error(`Required fields missing: ${missingFields.join(', ')}`);
    }

    // Set required fields
    this.port = parseInt(port);
    this.adminPassword = adminPassword;
    this.envVars = envVars; // Save for UI access

    console.log(`[CONFIG] Port: ${this.port}`);
    console.log(`[CONFIG] Admin panel enabled`);

    // Clear existing providers
    this.providers.clear();

    // Parse providers from accumulated envVars
    this.parseProviders(envVars);
    this.parseBackwardCompatibility(envVars);

    console.log(`[CONFIG] Found ${this.providers.size} providers configured`);

    // Log each provider
    for (const [providerName, config] of this.providers.entries()) {
      const maskedKeys = config.keys.map(key => this.maskApiKey(key));
      console.log(`[CONFIG] Provider '${providerName}' (${config.apiType}): ${config.keys.length} keys [${maskedKeys.join(', ')}] → ${config.baseUrl}`);
    }
  }

  /**
   * Automatically discovers and groups keys from root .env based on naming patterns
   */
  autoDiscoverGlobalKeys(rootVars, localVars) {
    // Known service defaults
    const knownDefaults = {
      gemini: { type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' },
      firecrawl: { type: 'openai', baseUrl: 'https://api.firecrawl.dev' },
      tavily: { type: 'openai', baseUrl: 'https://api.tavily.com' },
      tavily_mcp: { type: 'openai', baseUrl: 'https://mcp.tavily.com/mcp', keyPattern: 'TAVILY' },
      context7: { type: 'openai', baseUrl: 'https://context7.com/api' },
      onref: { type: 'openai', baseUrl: 'https://ref.tools/api' }
    };

    // Discovery container: { name: { type, keys: [], baseUrl } }
    const discovery = {};

    for (const [key, value] of Object.entries(rootVars)) {
      if (!value) continue;

      const upperKey = key.toUpperCase();
      let match;

      // 1. Generic indexed pattern: (OPENAI|GEMINI)_{NAME}_API_KEY_{N}
      if ((match = upperKey.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_API_KEY(?:_\d+)?$/))) {
        const type = match[1].toLowerCase();
        const name = match[2].toLowerCase();
        
        if (!discovery[name]) discovery[name] = { type, keys: [], baseUrl: null };
        discovery[name].keys.push(value);
      } 
      // 2. Legacy/Simple pattern: GEMINI_API_KEY_{N} -> maps to 'gemini' provider
      else if ((match = upperKey.match(/^GEMINI_API_KEY(?:_\d+)?$/))) {
        if (!discovery.gemini) discovery.gemini = { type: 'gemini', keys: [], baseUrl: knownDefaults.gemini.baseUrl };
        discovery.gemini.keys.push(value);
      }
      // 3. Known specific patterns (e.g. FIRECRAWL_API_KEY) - for backward compatibility with existing .env
      // Note: no break — one key can match multiple providers (e.g. TAVILY_API_KEY → both 'tavily' and 'tavily_mcp')
      else {
        for (const [knownName, config] of Object.entries(knownDefaults)) {
          const patternSource = config.keyPattern || knownName;
          const pattern = new RegExp(`^${patternSource.toUpperCase()}_API_KEY(?:_\\d+)?$`);
          if (pattern.test(upperKey)) {
            if (!discovery[knownName]) discovery[knownName] = { type: config.type, keys: [], baseUrl: config.baseUrl };
            discovery[knownName].keys.push(value);
          }
        }
      }
    }

    // Apply discovered keys to localVars context
    for (const [provider, data] of Object.entries(discovery)) {
      if (data.keys.length > 0) {
        // Find base URL: 1. Explicit override, 2. Pattern default, 3. Known default
        const baseUrlKey = `${data.type.toUpperCase()}_${provider.toUpperCase()}_BASE_URL`;
        let finalBaseUrl = rootVars[baseUrlKey] || data.baseUrl;
        
        // Final fallback to known defaults if name matches
        if (!finalBaseUrl && knownDefaults[provider]) {
          finalBaseUrl = knownDefaults[provider].baseUrl;
        }

        const envKey = `${data.type.toUpperCase()}_${provider.toUpperCase()}_API_KEYS`;
        const urlKey = `${data.type.toUpperCase()}_${provider.toUpperCase()}_BASE_URL`;
        
        const existing = (localVars[envKey] || '').split(',').map(k => k.trim()).filter(k => k);
        const merged = [...new Set([...existing, ...data.keys])].join(',');
        // Deduplicate keys within this provider too
        data.keys = [...new Set(data.keys)];
        
        localVars[envKey] = merged;
        if (finalBaseUrl) {
          localVars[urlKey] = finalBaseUrl;
        }
      }
    }
  }


  parseEnvFile(content) {
    const envVars = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '' || trimmedLine.startsWith('#')) {
        continue;
      }

      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        continue;
      }

      const key = trimmedLine.substring(0, equalIndex).trim();
      const value = trimmedLine.substring(equalIndex + 1).trim();
      
      envVars[key] = value;
    }

    return envVars;
  }

  parseApiKeys(keysString) {
    if (!keysString) {
      return [];
    }

    return keysString
      .split(',')
      .map(key => key.trim())
      .filter(key => key.length > 0);
  }

  /**
   * Parse API keys with disabled state. Keys prefixed with ~ are disabled.
   * Returns { allKeys: [{key, disabled}], enabledKeys: [key] }
   */
  parseApiKeysWithState(keysString) {
    if (!keysString) {
      return { allKeys: [], enabledKeys: [] };
    }

    const allKeys = [];
    const enabledKeys = [];

    keysString.split(',').forEach(raw => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;

      if (trimmed.startsWith('~')) {
        const key = trimmed.substring(1);
        if (key.length > 0) {
          allKeys.push({ key, disabled: true });
        }
      } else {
        allKeys.push({ key: trimmed, disabled: false });
        enabledKeys.push(trimmed);
      }
    });

    return { allKeys, enabledKeys };
  }

  parseProviders(envVars) {
    // Parse {API_TYPE}_{PROVIDER}_API_KEYS, {API_TYPE}_{PROVIDER}_BASE_URL, and {API_TYPE}_{PROVIDER}_ACCESS_KEY format
    const providerConfigs = new Map();

    const defaultConfig = () => ({ apiType: null, keys: [], allKeys: [], baseUrl: null, accessKey: null, defaultModel: null, disabled: false });

    for (const [key, value] of Object.entries(envVars)) {
      if (key.endsWith('_API_KEYS') && value) {
        const parts = key.replace('_API_KEYS', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          // Parse keys with disabled state (~ prefix)
          const { allKeys, enabledKeys } = this.parseApiKeysWithState(value);
          providerConfigs.get(provider).keys = enabledKeys;
          providerConfigs.get(provider).allKeys = allKeys;
          providerConfigs.get(provider).apiType = apiType;
        }
      } else if (key.endsWith('_BASE_URL') && value) {
        const parts = key.replace('_BASE_URL', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).baseUrl = value.trim();
        }
      } else if (key.endsWith('_ACCESS_KEY') && value) {
        const parts = key.replace('_ACCESS_KEY', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).accessKey = value.trim();
        }
      } else if (key.endsWith('_DEFAULT_MODEL') && value) {
        const parts = key.replace('_DEFAULT_MODEL', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).defaultModel = value.trim();
        }
      } else if (key.endsWith('_DISABLED') && value) {
        const parts = key.replace('_DISABLED', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).disabled = (value.trim().toLowerCase() === 'true');
        }
      }
    }

    // Add valid providers to the main providers map
    for (const [provider, config] of providerConfigs.entries()) {
      if (config.allKeys.length > 0) {
        // Set default base URLs if not specified
        if (!config.baseUrl) {
          if (config.apiType === 'openai') {
            config.baseUrl = 'https://api.openai.com/v1';
          } else if (config.apiType === 'gemini') {
            config.baseUrl = 'https://generativelanguage.googleapis.com/v1';
          }
        }

        this.providers.set(provider, config);
      }
    }
  }

  parseBackwardCompatibility(envVars) {
    // Maintain backward compatibility with old format
    this.geminiApiKeys = this.parseApiKeys(envVars.GEMINI_API_KEYS);
    this.openaiApiKeys = this.parseApiKeys(envVars.OPENAI_API_KEYS);
    this.baseUrl = (envVars.BASE_URL && envVars.BASE_URL.trim()) ? envVars.BASE_URL.trim() : null;

    // If old format is used, create default providers
    if (this.openaiApiKeys.length > 0) {
      const baseUrl = this.baseUrl || 'https://api.openai.com/v1';
      this.providers.set('openai', {
        apiType: 'openai',
        keys: this.openaiApiKeys,
        baseUrl: baseUrl
      });
    }

    if (this.geminiApiKeys.length > 0) {
      const baseUrl = 'https://generativelanguage.googleapis.com/v1';
      this.providers.set('gemini', {
        apiType: 'gemini',
        keys: this.geminiApiKeys,
        baseUrl: baseUrl
      });
    }
  }

  getPort() {
    return this.port;
  }

  getGeminiApiKeys() {
    return [...this.geminiApiKeys];
  }

  getOpenaiApiKeys() {
    return [...this.openaiApiKeys];
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getGeminiBaseUrl() {
    return this.baseUrl || 'https://generativelanguage.googleapis.com';
  }

  getOpenaiBaseUrl() {
    return this.baseUrl || 'https://api.openai.com';
  }

  hasGeminiKeys() {
    return this.geminiApiKeys.length > 0;
  }

  hasOpenaiKeys() {
    return this.openaiApiKeys.length > 0;
  }

  getAdminPassword() {
    return this.adminPassword;
  }

  hasAdminPassword() {
    return this.adminPassword && this.adminPassword.length > 0;
  }

  maskApiKey(key) {
    if (!key || key.length < 8) return '***';
    return key.substring(0, 4) + '...' + key.substring(key.length - 4);
  }

  // New provider methods
  getProviders() {
    return this.providers;
  }

  getProvider(providerName) {
    return this.providers.get(providerName);
  }

  hasProvider(providerName) {
    return this.providers.has(providerName);
  }

  // Destination sync configuration
  getDestinationConfig() {
    return {
      fileSync: this.envVars.KEYPROXY_SYNC_FILE !== 'false',
      filePath: this.envVars.KEYPROXY_SYNC_FILE_PATH || '.active_keys.env',
      systemEnv: this.envVars.KEYPROXY_SYNC_SYSTEM === 'true',
    };
  }

  // Retry configuration
  getRetryConfig(providerName) {
    const defaults = { maxRetries: 3, retryDelayMs: 1000, retryBackoff: 2 };
    const global = {
      maxRetries: parseInt(this.envVars.KEYPROXY_MAX_RETRIES) || defaults.maxRetries,
      retryDelayMs: parseInt(this.envVars.KEYPROXY_RETRY_DELAY_MS) || defaults.retryDelayMs,
      retryBackoff: parseFloat(this.envVars.KEYPROXY_RETRY_BACKOFF) || defaults.retryBackoff,
    };

    if (!providerName) return global;

    // Per-provider override: {TYPE}_{PROVIDER}_MAX_RETRIES etc.
    const prov = this.providers.get(providerName);
    if (!prov) return global;

    const prefix = `${prov.apiType.toUpperCase()}_${providerName.toUpperCase()}`;
    const perProvider = {};
    if (this.envVars[`${prefix}_MAX_RETRIES`]) perProvider.maxRetries = parseInt(this.envVars[`${prefix}_MAX_RETRIES`]);
    if (this.envVars[`${prefix}_RETRY_DELAY_MS`]) perProvider.retryDelayMs = parseInt(this.envVars[`${prefix}_RETRY_DELAY_MS`]);
    if (this.envVars[`${prefix}_RETRY_BACKOFF`]) perProvider.retryBackoff = parseFloat(this.envVars[`${prefix}_RETRY_BACKOFF`]);

    return { ...global, ...perProvider };
  }

  getProvidersByApiType(apiType) {
    const result = new Map();
    for (const [name, config] of this.providers.entries()) {
      if (config.apiType === apiType) {
        result.set(name, config);
      }
    }
    return result;
  }

  // Backward compatibility - these methods now aggregate across all providers
  getAllGeminiKeys() {
    const keys = [];
    for (const [, config] of this.providers.entries()) {
      if (config.apiType === 'gemini') {
        keys.push(...config.keys);
      }
    }
    return keys;
  }

  getAllOpenaiKeys() {
    const keys = [];
    for (const [, config] of this.providers.entries()) {
      if (config.apiType === 'openai') {
        keys.push(...config.keys);
      }
    }
    return keys;
  }
}

module.exports = Config;
