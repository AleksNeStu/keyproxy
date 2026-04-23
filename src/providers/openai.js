const { URL } = require('url');
const BaseProvider = require('./BaseProvider');

class OpenAIClient extends BaseProvider {
  constructor(keyRotator, baseUrl = 'https://api.openai.com', providerName = 'openai', retryConfig = null, timeoutMs = 60000) {
    super(keyRotator, baseUrl, providerName, retryConfig, timeoutMs);
  }

  _buildRequestOptions(method, requestPath, body, headers, apiKey) {
    let fullUrl;
    if (!requestPath || requestPath === '/') {
      fullUrl = this.baseUrl;
    } else if (requestPath.startsWith('/')) {
      fullUrl = this.baseUrl.endsWith('/') ? this.baseUrl + requestPath.substring(1) : this.baseUrl + requestPath;
    } else {
      fullUrl = this.baseUrl.endsWith('/') ? this.baseUrl + requestPath : this.baseUrl + '/' + requestPath;
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

    // Only add Bearer auth if not using query-param auth (KeyProxy placeholder)
    if (!fullUrl.includes(apiKey) || !url.searchParams.has('tavilyApiKey')) {
      finalHeaders['Authorization'] = `Bearer ${apiKey}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: finalHeaders
    };

    if (body && method !== 'GET') {
      const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    return options;
  }
}

module.exports = OpenAIClient;
