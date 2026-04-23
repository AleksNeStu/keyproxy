const https = require('https');
const http = require('http');

/**
 * Telegram API helpers — low-level communication with Telegram Bot API.
 * Each function receives `bot` (the TelegramBot instance) as first argument
 * so it can access bot.token and bot._activePollingReq.
 */

function splitMessage(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at newline
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen / 2) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }
  return chunks;
}

async function sendMessage(bot, chatId, text, opts = {}) {
  const payload = {
    chat_id: chatId,
    text: text,
    ...opts
  };
  try {
    const result = await apiCall(bot, 'sendMessage', payload);
    return result;
  } catch (err) {
    console.log(`[TELEGRAM] sendMessage error: ${err.message}`);
    return null;
  }
}

async function editMessage(bot, chatId, messageId, text, opts = {}) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    ...opts
  };
  try {
    await apiCall(bot, 'editMessageText', payload);
  } catch (err) {
    console.log(`[TELEGRAM] editMessage error: ${err.message}`);
  }
}

async function answerCallbackQuery(bot, queryId, text) {
  const payload = { callback_query_id: queryId };
  if (text) payload.text = text;
  try {
    await apiCall(bot, 'answerCallbackQuery', payload);
  } catch {}
}

async function sendPhoto(bot, chatId, photoUrl, caption) {
  try {
    // Handle base64 data URIs — must upload as multipart
    const dataUriMatch = photoUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (dataUriMatch) {
      const ext = dataUriMatch[1] === 'jpeg' ? 'jpg' : dataUriMatch[1];
      const buffer = Buffer.from(dataUriMatch[2], 'base64');
      await sendPhotoBuffer(bot, chatId, buffer, `image.${ext}`, caption);
    } else {
      const payload = { chat_id: chatId, photo: photoUrl };
      if (caption) payload.caption = caption;
      await apiCall(bot, 'sendPhoto', payload);
    }
  } catch (err) {
    // Fallback: if it's a URL, send as link; if base64, just report success/failure
    if (!photoUrl.startsWith('data:')) {
      await sendMessage(bot, chatId, photoUrl);
    } else {
      console.log(`[TELEGRAM] Failed to send photo: ${err.message}`);
      await sendMessage(bot, chatId, 'Generated an image but failed to send it.');
    }
  }
}

function sendPhotoBuffer(bot, chatId, buffer, filename, caption) {
  return new Promise((resolve, reject) => {
    const boundary = '----TGBotBoundary' + Math.random().toString(36).substring(2);

    let body = '';
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;

    if (caption) {
      body += `--${boundary}\r\n`;
      body += `Content-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`;
    }

    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="photo"; filename="${filename}"\r\n`;
    body += `Content-Type: image/${filename.split('.').pop()}\r\n\r\n`;

    const ending = `\r\n--${boundary}--\r\n`;

    const bodyBuffer = Buffer.concat([
      Buffer.from(body, 'utf8'),
      buffer,
      Buffer.from(ending, 'utf8')
    ]);

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${bot.token}/sendPhoto`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.ok) resolve(parsed.result);
          else reject(new Error(parsed.description || 'sendPhoto failed'));
        } catch (e) {
          reject(new Error('Invalid response'));
        }
      });
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Upload timeout'));
    });

    req.on('error', reject);
    req.write(bodyBuffer);
    req.end();
  });
}

async function deleteMessage(bot, chatId, messageId) {
  try {
    await apiCall(bot, 'deleteMessage', { chat_id: chatId, message_id: messageId });
  } catch {}
}

async function sendChatAction(bot, chatId, action) {
  await apiCall(bot, 'sendChatAction', { chat_id: chatId, action });
}

function apiCall(bot, method, payload = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${bot.token}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    // Use longer timeout for getUpdates (long polling uses 30s, give extra buffer)
    const timeoutMs = method === 'getUpdates' ? 60000 : 30000;
    const isLongPoll = method === 'getUpdates' && payload.timeout > 0;

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (isLongPoll) bot._activePollingReq = null;
        try {
          const parsed = JSON.parse(body);
          if (parsed.ok) {
            resolve(parsed.result);
          } else {
            reject(new Error(parsed.description || 'Telegram API error'));
          }
        } catch (e) {
          reject(new Error('Invalid response from Telegram'));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      if (isLongPoll) bot._activePollingReq = null;
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', (err) => {
      if (isLongPoll) bot._activePollingReq = null;
      reject(err);
    });

    // Track the long-polling request so stop() can abort it
    if (isLongPoll) bot._activePollingReq = req;

    req.write(data);
    req.end();
  });
}

async function broadcastMessage(bot, text) {
  if (!bot || !bot.token) return;
  const users = bot.allowedUsers;
  if (!users || users.size === 0) return;

  for (const chatId of users) {
    try {
      await sendMessage(bot, chatId, text);
    } catch (err) {
      console.error(`[TELEGRAM] Broadcast to ${chatId} failed:`, err.message);
    }
  }
}

module.exports = {
  splitMessage,
  sendMessage,
  editMessage,
  answerCallbackQuery,
  sendPhoto,
  sendPhotoBuffer,
  deleteMessage,
  sendChatAction,
  apiCall,
  broadcastMessage
};
