const BaseProvider = require('./BaseProvider');

class ExaProvider extends BaseProvider {
  constructor(keyRotator, baseUrl = 'https://api.exa.ai') {
    super(keyRotator, baseUrl, 'exa', { maxRetries: 3, retryDelayMs: 1000, retryBackoff: 2 }, 60000);
  }

  _buildRequestOptions(method, requestPath, body, headers, apiKey) {
    const url = new URL(requestPath, this.baseUrl);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (body && method !== 'GET') {
      const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyData);
    }

    return options;
  }

  _rateLimitedError() {
    return {
      error: {
        message: 'All EXA API keys have been rate limited',
        type: 'rate_limit_exceeded',
        code: 'exa_rate_limit'
      }
    };
  }
}

module.exports = ExaProvider;
