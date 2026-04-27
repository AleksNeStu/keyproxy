const { URL } = require('url');
const BaseProvider = require('./BaseProvider');

class GeminiClient extends BaseProvider {
  constructor(keyRotator, baseUrl = 'https://generativelanguage.googleapis.com', providerName = 'gemini', retryConfig = null, timeoutMs = 60000) {
    super(keyRotator, baseUrl, providerName, retryConfig, timeoutMs);
  }

  getProvidedApiKey(headers) {
    const key = headers['x-goog-api-key'];
    if (!key) return null;
    const cleanHeaders = { ...headers };
    delete cleanHeaders['x-goog-api-key'];
    return { key, cleanHeaders };
  }

  _buildRequestOptions(method, requestPath, body, headers, apiKey) {
    const baseUrl = this._baseUrlOverride || this.baseUrl;
    let fullUrl;
    if (!requestPath || requestPath === '/') {
      fullUrl = baseUrl;
    } else if (requestPath.startsWith('/')) {
      let effectiveBaseUrl = baseUrl;

      // Resolve version conflicts between path and base URL
      const pathVersionMatch = requestPath.match(/^\/v[^\/]+\//);
      const baseVersionMatch = baseUrl.match(/\/v[^\/]+$/);

      if (pathVersionMatch && baseVersionMatch) {
        const pathVersion = pathVersionMatch[0].slice(0, -1);
        const baseVersion = baseVersionMatch[0];

        if (pathVersion !== baseVersion) {
          effectiveBaseUrl = baseUrl.replace(baseVersion, pathVersion);
          requestPath = requestPath.substring(pathVersion.length);
        }
      }

      fullUrl = effectiveBaseUrl.endsWith('/') ? effectiveBaseUrl + requestPath.substring(1) : effectiveBaseUrl + requestPath;
    } else {
      fullUrl = baseUrl.endsWith('/') ? baseUrl + requestPath : baseUrl + '/' + requestPath;
    }

    const url = new URL(fullUrl);

    const finalHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    // Use header auth for provided keys, query param for rotated keys
    if (this._isProvidedKey(apiKey)) {
      finalHeaders['x-goog-api-key'] = apiKey;
    } else {
      url.searchParams.append('key', apiKey);
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

  _rateLimitedError() {
    return {
      error: {
        code: 429,
        message: 'All API keys have been rate limited for this request',
        status: 'RESOURCE_EXHAUSTED'
      }
    };
  }

  /** Track whether the current request is using a provided key (header auth) vs rotated key (query param). */
  _providedKeyMode = false;

  _makeProvidedKeyRequest(method, requestPath, body, headers, apiKey, streaming) {
    this._providedKeyMode = true;
    return super._makeProvidedKeyRequest(method, requestPath, body, headers, apiKey, streaming)
      .finally(() => { this._providedKeyMode = false; });
  }

  _isProvidedKey() {
    return this._providedKeyMode;
  }
}

module.exports = GeminiClient;
