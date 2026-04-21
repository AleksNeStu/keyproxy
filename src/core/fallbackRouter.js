/**
 * FallbackRouter - Cross-provider failover for KeyProxy.
 *
 * When a provider's keys are all exhausted (429), automatically retries
 * the request on a configured fallback provider.
 *
 * Config via env: {TYPE}_{PROVIDER}_FALLBACK=fallback_name
 * Optional: {TYPE}_{PROVIDER}_FALLBACK_MODEL=model_id
 *
 * Example: OPENAI_GROQ_FALLBACK=openai_claude
 * Max fallback depth: 2 (to avoid infinite chains).
 */
class FallbackRouter {
  constructor(config) {
    this.config = config;
    this.maxDepth = 2;
    this.fallbackCache = new Map();
    this._parseChains();
  }

  _parseChains() {
    const envVars = this.config.envVars;
    const providers = this.config.getProviders();

    for (const [providerName] of providers.entries()) {
      const provider = this.config.getProvider(providerName);
      if (!provider) continue;

      const apiType = provider.apiType.toUpperCase();
      const provUpper = providerName.toUpperCase().replace(/-/g, '_');

      const fallbackKey = `${apiType}_${provUpper}_FALLBACK`;
      const fallbackModelKey = `${apiType}_${provUpper}_FALLBACK_MODEL`;

      const fallbackProvider = envVars[fallbackKey];
      const fallbackModel = envVars[fallbackModelKey];

      if (fallbackProvider) {
        this.fallbackCache.set(providerName, {
          provider: fallbackProvider,
          model: fallbackModel || null
        });
        console.log(`[FALLBACK] ${providerName} → ${fallbackProvider}${fallbackModel ? ' (model: ' + fallbackModel + ')' : ''}`);
      }
    }
  }

  /**
   * Get the fallback chain for a provider.
   * Returns array of { provider, model } or empty if none.
   */
  getChain(providerName) {
    const chain = [];
    let current = providerName;
    let depth = 0;

    while (depth < this.maxDepth) {
      const fb = this.fallbackCache.get(current);
      if (!fb) break;
      chain.push(fb);
      current = fb.provider;
      depth++;
    }

    return chain;
  }

  /**
   * Check if a provider has a fallback configured.
   */
  hasFallback(providerName) {
    return this.fallbackCache.has(providerName);
  }

  /**
   * Get direct fallback for a provider.
   */
  getFallback(providerName) {
    return this.fallbackCache.get(providerName) || null;
  }

  /**
   * Modify request body to use fallback model if configured.
   */
  prepareBody(originalBody, fallbackConfig) {
    if (!fallbackConfig.model || !originalBody) return originalBody;

    try {
      const parsed = typeof originalBody === 'string' ? JSON.parse(originalBody) : originalBody;
      if (parsed.model) {
        parsed.model = fallbackConfig.model;
      }
      return JSON.stringify(parsed);
    } catch {
      return originalBody;
    }
  }

  /**
   * Get all configured fallback chains (for admin UI).
   */
  getAllChains() {
    const result = {};
    for (const [from, to] of this.fallbackCache.entries()) {
      result[from] = to;
    }
    return result;
  }

  /**
   * Set or update a fallback chain at runtime.
   */
  setFallback(providerName, fallbackProvider, fallbackModel = null) {
    if (fallbackProvider) {
      this.fallbackCache.set(providerName, { provider: fallbackProvider, model: fallbackModel });
    } else {
      this.fallbackCache.delete(providerName);
    }
  }
}

module.exports = FallbackRouter;
