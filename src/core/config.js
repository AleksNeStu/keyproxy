const fs = require('fs');
const path = require('path');
const { maskApiKey } = require('./utils');

class Config {
  constructor(options = {}) {
    this.port = null;
    this.providers = new Map(); // Map of provider_name -> { apiType, keys, baseUrl }
    this.geminiApiKeys = [];
    this.openaiApiKeys = [];
    this.baseUrl = null;
    this.envVars = {}; // Stored merged configuration
    this.keySourceMap = {}; // Maps 'providerName:keyValue' → env var name
    this.keyVault = options.keyVault || null; // Set via constructor or setKeyVault()
    this.loadConfig();
  }

  /** Attach KeyVault as alternative data source. */
  setKeyVault(vault) {
    this.keyVault = vault;
  }

  getEffectiveEnvVars() {
    return { ...this.envVars };
  }

  loadConfig() {
    const localEnvPath = path.join(process.cwd(), '.env');
    console.log(`[CONFIG] Loading local configuration from ${localEnvPath}`);

    // 1. Load local env first (app settings: PORT, ADMIN_PASSWORD, etc.)
    let envVars = {};
    if (fs.existsSync(localEnvPath)) {
      const localEnvContent = fs.readFileSync(localEnvPath, 'utf8');
      envVars = { ...this.parseEnvFile(localEnvContent) };
    }

    // 2. Load rotation key files (all enabled files, later overrides earlier)
    this.loadRotationKeyFiles(envVars);

    if (Object.keys(envVars).length === 0) {
      console.error('\n❌ ERROR: No .env configuration found!');
      throw new Error('Configuration missing');
    }

    // Resolve port: .env takes priority, then process.env, then fail
    const port = envVars.PORT || process.env.PORT;

    const missingFields = [];
    if (!port) missingFields.push('PORT');

    if (missingFields.length > 0) {
      console.error('\n❌ ERROR: Required fields missing!');
      console.error(`Missing fields: ${missingFields.join(', ')}`);
      throw new Error(`Required fields missing: ${missingFields.join(', ')}`);
    }

    // Set required fields
    this.port = parseInt(port);
    this.envVars = envVars; // Save for UI access

    console.log(`[CONFIG] Port: ${this.port}`);
    console.log(`[CONFIG] Admin panel enabled`);

    // Clear existing providers
    this.providers.clear();
    this.keySourceMap = {};

    // Load providers from vault if available, otherwise from env vars
    if (this.keyVault && !this.keyVault.needsMigration()) {
      this.loadProvidersFromVault();
    } else {
      this.parseProviders(envVars);
      this.parseBackwardCompatibility(envVars);
    }

    console.log(`[CONFIG] Found ${this.providers.size} providers configured`);

    // Log each provider
    for (const [providerName, config] of this.providers.entries()) {
      const maskedKeys = config.keys.map(key => maskApiKey(key));
      console.log(`[CONFIG] Provider '${providerName}' (${config.apiType}): ${config.keys.length} keys [${maskedKeys.join(', ')}] → ${config.baseUrl}`);
    }
  }

