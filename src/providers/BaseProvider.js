const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { maskApiKey, sleep } = require('../core/utils');
const { handleError } = require('../core/errorHandler');

class BaseProvider {
  constructor(keyRotator, baseUrl, providerName, retryConfig = null, timeoutMs = 60000, budgetTracker = null, providerConfig = null) {
    this.keyRotator = keyRotator;
    this.baseUrl = baseUrl;
    this.providerName = providerName;
    this.retryConfig = retryConfig || { maxRetries: 3, retryDelayMs: 1000, retryBackoff: 2 };
    this.timeoutMs = timeoutMs;
    this.budgetTracker = budgetTracker;
    this.providerConfig = providerConfig;
  }

  /**
   * Override in subclass to extract an API key provided in request headers.
   * Return { key, cleanHeaders } to use that key directly, or null to use rotation.
   */
  getProvidedApiKey(headers) {
    return null;
  }

  /**
   * Build https.request options. Must be implemented by subclass.
   * @param {string} method
   * @param {string} requestPath
   * @param {*} body
   * @param {object} headers
   * @param {string} apiKey
   */
  _buildRequestOptions(method, requestPath, body, headers, apiKey) {
    throw new Error('_buildRequestOptions must be implemented by subclass');
  }

  async makeRequest(method, requestPath, body, headers = {}, customStatusCodes = null, streaming = false) {
    // Check if the request provides its own API key (e.g. Gemini x-goog-api-key)
    const provided = this.getProvidedApiKey(headers);
    if (provided) {
      return this._makeProvidedKeyRequest(method, requestPath, body, provided.cleanHeaders, provided.key, streaming);
    }

    const requestContext = this.keyRotator.createRequestContext();
    let lastError = null;
    let lastResponse = null;
    const failedKeys = [];

    const rotationStatusCodes = customStatusCodes || new Set([401, 429]);
    const { maxRetries, retryDelayMs, retryBackoff } = this.retryConfig;

    let apiKey;
    let attempt = 0;
    while ((apiKey = requestContext.getNextKey()) !== null && attempt < maxRetries) {
      attempt++;
      const maskedKey = maskApiKey(apiKey);

      // Budget check: skip keys that have exceeded their daily/monthly budget
      if (this.budgetTracker) {
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').substring(0, 16);
        const budgetStatus = this.budgetTracker.checkBudget(keyHash);
        if (!budgetStatus.allowed) {
          const limitInfo = budgetStatus.dailyLimit ? 'daily' : 'monthly';
          console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] Budget exceeded (${limitInfo}: $${budgetStatus.dailyLimit ? budgetStatus.dailySpent.toFixed(2) + '/' + budgetStatus.dailyLimit : budgetStatus.monthlySpent.toFixed(2) + '/' + budgetStatus.monthlyLimit}) - trying next key`);
          requestContext.markKeyAsRateLimited(apiKey);
          failedKeys.push({ key: maskedKey, status: 429, reason: `budget_exceeded_${limitInfo}` });
          continue;
        }
      }

      console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] Attempting ${method} ${requestPath}${streaming ? ' (streaming)' : ''}`);

      try {
        const response = streaming
          ? await this._sendStreamingRequest(method, requestPath, body, headers, apiKey)
          : await this._sendRequest(method, requestPath, body, headers, apiKey);

        if (rotationStatusCodes.has(response.statusCode)) {
          console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] ✗ Status ${response.statusCode} triggers rotation - trying next key (attempt ${attempt}/${maxRetries})`);
          if (response.stream) response.stream.resume();
          requestContext.markKeyAsRateLimited(apiKey);
          this.keyRotator.recordRotationEvent(this.providerName, apiKey, response.statusCode);

          // Extract error message if available
          let errorReason = 'rate_limited';
          if (!streaming && response.data) {
            try {
              const errorData = JSON.parse(response.data);
              if (errorData.error && errorData.error.message) {
                errorReason = errorData.error.message.substring(0, 100);
              }
            } catch (e) {
              // Ignore parse errors
            }
          }

          failedKeys.push({ key: maskedKey, status: response.statusCode, reason: errorReason });
          lastResponse = response.stream ? { statusCode: response.statusCode, headers: response.headers, data: '' } : response;
          const delay = retryDelayMs * Math.pow(retryBackoff, attempt - 1);
          console.log(`[${this.providerName.toUpperCase()}] ⏳ Waiting ${delay}ms before retry (attempt ${attempt}/${maxRetries})`);
          await sleep(delay);
          continue;
        }

        // Check for permanent freeze conditions (e.g., Exa 402 balance exhaustion)
        const freezeStatusCodes = this.providerConfig?.freezeOnStatusCodes;
        if (freezeStatusCodes && freezeStatusCodes.has(response.statusCode) && this.keyRotator.historyManager) {
          let freezeDetail = 'balance_exhausted';
          if (!streaming && response.data) {
            try {
              const errBody = JSON.parse(response.data);
              const msg = (errBody.error?.message || '').toLowerCase();
              if (msg.includes('insufficient credit') || msg.includes('no credits remaining')) freezeDetail = 'credits_depleted';
              else if (msg.includes('balance exhausted') || msg.includes('balance depleted')) freezeDetail = 'balance_depleted';
              else if (msg.includes('quota exceeded') || msg.includes('usage limit')) freezeDetail = 'quota_exceeded';
            } catch (_) { /* non-JSON response, use default */ }
          }
          const reason = `${response.statusCode}_${freezeDetail}`;
          this.keyRotator.historyManager.recordKeyFrozen(this.providerName, apiKey, reason);
          console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] KEY FROZEN (${reason}) — permanent disable`);
          requestContext.markKeyAsRateLimited(apiKey);
          failedKeys.push({ key: maskedKey, status: response.statusCode, reason: `frozen_${freezeDetail}` });
          lastResponse = response.stream ? { statusCode: response.statusCode, headers: response.headers, data: '' } : response;
          continue;
        }

        console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] ✓ Success (${response.statusCode})${streaming ? ' - streaming' : ''}`);
        this.keyRotator.incrementKeyUsage(apiKey);
        this.keyRotator.recordSuccessEvent(this.providerName, apiKey);
        response._keyInfo = { keyUsed: maskedKey, actualKey: apiKey, failedKeys };
        return response;
      } catch (error) {
        handleError(error, { location: this.providerName, category: 'high' });
        console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] ✗ Request failed: ${error.message}`);
        failedKeys.push({ key: maskedKey, status: null, reason: error.message.substring(0, 100) });
        lastError = error;
        const delay = retryDelayMs * Math.pow(retryBackoff, attempt - 1);
        await sleep(delay);
        continue;
      }
    }

    const stats = requestContext.getStats();
    console.log(`[${this.providerName.toUpperCase()}] ⚠ All ${stats.totalKeys} keys tried. ${stats.rateLimitedKeys} rate limited.`);
    
    // Log detailed failure summary
    if (failedKeys.length > 0) {
      console.log(`[${this.providerName.toUpperCase()}] Failed keys summary:`);
      failedKeys.forEach((fk, idx) => {
        console.log(`  ${idx + 1}. ${fk.key} - ${fk.status ? `HTTP ${fk.status}` : 'Error'}: ${fk.reason}`);
      });
    }

    this.keyRotator.updateLastFailedKey(requestContext.getLastFailedKey());

    if (requestContext.allTriedKeysRateLimited()) {
      console.log(`[${this.providerName.toUpperCase()}] ❌ All keys rate limited - returning 429`);
      const response = lastResponse || {
        statusCode: 429,
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify(this._rateLimitedError())
      };
      response._keyInfo = { keyUsed: null, failedKeys };
      return response;
    }

    if (lastError) throw lastError;
    throw new Error('All API keys exhausted without clear error');
  }

  _makeProvidedKeyRequest(method, requestPath, body, headers, apiKey, streaming) {
    const maskedKey = maskApiKey(apiKey);
    console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] Using provided API key${streaming ? ' (streaming)' : ''}`);

    const send = streaming ? this._sendStreamingRequest : this._sendRequest;
    return send.call(this, method, requestPath, body, headers, apiKey)
      .then(response => {
        console.log(`[${this.providerName.toUpperCase()}::${maskedKey}] Response (${response.statusCode})${streaming ? ' - streaming' : ''}`);
        response._keyInfo = { keyUsed: maskedKey, failedKeys: [] };
        return response;
      });
  }

  /** Override to customize the 429 error body returned when all keys are exhausted. */
  _rateLimitedError() {
    return {
      error: {
        message: 'All API keys have been rate limited for this request',
        type: 'rate_limit_exceeded',
        code: 'rate_limit_exceeded'
      }
    };
  }

  _sendRequest(method, requestPath, body, headers, apiKey) {
    return new Promise((resolve, reject) => {
      const options = this._buildRequestOptions(method, requestPath, body, headers, apiKey);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          // Log HTTP 405 errors with more context
          if (res.statusCode === 405) {
            console.log(`[${this.providerName.toUpperCase()}::${maskApiKey(apiKey)}] ⚠ HTTP 405 Method Not Allowed - ${method} ${requestPath}`);
            console.log(`[${this.providerName.toUpperCase()}::${maskApiKey(apiKey)}] Hint: This endpoint may require a different HTTP method (GET/POST/PUT/DELETE)`);
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, data });
        });
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`Request timeout (${this.timeoutMs}ms)`));
      });

      req.on('error', (error) => {
        console.log(`[${this.providerName.toUpperCase()}::${maskApiKey(apiKey)}] ✗ HTTP request error: ${error.message}`);
        reject(error);
      });

      if (body && method !== 'GET') {
        const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(bodyData);
      }

      req.end();
    });
  }

  _sendStreamingRequest(method, requestPath, body, headers, apiKey) {
    return new Promise((resolve, reject) => {
      const options = this._buildRequestOptions(method, requestPath, body, headers, apiKey);

      const req = https.request(options, (res) => {
        // Log HTTP 405 errors with more context
        if (res.statusCode === 405) {
          console.log(`[${this.providerName.toUpperCase()}::${maskApiKey(apiKey)}] ⚠ HTTP 405 Method Not Allowed - ${method} ${requestPath}`);
          console.log(`[${this.providerName.toUpperCase()}::${maskApiKey(apiKey)}] Hint: This endpoint may require a different HTTP method (GET/POST/PUT/DELETE)`);
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, stream: res });
      });

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(new Error(`Streaming request timeout (${this.timeoutMs}ms)`));
      });

      req.on('error', (error) => {
        console.log(`[${this.providerName.toUpperCase()}::${maskApiKey(apiKey)}] ✗ HTTP streaming request error: ${error.message}`);
        reject(error);
      });

      if (body && method !== 'GET') {
        const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
        req.write(bodyData);
      }

      req.end();
    });
  }
}

module.exports = BaseProvider;
