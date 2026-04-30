const { URL } = require('url');
const BaseProvider = require('./BaseProvider');

class OpenAIClient extends BaseProvider {
  constructor(keyRotator, baseUrl = 'https://api.openai.com', providerName = 'openai', retryConfig = null, timeoutMs = 60000, budgetTracker = null, providerConfig = null) {
    super(keyRotator, baseUrl, providerName, retryConfig, timeoutMs, budgetTracker, providerConfig);
    this.authHeader = providerConfig?.authHeader || 'Authorization';
    this.authPrefix = providerConfig?.authPrefix !== undefined && providerConfig?.authPrefix !== null ? providerConfig.authPrefix : 'Bearer';
  }

  _buildRequestOptions(method, requestPath, body, headers, apiKey) {
    const baseUrl = this._baseUrlOverride || this.baseUrl;
    let fullUrl;
    if (!requestPath || requestPath === '/') {
      fullUrl = baseUrl;
    } else if (requestPath.startsWith('/')) {
      fullUrl = baseUrl.endsWith('/') ? baseUrl + requestPath.substring(1) : baseUrl + requestPath;
    } else {
      fullUrl = baseUrl.endsWith('/') ? baseUrl + request : baseUrl + '/' + requestPath;
    }

    // Support for query-parameter authentication (e.g. for Tavily MCP or other custom proxies)
    if (fullUrl.includes('KeyProxy')) {
      fullUrl = fullUrl.replace(/KeyProxy/g, apiKey);
    }

    const url = new URL(fullUrl);

    const finalHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    // Only add auth if not using query-param auth (KeyProxy placeholder)
    if (!fullUrl.includes(apiKey) || !url.searchParams.has('tavilyApiKey')) {
      const authValue = this.authPrefix ? `${this.authPrefix} ${apiKey}` : apiKey;
      finalHeaders[this.authHeader] = authValue;
    }

    // Inject rotated API key into body fields (Tavily, etc.)
    let processedBody;
    if (body && method !== 'GET') {
      try {
        const parsed = typeof body === 'string' ? JSON.parse(body) : body;
        if (parsed && typeof parsed === 'object') {
          const bodyKeyFields = ['api_key', 'apikey', 'api-key'];
          let modified = false;
          for (const field of bodyKeyFields) {
            if (field in parsed && typeof parsed[field] === 'string') {
              parsed[field] = apiKey;
              modified = true;
            }
          }
          if (modified) {
            processedBody = JSON.stringify(parsed);
          }
        }
      } catch {}
    }

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: finalHeaders
    };

    if (processedBody && method !== 'GET') {
      const bodyData = typeof processedBody === 'string' ? processedBody : JSON.stringify(processedBody);
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    } else if (body && method !== 'GET') {
      const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    return { options, processedBody };
  }
}

module.exports = OpenAIClient;