  /**
   * Automatically discovers and groups keys from root .env based on naming patterns
   */
  autoDiscoverGlobalKeys(rootVars, localVars) {
    // Known service defaults (also accessible via this.knownDefaults)
    const knownDefaults = this.knownDefaults = {
      // AI Model Providers
      gemini: { type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', category: 'ai' },
      groq: { type: 'openai', baseUrl: 'https://api.groq.com/openai/v1', authHeader: 'Authorization', authPrefix: 'Bearer', category: 'ai' },
      mistral: { type: 'openai', baseUrl: 'https://api.mistral.ai/v1', authHeader: 'Authorization', authPrefix: 'Bearer', category: 'ai' },
      zhipuai: { type: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyPattern: '(ZHIPUAI|GLM)', category: 'ai' },
      siliconflow: { type: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', category: 'ai' },
      // MCP / Search / Content Providers
      // freezeOnStatusCodes: permanent key disable (credits that don't refresh)
      // 401 on other providers just triggers rotation (try next key)
      brave: { type: 'openai', baseUrl: 'https://api.search.brave.com', authHeader: 'X-Subscription-Token', authPrefix: '', category: 'mcp' },
      exa: { type: 'openai', baseUrl: 'https://api.exa.ai', authHeader: 'x-api-key', authPrefix: '', category: 'mcp', freezeOnStatusCodes: new Set([402]) },
      jina: { type: 'openai', baseUrl: 'https://api.jina.ai', authHeader: 'Authorization', authPrefix: 'Bearer', category: 'mcp', freezeOnStatusCodes: new Set([401]) },
      firecrawl: { type: 'openai', baseUrl: 'https://api.firecrawl.dev', authHeader: 'Authorization', authPrefix: 'Bearer', category: 'mcp', freezeOnStatusCodes: new Set([401]) },
      context7: { type: 'openai', baseUrl: 'https://context7.com/api', authHeader: 'Authorization', authPrefix: 'Bearer', category: 'mcp' },
      onref: { type: 'openai', baseUrl: 'https://api.ref.tools', keyPattern: 'REF', authHeader: 'x-ref-api-key', authPrefix: '', category: 'mcp' },
      tavily: { type: 'openai', baseUrl: 'https://api.tavily.com', keyPattern: 'TAVILY', authHeader: 'Authorization', authPrefix: 'Bearer', category: 'mcp' },
      searchapi: { type: 'openai', baseUrl: 'https://www.searchapi.io/api/v1', category: 'mcp' },
    };

    // Discovery container: { name: { type, keys: [], baseUrl } }
    const discovery = {};

    for (const [key, value] of Object.entries(rootVars)) {
      if (!value) continue;

      const upperKey = key.toUpperCase();
      let match;

      // 1. Generic indexed pattern: (OPENAI|GEMINI)_{NAME}_API_KEY_{N}
      if ((match = upperKey.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_API_KEY(?:_[A-Z0-9]+)?$/))) {
        const type = match[1].toLowerCase();
        const name = match[2].toLowerCase();

        if (!discovery[name]) discovery[name] = { type, keys: [], baseUrl: null, sources: {} };
        discovery[name].keys.push(value);
        discovery[name].sources[value] = key;
      }
      // 2. Legacy/Simple pattern: GEMINI_API_KEY_{N} -> maps to 'gemini' provider
      else if ((match = upperKey.match(/^GEMINI_API_KEY(?:_\d+)?$/))) {
        if (!discovery.gemini) discovery.gemini = { type: 'gemini', keys: [], baseUrl: knownDefaults.gemini.baseUrl, sources: {} };
        discovery.gemini.keys.push(value);
        discovery.gemini.sources[value] = key;
      }
      // 3. Known specific patterns (e.g. FIRECRAWL_API_KEY) - for backward compatibility with existing .env
      // Note: no break — one key can match multiple providers (e.g. TAVILY_API_KEY → both 'tavily' and 'tavily_mcp')
      else {
        for (const [knownName, config] of Object.entries(knownDefaults)) {
          const patternSource = config.keyPattern || knownName;
          const pattern = new RegExp(`^${patternSource.toUpperCase()}_API_KEY(?:_[A-Z0-9]+)?$`);
          if (pattern.test(upperKey)) {
            if (!discovery[knownName]) discovery[knownName] = { type: config.type, keys: [], baseUrl: config.baseUrl, sources: {}, authHeader: config.authHeader, authPrefix: config.authPrefix };
            discovery[knownName].keys.push(value);
            discovery[knownName].sources[value] = key;
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

        // Record source env var name for each key
        if (data.sources) {
          for (const [keyValue, sourceName] of Object.entries(data.sources)) {
            this.keySourceMap[`${provider}:${keyValue}`] = sourceName;
          }
        }

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

    const defaultConfig = () => ({ apiType: null, keys: [], allKeys: [], baseUrl: null, accessKey: null, defaultModel: null, allowedModels: [], disabled: false, authHeader: null, authPrefix: null });

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

          // Record source env var name for each key
          for (const keyObj of allKeys) {
            this.keySourceMap[`${provider}:${keyObj.key}`] = key;
          }
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
      } else if (key.endsWith('_SYNC_ENV') && value) {
        const parts = key.replace('_SYNC_ENV', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).syncEnv = (value.trim().toLowerCase() === 'true');
        }
      } else if (key.endsWith('_ALLOWED_MODELS') && value) {
        const parts = key.replace('_ALLOWED_MODELS', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();

          if (!providerConfigs.has(provider)) {
            providerConfigs.set(provider, defaultConfig());
          }

          providerConfigs.get(provider).allowedModels = value.split(',').map(s => s.trim()).filter(Boolean);
        }
      } else if (key.endsWith('_AUTH_HEADER') && value) {
        const parts = key.replace('_AUTH_HEADER', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();
          if (!providerConfigs.has(provider)) providerConfigs.set(provider, defaultConfig());
          providerConfigs.get(provider).authHeader = value.trim();
        }
      } else if (key.endsWith('_AUTH_PREFIX') && value !== undefined) {
        const parts = key.replace('_AUTH_PREFIX', '').split('_');
        if (parts.length >= 1) {
          const apiType = parts[0].toLowerCase();
          const provider = parts.length === 1 ? apiType : parts.slice(1).join('_').toLowerCase();
          if (!providerConfigs.has(provider)) providerConfigs.set(provider, defaultConfig());
          providerConfigs.get(provider).authPrefix = value.trim();
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

        // Apply authHeader/authPrefix from knownDefaults if not explicitly set
        const known = this.knownDefaults?.[provider];
        if (!config.authHeader && known?.authHeader) {
          config.authHeader = known.authHeader;
        }
        if (config.authPrefix === null && known?.authPrefix !== undefined) {
          config.authPrefix = known.authPrefix;
        }
        if (known?.freezeOnStatusCodes && !config.freezeOnStatusCodes) {
          config.freezeOnStatusCodes = known.freezeOnStatusCodes;
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

  /**
   * Load providers and keys from KeyVault instead of env parsing.
   * Produces the same data structure as parseProviders() for compatibility.
   */
  loadProvidersFromVault() {
    const vaultProviders = this.keyVault.getProviders();
    for (const [name, provConfig] of Object.entries(vaultProviders)) {
      const keyData = this.keyVault.getKeysForConfig(name);
      if (keyData.enabledKeys.length === 0) continue;

      const provider = {
        apiType: provConfig.apiType || 'openai',
        keys: keyData.enabledKeys,
        allKeys: keyData.allKeys,
        baseUrl: provConfig.baseUrl || '',
        accessKey: provConfig.accessKey || null,
        defaultModel: provConfig.defaultModel || null,
        allowedModels: provConfig.allowedModels || [],
        disabled: provConfig.disabled || false,
        syncEnv: provConfig.syncEnv || false,
        authHeader: provConfig.authHeader || null,
        authPrefix: provConfig.authPrefix !== undefined ? provConfig.authPrefix : null,
      };

      // Restore freezeOnStatusCodes as Set
      if (provConfig.freezeOnStatusCodes && provConfig.freezeOnStatusCodes.length > 0) {
        provider.freezeOnStatusCodes = new Set(provConfig.freezeOnStatusCodes);
      }

      this.providers.set(name, provider);
    }
    console.log(`[CONFIG] Loaded ${this.providers.size} providers from vault`);
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

  hasAdminPassword() {
    const Auth = require('./auth');
    const envPassword = this.envVars.ADMIN_PASSWORD;
    return !!(envPassword || Auth.loadHashFromFile());
  }

  isGlobalSyncEnabled() {
    return this.envVars.SYNC_TO_OS_ENV?.toLowerCase() === 'true';
  }

  isProviderSyncEnabled(providerName) {
    if (this.isProviderSyncExcluded(providerName)) return false;
    const provider = this.providers.get(providerName);
    if (!provider) return false;
    const syncEnvVar = `${provider.apiType.toUpperCase()}_${providerName.toUpperCase()}_SYNC_ENV`;
    const perProvider = this.envVars[syncEnvVar]?.toLowerCase();
    if (perProvider === 'false') return false;
    if (perProvider === 'true') return true;
    return this.isGlobalSyncEnabled();
  }

  isProviderSyncExcluded(providerName) {
    const exclusive = this.getSyncExclusiveProviders();
    return exclusive.includes(providerName.toLowerCase());
  }

  getSyncExclusiveProviders() {
    const raw = this.envVars.SYNC_EXCLUSIVE_PROVIDERS || '';
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  setSyncExclusiveProviders(names) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);
    vars.SYNC_EXCLUSIVE_PROVIDERS = names.join(',');
    this.writeLocalEnv(vars);
    this.loadConfig();
  }

  /**
   * Load ALL enabled rotation key files (ENV_FILES) and merge into envVars.
   * Files later in the list override earlier ones.
   * Local .env is NOT overwritten — it stays the authority for app settings.
   */
  loadRotationKeyFiles(envVars) {
    if (!envVars.ENV_FILES) {
      // Legacy fallback: single EXTERNAL_ENV_PATH or ../../.env
      const legacyPath = envVars.EXTERNAL_ENV_PATH
        ? path.resolve(process.cwd(), envVars.EXTERNAL_ENV_PATH)
        : path.resolve(process.cwd(), '../../.env');

      if (legacyPath && fs.existsSync(legacyPath)) {
        console.log(`[CONFIG] Loading legacy key file: ${legacyPath}`);
        const content = fs.readFileSync(legacyPath, 'utf8');
        const fileVars = this.parseEnvFile(content);
        this.autoDiscoverGlobalKeys(fileVars, envVars);
        for (const [key, value] of Object.entries(fileVars)) {
          if (!envVars[key]) envVars[key] = value;
        }
      }
      return;
    }

    const disabledList = this.parseEnvFilesDisabled(envVars.ENV_FILES_DISABLED);
    const envFiles = this.parseEnvFiles(envVars.ENV_FILES);
    const enabledEntries = Object.entries(envFiles).filter(([name]) => !disabledList.includes(name));

    if (enabledEntries.length === 0) {
      console.log('[CONFIG] No rotation key files enabled');
      return;
    }

    console.log(`[CONFIG] Loading ${enabledEntries.length} rotation key file(s)...`);

    for (const [name, filePath] of enabledEntries) {
      const resolvedPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(resolvedPath)) {
        console.warn(`[CONFIG] Key file "${name}" not found: ${resolvedPath}`);
        continue;
      }

      console.log(`[CONFIG] Loading key file "${name}": ${resolvedPath}`);
      const content = fs.readFileSync(resolvedPath, 'utf8');
      const fileVars = this.parseEnvFile(content);

      // Auto-discover keys from file and merge (later files override)
      this.autoDiscoverGlobalKeys(fileVars, envVars);

      // Merge non-key settings if not already defined
      for (const [key, value] of Object.entries(fileVars)) {
        envVars[key] = value;
      }
    }

    console.log(`[CONFIG] Loaded ${enabledEntries.length} rotation key file(s)`);
  }

  // New provider methods
  getKeySource(providerName, keyValue) {
    return this.keySourceMap[`${providerName}:${keyValue}`] || null;
  }

  getKeySourceMap() {
    return { ...this.keySourceMap };
  }

  getProviders() {
    return this.providers;
  }

  getProvider(providerName) {
    return this.providers.get(providerName);
  }

  hasProvider(providerName) {
    return this.providers.has(providerName);
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

  // Multi-env support
  resolveGlobalEnvPath(localEnvVars) {
    // Check for multi-env: ENV_FILES + ACTIVE_ENV
    if (localEnvVars.ENV_FILES) {
      const disabledList = this.parseEnvFilesDisabled(localEnvVars.ENV_FILES_DISABLED);
      const envFiles = this.parseEnvFiles(localEnvVars.ENV_FILES);
      let activeEnv = localEnvVars.ACTIVE_ENV || Object.keys(envFiles)[0];

      // If active is disabled, find first enabled file
      if (disabledList.includes(activeEnv)) {
        const enabledFiles = Object.keys(envFiles).filter(n => !disabledList.includes(n));
        if (enabledFiles.length > 0) {
          activeEnv = enabledFiles[0];
          console.log(`[CONFIG] Active env '${localEnvVars.ACTIVE_ENV}' is disabled, switching to '${activeEnv}'`);
        } else {
          console.warn(`[CONFIG] All env files are disabled, using local .env only`);
          return null;
        }
      }

      if (envFiles[activeEnv]) {
        return path.resolve(process.cwd(), envFiles[activeEnv]);
      }
    }
    // Fallback to legacy EXTERNAL_ENV_PATH
    if (localEnvVars.EXTERNAL_ENV_PATH) {
      return path.resolve(process.cwd(), localEnvVars.EXTERNAL_ENV_PATH);
    }
    return path.resolve(process.cwd(), '../../.env');
  }

  parseEnvFiles(envFilesStr) {
    const result = {};
    if (!envFilesStr) return result;
    envFilesStr.split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx > 0) {
        const name = entry.substring(0, colonIdx).trim();
        const filePath = entry.substring(colonIdx + 1).trim();
        if (name && filePath) result[name] = filePath;
      }
    });
    return result;
  }

  getEnvFiles() {
    const localEnvPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(localEnvPath)) return { files: [], disabled: [] };
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);
    const files = this.parseEnvFiles(vars.ENV_FILES);
    const disabledList = this.parseEnvFilesDisabled(vars.ENV_FILES_DISABLED);

    const fileArray = Object.entries(files).map(([name, filePath], index) => ({
      name,
      path: filePath,
      priority: index + 1,
      disabled: disabledList.includes(name)
    }));

    return {
      files: fileArray,
      enabledCount: fileArray.filter(f => !f.disabled).length,
      disabled: disabledList
    };
  }

  parseEnvFilesDisabled(disabledStr) {
    if (!disabledStr) return [];
    return disabledStr.split(',').map(s => s.trim()).filter(Boolean);
  }

  setActiveEnv(name) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);
    const files = this.parseEnvFiles(vars.ENV_FILES);

    if (!files[name]) {
      throw new Error(`Unknown env: ${name}`);
    }

    vars.ACTIVE_ENV = name;
    this.writeLocalEnv(vars);
    this.loadConfig();
  }

