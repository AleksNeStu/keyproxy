const api = require('./api');
const modelSelector = require('./modelSelector');
const chatHandler = require('./chatHandler');
const helpers = require('./helpers');
const logsView = require('./logsView');

/**
 * Message routing -- dispatch incoming Telegram updates to correct handlers.
 * Each function receives `bot` (the TelegramBot instance) as first argument.
 */

function isAllowed(bot, chatId) {
  return bot.allowedUsers.size === 0 || bot.allowedUsers.has(String(chatId));
}

async function handleUpdate(bot, update) {
  if (update.callback_query) {
    await handleCallback(bot, update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;

  if (!isAllowed(bot, chatId)) {
    await api.sendMessage(bot, chatId, `You are not authorized to use this bot.\n\nYour Chat ID: \`${chatId}\`\nAsk the admin to add your ID to the allowed users list.`, { parse_mode: 'Markdown' });
    return;
  }

  // Handle photo messages
  if (msg.photo && msg.photo.length > 0) {
    await chatHandler.handlePhoto(bot, chatId, msg);
    return;
  }

  // Handle document images (when sent as file)
  if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
    await chatHandler.handleDocumentImage(bot, chatId, msg);
    return;
  }

  if (!msg.text) return;

  const text = msg.text.trim();

  // Check if user is searching for a model
  if (bot.awaitingModelSearch.has(chatId) && !text.startsWith('/')) {
    const { provider: providerName, apiType, messageId } = bot.awaitingModelSearch.get(chatId);
    bot.awaitingModelSearch.delete(chatId);

    const cached = bot._modelCache.get(`${chatId}:${providerName}`);
    if (cached) {
      const query = text.toLowerCase();
      const matched = cached.models.filter(m => m.toLowerCase().includes(query));

      if (matched.length === 0) {
        await api.sendMessage(bot, chatId, `No models matching "*${text}*" in *${providerName}*.`, { parse_mode: 'Markdown' });
      } else {
        // Store filtered results in cache for selection
        const searchCacheKey = `${chatId}:${providerName}:search`;
        bot._modelCache.set(searchCacheKey, { models: matched, apiType });

        const buttons = [];
        for (let i = 0; i < matched.length && i < 50; i++) {
          buttons.push([{ text: matched[i], callback_data: `ms:${providerName}:${i}` }]);
        }
        buttons.push([
          { text: '🔍 Search again', callback_data: `search:${providerName}` },
          { text: '← All models', callback_data: `provider:${providerName}` }
        ]);

        await api.sendMessage(bot, chatId, `Found *${matched.length}* model(s) matching "*${text}*":`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: buttons }
        });
      }
    } else {
      await api.sendMessage(bot, chatId, 'Model list not cached. Use /models to fetch first.');
    }
    return;
  }

  // Check if user is typing a custom model name
  if (bot.awaitingCustomModel.has(chatId) && !text.startsWith('/')) {
    const { provider: providerName, apiType } = bot.awaitingCustomModel.get(chatId);
    bot.awaitingCustomModel.delete(chatId);

    bot.userModels.set(chatId, { provider: providerName, model: text, apiType });
    bot.userHistory.delete(chatId);

    await api.sendMessage(bot, chatId, `Model set to: *${text}*\nProvider: *${providerName}*\n\nYou can now start chatting!`, { parse_mode: 'Markdown' });
    return;
  }

  // Any command cancels the awaiting state
  if (text.startsWith('/')) {
    bot.awaitingCustomModel.delete(chatId);
    bot.awaitingModelSearch.delete(chatId);
  }

  if (text === '/start' || text === '/help') {
    await helpers.handleHelp(bot, chatId);
  } else if (text === '/models') {
    await modelSelector.handleModels(bot, chatId);
  } else if (text === '/logs') {
    await logsView.handleLogs(bot, chatId);
  } else if (text === '/clear') {
    bot.userHistory.delete(chatId);
    await api.sendMessage(bot, chatId, 'Conversation cleared.');
  } else if (text === '/status') {
    await helpers.handleStatus(bot, chatId);
  } else if (text.startsWith('/')) {
    await api.sendMessage(bot, chatId, 'Unknown command. Use /help to see available commands.');
  } else {
    await chatHandler.handleChat(bot, chatId, text);
  }
}

