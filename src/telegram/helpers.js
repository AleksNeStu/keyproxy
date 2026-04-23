const api = require('./api');

/**
 * Misc helpers -- help message, status display, and other small handlers.
 * Each function receives `bot` (the TelegramBot instance) as first argument.
 */

async function handleHelp(bot, chatId) {
  const selection = bot.userModels.get(chatId);
  const current = selection
    ? `*Current model:* \`${selection.model}\` (${selection.provider})`
    : '*No model selected yet*';

  const helpText = [
    '*API Key KeyProxyr Bot*',
    '',
    current,
    '',
    '*Commands:*',
    '/models - Select a provider and model',
    '/clear - Clear conversation history',
    '/logs - View recent API logs',
    '/status - Show current model & history size',
    '/help - Show this message',
    '',
    'Just send a message to chat with the selected model.'
  ].join('\n');

  await api.sendMessage(bot, chatId, helpText, { parse_mode: 'Markdown' });
}

async function handleStatus(bot, chatId) {
  const selection = bot.userModels.get(chatId);
  const history = bot.userHistory.get(chatId) || [];
  const lines = [];

  if (selection) {
    lines.push(`*Provider:* \`${selection.provider}\``);
    lines.push(`*Model:* \`${selection.model}\``);
    lines.push(`*API Type:* ${selection.apiType}`);
  } else {
    lines.push('*No model selected.* Use /models to pick one.');
  }
  lines.push(`*History:* ${history.length} messages`);
  await api.sendMessage(bot, chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}

module.exports = {
  handleHelp,
  handleStatus
};