  addEnvFile(name, filePath) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);

    const files = this.parseEnvFiles(vars.ENV_FILES);
    files[name] = filePath;

    vars.ENV_FILES = Object.entries(files).map(([n, p]) => `${n}:${p}`).join(',');
    this.writeLocalEnv(vars);
  }

  removeEnvFile(name) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);

    const files = this.parseEnvFiles(vars.ENV_FILES);
    if (!files[name]) return;

    delete files[name];
    vars.ENV_FILES = Object.entries(files).map(([n, p]) => `${n}:${p}`).join(',');

    if (vars.ACTIVE_ENV === name) {
      const remaining = Object.keys(files);
      vars.ACTIVE_ENV = remaining.length > 0 ? remaining[0] : '';
    }

    this.writeLocalEnv(vars);
  }

  reorderEnvFiles(names) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);
    const files = this.parseEnvFiles(vars.ENV_FILES);

    const reordered = {};
    for (const name of names) {
      if (files[name]) reordered[name] = files[name];
    }
    for (const [name, p] of Object.entries(files)) {
      if (!reordered[name]) reordered[name] = p;
    }

    vars.ENV_FILES = Object.entries(reordered).map(([n, p]) => `${n}:${p}`).join(',');
    this.writeLocalEnv(vars);
  }

  toggleEnvFileDisabled(name) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const content = fs.readFileSync(localEnvPath, 'utf8');
    const vars = this.parseEnvFile(content);
    const disabledList = this.parseEnvFilesDisabled(vars.ENV_FILES_DISABLED);

    const index = disabledList.indexOf(name);
    if (index > -1) {
      disabledList.splice(index, 1); // Enable
    } else {
      disabledList.push(name); // Disable
    }

    vars.ENV_FILES_DISABLED = disabledList.join(',');
    this.writeLocalEnv(vars);
  }

  writeLocalEnv(vars) {
    const localEnvPath = path.join(process.cwd(), '.env');
    const lines = [];
    const addedKeys = new Set();

    // Read existing file to preserve comments and order
    if (fs.existsSync(localEnvPath)) {
      const content = fs.readFileSync(localEnvPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
          lines.push(line);
          continue;
        }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) {
          lines.push(line);
          continue;
        }
        const key = trimmed.substring(0, eqIdx).trim();
        if (vars.hasOwnProperty(key)) {
          lines.push(`${key}=${vars[key]}`);
          addedKeys.add(key);
        }
      }
    }

    // Add new keys not in original file
    for (const [key, value] of Object.entries(vars)) {
      if (!addedKeys.has(key)) {
        lines.push(`${key}=${value}`);
      }
    }

    fs.writeFileSync(localEnvPath, lines.join('\n'), 'utf8');
  }
}

module.exports = Config;