async function handleCallback(bot, query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  if (!isAllowed(bot, chatId)) {
    await api.answerCallbackQuery(bot, query.id, 'Not authorized');
    return;
  }

  await api.answerCallbackQuery(bot, query.id);

  if (data.startsWith('provider:')) {
    const providerName = data.substring(9);
    const provider = bot.server.config.getProvider(providerName);
    if (provider) {
      try {
        await api.editMessage(bot, chatId, messageId, `Fetching models from *${providerName}*...`, { parse_mode: 'Markdown' });
        const models = await modelSelector.fetchModels(bot, providerName, provider);
        bot._modelCache.set(`${chatId}:${providerName}`, { models, apiType: provider.apiType });
        await modelSelector.showModelPage(bot, chatId, messageId, providerName, provider.apiType, models, 0, 50);
      } catch (err) {
        await api.editMessage(bot, chatId, messageId, `Failed to fetch models: ${err.message}`);
      }
    }
  } else if (data.startsWith('m:')) {
    // m:providerName:index
    const parts = data.split(':');
    const providerName = parts[1];
    const modelIndex = parseInt(parts[2]);

    const cached = bot._modelCache.get(`${chatId}:${providerName}`);
    if (cached && modelIndex < cached.models.length) {
      const model = cached.models[modelIndex];
      const apiType = cached.apiType;

      bot.userModels.set(chatId, { provider: providerName, model, apiType });
      bot.userHistory.delete(chatId);

      await api.editMessage(bot, chatId, messageId, `Model selected: *${model}*\nProvider: *${providerName}*\n\nYou can now start chatting!`, { parse_mode: 'Markdown' });
    }
  } else if (data.startsWith('pg:')) {
    // pg:providerName:page
    const parts = data.split(':');
    const providerName = parts[1];
    const page = parseInt(parts[2]);

    const cached = bot._modelCache.get(`${chatId}:${providerName}`);
    if (cached) {
      await modelSelector.showModelPage(bot, chatId, messageId, providerName, cached.apiType, cached.models, page, 50);
    }
  } else if (data.startsWith('custom:')) {
    const providerName = data.substring(7);
    const provider = bot.server.config.getProvider(providerName);
    if (provider) {
      bot.awaitingCustomModel.set(chatId, { provider: providerName, apiType: provider.apiType });
      await api.editMessage(bot, chatId, messageId, `Type the model name for *${providerName}*:`, { parse_mode: 'Markdown' });
    }
  } else if (data.startsWith('search:')) {
    const providerName = data.substring(7);
    const provider = bot.server.config.getProvider(providerName);
    if (provider) {
      bot.awaitingModelSearch.set(chatId, { provider: providerName, apiType: provider.apiType, messageId });
      await api.editMessage(bot, chatId, messageId, `Type part of the model name to search in *${providerName}*:`, { parse_mode: 'Markdown' });
    }
  } else if (data.startsWith('ms:')) {
    // ms:providerName:index -- model selected from search results
    const parts = data.split(':');
    const providerName = parts[1];
    const modelIndex = parseInt(parts[2]);

    const searchCacheKey = `${chatId}:${providerName}:search`;
    const cached = bot._modelCache.get(searchCacheKey);
    if (cached && modelIndex < cached.models.length) {
      const model = cached.models[modelIndex];
      const apiType = cached.apiType;

      bot.userModels.set(chatId, { provider: providerName, model, apiType });
      bot.userHistory.delete(chatId);

      await api.editMessage(bot, chatId, messageId, `Model selected: *${model}*\nProvider: *${providerName}*\n\nYou can now start chatting!`, { parse_mode: 'Markdown' });
    }
  } else if (data === 'back_providers') {
    // Show providers again
    const providers = bot.server.config.getProviders();
    const buttons = [];
    for (const [name, cfg] of providers.entries()) {
      if (cfg.disabled) continue;
      if (cfg.keys.length === 0) continue;
      buttons.push([{ text: `${name} (${cfg.apiType})`, callback_data: `provider:${name}` }]);
    }
    await api.editMessage(bot, chatId, messageId, 'Select a provider:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } else if (data.startsWith('logdetail:')) {
    const requestId = data.substring(10);
    await logsView.showLogDetail(bot, chatId, messageId, requestId);
  } else if (data === 'back_logs') {
    await logsView.showLogsMessage(bot, chatId, messageId);
  }
}

module.exports = {
  isAllowed,
  handleUpdate,
  handleCallback
};
