const api = require('./api');

/**
 * Log viewing -- show recent logs and log details.
 * Each function receives `bot` (the TelegramBot instance) as first argument.
 */

async function handleLogs(bot, chatId) {
  const msg = await api.sendMessage(bot, chatId, 'Loading logs...');
  if (msg) {
    await showLogsMessage(bot, chatId, msg.message_id);
  }
}

async function showLogsMessage(bot, chatId, messageId) {
  const logs = bot.server.logBuffer.slice(-20).reverse();

  if (logs.length === 0) {
    await api.editMessage(bot, chatId, messageId, 'No logs available.');
    return;
  }

  const lines = logs.map((log, i) => {
    if (typeof log === 'string') return log;
    const time = new Date(log.timestamp).toLocaleTimeString();
    const status = log.status || '???';
    const statusEmoji = log.status >= 400 ? '❌' : '✅';
    return `${statusEmoji} \`${time}\` ${log.method} \`${log.endpoint}\` (${log.provider}) → ${status}`;
  });

  const buttons = [];
  // Show "View Details" buttons for logs with requestId, max 10
  const detailLogs = logs.filter(l => typeof l === 'object' && l.requestId && l.requestId !== 'unknown').slice(0, 10);
  for (const log of detailLogs) {
    const time = new Date(log.timestamp).toLocaleTimeString();
    const label = `${log.method} ${log.endpoint} (${log.status || '?'}) - ${time}`;
    buttons.push([{ text: label, callback_data: `logdetail:${log.requestId}` }]);
  }

  await api.editMessage(bot, chatId, messageId, `*Recent Logs* (${logs.length}):\n\n${lines.join('\n')}`, {
    parse_mode: 'Markdown',
    reply_markup: buttons.length > 0 ? { inline_keyboard: buttons } : undefined
  });
}

async function showLogDetail(bot, chatId, messageId, requestId) {
  const responseData = bot.server.responseStorage.get(requestId);
  const logEntry = bot.server.logBuffer.find(l => typeof l === 'object' && l.requestId === requestId);

  const lines = [`*Log Detail:* \`${requestId}\``];

  if (logEntry) {
    lines.push(`*Time:* ${new Date(logEntry.timestamp).toLocaleString()}`);
    lines.push(`*Method:* ${logEntry.method}`);
    lines.push(`*Endpoint:* \`${logEntry.endpoint}\``);
    lines.push(`*Provider:* ${logEntry.provider}`);
    lines.push(`*Status:* ${logEntry.status || 'N/A'}`);
    lines.push(`*Response Time:* ${logEntry.responseTime ? logEntry.responseTime + 'ms' : 'N/A'}`);
    if (logEntry.keyUsed) lines.push(`*Key Used:* \`${logEntry.keyUsed}\``);
    if (logEntry.error) lines.push(`*Error:* ${logEntry.error}`);
    if (logEntry.failedKeys && logEntry.failedKeys.length > 0) {
      const failed = logEntry.failedKeys.map(fk => `\`${fk.key}\` (${fk.status || 'err'})`).join(', ');
      lines.push(`*Failed Keys:* ${failed}`);
    }
  }

  if (responseData) {
    lines.push('');
    lines.push(`*Response Status:* ${responseData.status} ${responseData.statusText || ''}`);
    lines.push(`*Content Type:* ${responseData.contentType || 'N/A'}`);

    if (responseData.requestBody) {
      let reqPreview = typeof responseData.requestBody === 'string' ? responseData.requestBody : JSON.stringify(responseData.requestBody);
      if (reqPreview.length > 500) reqPreview = reqPreview.substring(0, 500) + '...';
      lines.push(`\n*Request Body:*\n\`\`\`\n${reqPreview}\n\`\`\``);
    }

    if (responseData.responseData) {
      let resPreview = responseData.responseData;
      if (resPreview.length > 500) resPreview = resPreview.substring(0, 500) + '...';
      lines.push(`\n*Response:*\n\`\`\`\n${resPreview}\n\`\`\``);
    }
  } else if (!logEntry) {
    lines.push('Log details not found (may have been cleared from memory).');
  }

  const buttons = [[{ text: '← Back to logs', callback_data: 'back_logs' }]];

  let text = lines.join('\n');
  // Truncate if too long for Telegram
  if (text.length > 4000) text = text.substring(0, 4000) + '\n...truncated';

  await api.editMessage(bot, chatId, messageId, text, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  });
}

module.exports = {
  handleLogs,
  showLogsMessage,
  showLogDetail
};
