/**
 * Admin model management route handlers.
 * Fetch available models from provider APIs, save allowed model lists.
 */

const fs = require('fs');
const path = require('path');
const { sendError } = require('./httpHelpers');

const modelCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const unsupportedModelsEndpoints = ['firecrawl.dev', 'context7.com', 'ref.tools', 'tavily.com'];

/**
 * GET /admin/api/models — fetch available models from a provider API.
 * Query: ?apiType=openai&provider=openai&baseUrl=...
 */
async function handleFetchModels(server, req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const apiType = url.searchParams.get('apiType');
    const providerName = url.searchParams.get('provider');
    const overrideBaseUrl = url.searchParams.get('baseUrl');
    const noCache = url.searchParams.get('nocache') === 'true';

    if (!apiType || !providerName) {
      sendError(res, 400, 'Missing apiType or provider');
      return;
    }

    const provider = server.config.getProvider(providerName);
    if (!provider) {
      sendError(res, 404, `Provider '${providerName}' not found`);
      return;
    }

    const baseUrl = overrideBaseUrl || provider.baseUrl;

    if (!baseUrl) {
      sendError(res, 400, 'No base URL configured for provider');
      return;
    }

    if (unsupportedModelsEndpoints.some(d => baseUrl.includes(d))) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [], cached: false, message: 'This provider does not support a /models endpoint' }));
      return;
    }

    const cacheKey = `${apiType}:${providerName}`;
    if (!noCache && modelCache.has(cacheKey)) {
      const cached = modelCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models: cached.models, cached: true, cachedAt: cached.timestamp }));
        return;
      }
    }

    let models = [];
    let apiModels = [];

    if (apiType === 'openai') {
      apiModels = await fetchOpenaiModels(server, provider, baseUrl);
    } else if (apiType === 'gemini') {
      apiModels = await fetchGeminiModels(server, provider, baseUrl);
    }

    models = apiModels.map(m => ({
      id: m.id,
      name: m.id,
      ...(m.owned_by && { owner: m.owned_by }),
      ...(m.display_name && { display_name: m.display_name })
    }));

    models.sort((a, b) => a.name.localeCompare(b.name));

    modelCache.set(cacheKey, { models, timestamp: Date.now() });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models, cached: false }));
  } catch (error) {
    sendError(res, 500, 'Failed to fetch models: ' + error.message);
  }
}

async function fetchOpenaiModels(server, provider, baseUrl) {
  const firstKey = provider.keys[0];
  if (!firstKey) throw new Error('No API key available for provider');

  const fullUrl = `${baseUrl.replace(/\/+$/, '')}/models`;

  const response = await fetch(fullUrl, {
    headers: { 'Authorization': `Bearer ${firstKey}` },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data || [];
}

async function fetchGeminiModels(server, provider, baseUrl) {
  const firstKey = provider.keys[0];
  if (!firstKey) throw new Error('No API key available for provider');

  let fullUrl;
  if (baseUrl.includes('/v1') || baseUrl.includes('/v1beta')) {
    fullUrl = `${baseUrl.replace(/\/+$/, '')}/models?key=${firstKey}`;
  } else {
    fullUrl = `${baseUrl.replace(/\/+$/, '')}/v1/models?key=${firstKey}`;
  }

  const response = await fetch(fullUrl, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  const rawModels = data.models || [];

  return rawModels
    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
    .map(m => ({
      id: m.name.replace('models/', ''),
      display_name: m.displayName || m.name.replace('models/', '')
    }));
}

/**
 * POST /admin/api/models — save allowed models for a provider.
 * Body: { apiType, providerName, allowedModels: string[] }
 */
async function handleSaveModels(server, req, res, body) {
  try {
    const { apiType, providerName, allowedModels } = JSON.parse(body);
    if (!apiType || !providerName) {
      sendError(res, 400, 'Missing apiType or providerName');
      return;
    }

    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ALLOWED_MODELS`;

    if (allowedModels && allowedModels.length > 0) {
      envVars[envKey] = allowedModels.join(',');
    } else {
      delete envVars[envKey];
    }

    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();

    // Clear cache so next fetch gets fresh data
    const cacheKey = `${apiType}:${providerName}`;
    modelCache.delete(cacheKey);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, allowedModels: allowedModels || [] }));
  } catch (error) {
    sendError(res, 500, 'Failed to save models: ' + error.message);
  }
}

module.exports = {
  handleFetchModels,
  handleSaveModels
};
