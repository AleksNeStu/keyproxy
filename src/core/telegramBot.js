const https = require('https');
const http = require('http');

const telegramApi = require('../telegram/api');
const telegramLifecycle = require('../telegram/lifecycle');

/**
 * TelegramBot -- thin facade that delegates to focused modules.
 *
 * Holds all shared state (per-user model selection, history, etc.) and
 * exposes the same public API so that server.js requires no changes.
 *
 * Module breakdown:
 *   api.js           — Telegram Bot API helpers (sendMessage, editMessage, etc.)
 *   modelSelector.js — Model/provider selection UI and fetching
 *   chatHandler.js   — Chat message handling and AI proxying
 *   lifecycle.js     — Start/stop/polling/keep-alive
 *   messageRouter.js — Incoming update dispatch and callback routing
 *   logsView.js      — Log viewing UI
 *   helpers.js       — /help, /status and other small handlers
 */
class TelegramBot {
  constructor(server) {
    this.server = server;

    // Connection state
    this.token = null;
    this.allowedUsers = new Set();
    this.polling = false;
    this.lastUpdateId = 0;
    this.pollTimeout = null;
    this._activePollingReq = null;
    this.consecutiveErrors = 0;
    this.maxBackoff = 30000; // Max 30s between retries
    this.keepAliveTimer = null;
    this.keepAliveInterval = 10 * 60 * 1000; // 10 minutes

    // Per-user state
    this.userModels = new Map();          // chatId -> { provider, model, apiType }
    this.userHistory = new Map();         // chatId -> [{ role, content }]
    this.awaitingCustomModel = new Map(); // chatId -> { provider, apiType }
    this.awaitingModelSearch = new Map(); // chatId -> { provider, apiType, messageId }
    this.maxHistory = 50;

    // Model cache for pagination
    this._modelCache = new Map();
  }

  // ─── Lifecycle (delegated to lifecycle.js) ───

  async start(token, allowedUsers) {
    return telegramLifecycle.start(this, token, allowedUsers);
  }

  async stop() {
    return telegramLifecycle.stop(this);
  }

  setKeepAliveInterval(minutes) {
    telegramLifecycle.setKeepAliveInterval(this, minutes);
  }

  // ─── Telegram API helpers (delegated to api.js) ───

  async sendMessage(chatId, text, opts) {
    return telegramApi.sendMessage(this, chatId, text, opts);
  }

  async editMessage(chatId, messageId, text, opts) {
    return telegramApi.editMessage(this, chatId, messageId, text, opts);
  }

  async answerCallbackQuery(queryId, text) {
    return telegramApi.answerCallbackQuery(this, queryId, text);
  }

  async sendPhoto(chatId, photoUrl, caption) {
    return telegramApi.sendPhoto(this, chatId, photoUrl, caption);
  }

  async deleteMessage(chatId, messageId) {
    return telegramApi.deleteMessage(this, chatId, messageId);
  }

  async sendChatAction(chatId, action) {
    return telegramApi.sendChatAction(this, chatId, action);
  }

  apiCall(method, payload) {
    return telegramApi.apiCall(this, method, payload);
  }

  splitMessage(text, maxLen) {
    return telegramApi.splitMessage(text, maxLen);
  }

  async broadcastMessage(text) {
    return telegramApi.broadcastMessage(this, text);
  }

  // ─── HTTP utility methods (preserved for backward compat) ───

  httpGetBuffer(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers
      };

      const req = mod.request(options, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(buffer);
          }
        });
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Image download timeout'));
      });

      req.on('error', reject);
      req.end();
    });
  }

  httpPost(url, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;

      const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Length': Buffer.byteLength(bodyData)
        }
      };

      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve(data);
        });
      });

      req.setTimeout(120000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
      req.write(bodyData);
      req.end();
    });
  }

  httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const mod = parsed.protocol === 'https:' ? https : http;

      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers
      };

      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
          } else {
            resolve(data);
          }
        });
      });

      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = TelegramBot;
