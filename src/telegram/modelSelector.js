const api = require('./api');

/**
 * Model selection UI — provider/model picking, pagination, search, custom model input.
 * Each function receives `bot` (the TelegramBot instance) as first argument.
 */

async function handleModels(bot, chatId) {
  const providers = bot.server.config.getProviders();
  if (providers.size === 0) {
    await api.sendMessage(bot, chatId, 'No providers configured. Add providers via the admin panel.');
    return;
  }

  const buttons = [];
  for (const [name, cfg] of providers.entries()) {
    if (cfg.disabled) continue;
    if (cfg.keys.length === 0) continue;
    buttons.push([{ text: `${name} (${cfg.apiType})`, callback_data: `provider:${name}` }]);
  }

  if (buttons.length === 0) {
    await api.sendMessage(bot, chatId, 'No active providers available.');
    return;
  }

  await api.sendMessage(bot, chatId, 'Select a provider:', {
    reply_markup: { inline_keyboard: buttons }
  });
}

async function handleProviderSelected(bot, chatId, providerName, messageId) {
  const provider = bot.server.config.getProvider(providerName);
  if (!provider) {
    await api.answerCallbackQuery(bot, chatId, 'Provider not found');
    return;
  }

  await api.editMessage(bot, chatId, messageId, `Fetching models from *${providerName}*...`, { parse_mode: 'Markdown' });

  try {
    const models = await fetchModels(bot, providerName, provider);

    if (models.length === 0) {
      await api.editMessage(bot, chatId, messageId, `No models found for *${providerName}*.`, { parse_mode: 'Markdown' });
      return;
    }

    // Paginate: show first 50, with pages if more
    const pageSize = 50;
    const page = 0;
    await showModelPage(bot, chatId, messageId, providerName, provider.apiType, models, page, pageSize);
  } catch (err) {
    await api.editMessage(bot, chatId, messageId, `Failed to fetch models: ${err.message}`);
  }
}

async function showModelPage(bot, chatId, messageId, providerName, apiType, models, page, pageSize) {
  const start = page * pageSize;
  const pageModels = models.slice(start, start + pageSize);

  // One model per row
  const buttons = [];
  for (let i = 0; i < pageModels.length; i++) {
    buttons.push([{ text: pageModels[i], callback_data: `m:${providerName}:${start + i}` }]);
  }

  // Pagination nav
  const totalPages = Math.ceil(models.length / pageSize);
  if (totalPages > 1) {
    const nav = [];
    if (page > 0) nav.push({ text: '← Prev', callback_data: `pg:${providerName}:${page - 1}` });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: 'noop' });
    if (page < totalPages - 1) nav.push({ text: 'Next →', callback_data: `pg:${providerName}:${page + 1}` });
    buttons.push(nav);
  }

  // Search, Custom model + Back buttons
  buttons.push([
    { text: '🔍 Search models', callback_data: `search:${providerName}` }
  ]);
  buttons.push([
    { text: '✏️ Type custom model', callback_data: `custom:${providerName}` },
    { text: '← Back', callback_data: 'back_providers' }
  ]);

  await api.editMessage(bot, chatId, messageId, `Select a model from *${providerName}* (${models.length} available):`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

async function fetchModels(bot, providerName, provider) {
  const headers = buildAuthHeader(bot, provider);
  const res = await internalRequest(bot, 'GET', `/${providerName}/models`, headers);
  const parsed = JSON.parse(res.data);

  if (res.statusCode >= 400) {
    throw new Error(parsed.error?.message || `HTTP ${res.statusCode}`);
  }

  if (provider.apiType === 'gemini') {
    return (parsed.models || []).map(m => m.name.replace('models/', '')).sort();
  } else {
    return (parsed.data || []).map(m => m.id).sort();
  }
}

/**
 * Build auth header for internal requests to the proxy.
 */
function buildAuthHeader(bot, provider) {
  const headers = {};

  // Read default status codes from env
  const statusCodes = getDefaultStatusCodes(bot);
  let authContent = `[STATUS_CODES:${statusCodes}]`;

  if (provider.accessKey) {
    authContent += `[ACCESS_KEY:${provider.accessKey}]`;
  }

  if (provider.apiType === 'gemini') {
    headers['x-goog-api-key'] = authContent;
  } else {
    headers['authorization'] = `Bearer ${authContent}`;
  }

  return headers;
}

function getDefaultStatusCodes(bot) {
  try {
    const fs = require('fs');
    const path = require('path');
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return '429';
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = bot.server.config.parseEnvFile(envContent);
    return envVars.DEFAULT_STATUS_CODES || '429';
  } catch {
    return '429';
  }
}

/**
 * Make a request directly through the server's HTTP handler -- no network needed.
 * Goes through the full proxy pipeline (routing, key rotation, logging, access keys).
 */
function internalRequest(bot, method, urlPath, headers = {}, body = null) {
  const { Readable } = require('stream');
  return new Promise((resolve, reject) => {
    // Build a minimal IncomingMessage-like readable stream
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = urlPath;
    req.headers = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
    );
    req.connection = { remoteAddress: '127.0.0.1' };

    if (body) req.push(body);
    req.push(null);

    // Build a minimal ServerResponse-like object that collects the output
    let statusCode = 200;
    const resHeaders = {};
    const chunks = [];
    let finished = false;

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        reject(new Error('Internal request timeout (60s)'));
      }
    }, 60000);
    if (timer.unref) timer.unref();

    const res = {
      setHeader(key, val) { resHeaders[key.toLowerCase()] = val; },
      writeHead(code, hdrs) {
        statusCode = code;
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) {
            resHeaders[k.toLowerCase()] = v;
          }
        }
      },
      write(chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      end(data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        resolve({
          statusCode,
          headers: resHeaders,
          data: Buffer.concat(chunks).toString('utf8')
        });
      },
      get headersSent() { return false; },
      on() { return res; }
    };

    try {
      const result = bot.server.handleRequest(req, res);
      if (result && typeof result.catch === 'function') {
        result.catch(err => {
          if (!finished) { finished = true; clearTimeout(timer); reject(err); }
        });
      }
    } catch (err) {
      if (!finished) { finished = true; clearTimeout(timer); reject(err); }
    }
  });
}

module.exports = {
  handleModels,
  handleProviderSelected,
  showModelPage,
  fetchModels,
  buildAuthHeader,
  internalRequest
};
