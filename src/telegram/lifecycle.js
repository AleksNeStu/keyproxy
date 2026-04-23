const http = require('http');
const api = require('./api');
const messageRouter = require('./messageRouter');

/**
 * Bot lifecycle -- start, stop, long-polling, keep-alive, command registration.
 * Each function receives `bot` (the TelegramBot instance) as first argument.
 */

async function start(bot, token, allowedUsers) {
  if (bot.polling) await stop(bot);

  bot.token = token;
  bot.allowedUsers = new Set(allowedUsers.map(String));

  if (!bot.token) {
    console.log('[TELEGRAM] No bot token configured');
    return;
  }

  // Flush any lingering getUpdates session from a previous instance
  try {
    await api.apiCall(bot, 'getUpdates', { offset: -1, timeout: 0 });
  } catch {
    // Ignore -- just clearing the old session
  }

  bot.polling = true;
  bot.lastUpdateId = 0;
  bot.consecutiveErrors = 0;
  console.log(`[TELEGRAM] Bot starting with ${bot.allowedUsers.size} allowed user(s)`);
  registerCommands(bot);
  poll(bot);
  startKeepAlive(bot);
}

async function registerCommands(bot) {
  try {
    await api.apiCall(bot, 'setMyCommands', {
      commands: [
        { command: 'models', description: 'Select a provider and model' },
        { command: 'clear', description: 'Clear conversation history' },
        { command: 'logs', description: 'View recent API logs' },
        { command: 'status', description: 'Show current model info' },
        { command: 'help', description: 'Show available commands' }
      ]
    });
    console.log('[TELEGRAM] Bot commands registered');
  } catch (err) {
    console.log(`[TELEGRAM] Failed to register commands: ${err.message}`);
  }
}

async function stop(bot) {
  bot.polling = false;
  if (bot.pollTimeout) {
    clearTimeout(bot.pollTimeout);
    bot.pollTimeout = null;
  }
  if (bot.keepAliveTimer) {
    clearInterval(bot.keepAliveTimer);
    bot.keepAliveTimer = null;
  }
  // Abort in-flight getUpdates request
  if (bot._activePollingReq) {
    bot._activePollingReq.destroy();
    bot._activePollingReq = null;
  }
  // Flush the old polling session so the next start doesn't conflict
  if (bot.token) {
    try {
      await api.apiCall(bot, 'getUpdates', { offset: -1, timeout: 0 });
    } catch {
      // Ignore -- just clearing
    }
  }
  console.log('[TELEGRAM] Bot stopped');
}

function setKeepAliveInterval(bot, minutes) {
  bot.keepAliveInterval = minutes > 0 ? minutes * 60 * 1000 : 0;
  // Restart keep-alive if bot is currently polling
  if (bot.polling) {
    startKeepAlive(bot);
  }
}

function startKeepAlive(bot) {
  if (bot.keepAliveTimer) {
    clearInterval(bot.keepAliveTimer);
    bot.keepAliveTimer = null;
  }
  if (bot.keepAliveInterval <= 0) {
    console.log('[TELEGRAM] Keep-alive disabled');
    return;
  }
  const minutes = Math.round(bot.keepAliveInterval / 60000);
  console.log(`[TELEGRAM] Keep-alive enabled (every ${minutes} min)`);
  bot.keepAliveTimer = setInterval(() => {
    if (!bot.polling) return;
    const port = bot.server.config.getPort();
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      res.resume(); // drain response
    });
    req.on('error', () => {}); // ignore errors
    req.setTimeout(5000, () => req.destroy());
    console.log('[TELEGRAM] Keep-alive ping sent');
  }, bot.keepAliveInterval);
  // Don't let the timer prevent process exit
  if (bot.keepAliveTimer.unref) bot.keepAliveTimer.unref();
}

async function poll(bot) {
  if (!bot.polling) return;

  try {
    const updates = await api.apiCall(bot, 'getUpdates', {
      offset: bot.lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ['message', 'callback_query']
    });

    // Success -- reset error counter
    bot.consecutiveErrors = 0;

    if (updates && updates.length > 0) {
      for (const update of updates) {
        bot.lastUpdateId = update.update_id;
        try {
          await messageRouter.handleUpdate(bot, update);
        } catch (err) {
          console.log(`[TELEGRAM] Error handling update: ${err.message}`);
        }
      }
    }
  } catch (err) {
    bot.consecutiveErrors++;
    const backoff = Math.min(1000 * Math.pow(2, bot.consecutiveErrors - 1), bot.maxBackoff);
    console.log(`[TELEGRAM] Polling error (attempt ${bot.consecutiveErrors}, retry in ${backoff}ms): ${err.message}`);

    if (bot.polling) {
      bot.pollTimeout = setTimeout(() => poll(bot), backoff);
    }
    return;
  }

  if (bot.polling) {
    bot.pollTimeout = setTimeout(() => poll(bot), 500);
  }
}

module.exports = {
  start,
  registerCommands,
  stop,
  setKeepAliveInterval,
  startKeepAlive,
  poll
};
