const https = require('https');
const http = require('http');
const api = require('./api');
const modelSelector = require('./modelSelector');

/**
 * Chat/proxy functionality -- sending messages to AI models, handling images.
 * Each function receives `bot` (the TelegramBot instance) as first argument.
 */

async function handleChat(bot, chatId, text) {
  let selection = bot.userModels.get(chatId);
  if (!selection) {
    // Auto-assign default model (zhipuai / glm-4-flash)
    const defaultProvider = bot.server.config.getProvider('zhipuai');
    if (defaultProvider && defaultProvider.keys.length > 0 && !defaultProvider.disabled) {
      selection = { provider: 'zhipuai', model: 'glm-4-flash', apiType: 'openai' };
      bot.userModels.set(chatId, selection);
      await api.sendMessage(bot, chatId, `Auto-selected *glm-4-flash* via *zhipuai*. Use /models to change.`, { parse_mode: 'Markdown' });
    } else {
      await api.sendMessage(bot, chatId, 'No model selected. Use /models to select a provider and model first.');
      return;
    }
  }

  // Build conversation history
  if (!bot.userHistory.has(chatId)) {
    bot.userHistory.set(chatId, []);
  }
  const history = bot.userHistory.get(chatId);
  history.push({ role: 'user', content: text });

  // Trim history
  while (history.length > bot.maxHistory) {
    history.shift();
  }

  // Send temporary "Generating..." message
  const thinkingMsg = await api.sendMessage(bot, chatId, '✨ _Generating..._', { parse_mode: 'Markdown' });

  try {
    const result = await chatWithModel(bot, selection, history);
    const statusTag = `\`[${result.statusCode}]\``;

    // Handle multimodal response (images)
    if (result.multimodal) {
      if (thinkingMsg) api.deleteMessage(bot, chatId, thinkingMsg.message_id).catch((err) => {
        console.debug(`[TELEGRAM] Failed to delete message ${thinkingMsg.message_id}:`, err.message);
      });

      const textParts = [];
      for (const part of result.parts) {
        if (part.type === 'image') {
          await api.sendPhoto(bot, chatId, part.url, statusTag);
        } else if (part.type === 'text') {
          textParts.push(part.text);
        }
      }
      const textReply = textParts.join('\n');
      if (textReply) {
        const withStatus = `${textReply}\n\n${statusTag}`;
        await api.sendMessage(bot, chatId, withStatus, { parse_mode: 'Markdown' }).catch(async (err) => {
          console.debug(`[TELEGRAM] Markdown parse failed, retrying as plain text:`, err.message);
          try {
            await api.sendMessage(bot, chatId, withStatus);
          } catch (retryErr) {
            console.error(`[TELEGRAM] Message send failed completely:`, retryErr.message);
          }
        });
      }

      history.push({ role: 'assistant', content: textReply || '[image]' });
      while (history.length > bot.maxHistory) history.shift();
      return;
    }

    const reply = result.text;
    const replyWithStatus = `${reply}\n\n${statusTag}`;

    history.push({ role: 'assistant', content: reply });
    while (history.length > bot.maxHistory) {
      history.shift();
    }

    // Replace thinking message with actual reply
    if (thinkingMsg && replyWithStatus.length <= 4096) {
      try {
        await api.editMessage(bot, chatId, thinkingMsg.message_id, replyWithStatus, { parse_mode: 'Markdown' });
      } catch {
        // Markdown parse failure -- try plain text edit, fallback to new message
        try {
          await api.editMessage(bot, chatId, thinkingMsg.message_id, replyWithStatus);
        } catch {
          await api.sendMessage(bot, chatId, replyWithStatus);
        }
      }
    } else {
      // Delete thinking message and send chunks
      if (thinkingMsg) api.deleteMessage(bot, chatId, thinkingMsg.message_id).catch((err) => {
        console.debug(`[TELEGRAM] Failed to delete message ${thinkingMsg.message_id}:`, err.message);
      });
      const chunks = api.splitMessage(replyWithStatus, 4096);
      for (const chunk of chunks) {
        await api.sendMessage(bot, chatId, chunk, { parse_mode: 'Markdown' }).catch(async (err) => {
          console.debug(`[TELEGRAM] Markdown parse failed, retrying as plain text:`, err.message);
          try {
            await api.sendMessage(bot, chatId, chunk);
          } catch (retryErr) {
            console.error(`[TELEGRAM] Message send failed completely:`, retryErr.message);
          }
        });
      }
    }
  } catch (err) {
    // Remove the user message from history on failure
    history.pop();
    if (thinkingMsg) {
      await api.editMessage(bot, chatId, thinkingMsg.message_id, `Error: ${err.message}`).catch((err) => {
        console.debug(`[TELEGRAM] Failed to edit error message:`, err.message);
      });
    } else {
      await api.sendMessage(bot, chatId, `Error: ${err.message}`);
    }
  }
}

async function chatWithModel(bot, selection, history) {
  const { provider: providerName, model, apiType } = selection;
  const provider = bot.server.config.getProvider(providerName);
  if (!provider) throw new Error(`Provider '${providerName}' not found`);

  const headers = { 'content-type': 'application/json', ...modelSelector.buildAuthHeader(bot, provider) };

  let reqPath, body;

  if (apiType === 'gemini') {
    reqPath = `/${providerName}/models/${model}:generateContent`;
    body = JSON.stringify({
      contents: history.map(m => {
        const parts = [];
        if (m.image) {
          parts.push({ inline_data: { mime_type: m.image.mimeType, data: m.image.base64 } });
        }
        parts.push({ text: m.content });
        return { role: m.role === 'assistant' ? 'model' : 'user', parts };
      })
    });
  } else {
    reqPath = `/${providerName}/chat/completions`;
    body = JSON.stringify({
      model: model,
      messages: history.map(m => {
        if (m.image) {
          return {
            role: m.role,
            content: [
              { type: 'image_url', image_url: { url: `data:${m.image.mimeType};base64,${m.image.base64}` } },
              { type: 'text', text: m.content }
            ]
          };
        }
        return { role: m.role, content: m.content };
      })
    });
  }

  const res = await modelSelector.internalRequest(bot, 'POST', reqPath, headers, body);
  const statusCode = res.statusCode;
  const data = JSON.parse(res.data);

  if (data.error) {
    const errMsg = data.error.message || data.error.status || JSON.stringify(data.error);
    throw new Error(`(${statusCode}) ${errMsg}`);
  }

  if (apiType === 'gemini') {
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) throw new Error(`(${statusCode}) Empty response from Gemini`);
    return { text: parts.map(p => p.text).join(''), statusCode };
  } else {
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`(${statusCode}) Empty response from model`);

    const content = message.content;
    const parts = [];

    // Check message.images[] (OpenRouter image gen format)
    if (message.images && Array.isArray(message.images)) {
      for (const img of message.images) {
        if (img.image_url?.url) {
          parts.push({ type: 'image', url: img.image_url.url });
        }
      }
    }

    // Check content array (OpenAI multimodal format)
    if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text' && item.text) {
          parts.push({ type: 'text', text: item.text });
        } else if (item.type === 'image_url' && item.image_url?.url) {
          parts.push({ type: 'image', url: item.image_url.url });
        }
      }
    }

    if (parts.length > 0) return { multimodal: true, parts, statusCode };

    if (typeof content === 'string' && content) {
      // Check for image URLs in markdown format ![alt](url)
      const imgMarkdown = content.match(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/);
      if (imgMarkdown) {
        return { multimodal: true, parts: [{ type: 'image', url: imgMarkdown[1] }], statusCode };
      }
      return { text: content, statusCode };
    }

    throw new Error(`(${statusCode}) Empty response from model`);
  }
}

async function handlePhoto(bot, chatId, msg) {
  // Telegram sends multiple sizes, pick the largest
  const photo = msg.photo[msg.photo.length - 1];
  const caption = msg.caption || 'What is in this image?';

  await handleImageMessage(bot, chatId, photo.file_id, caption);
}

async function handleDocumentImage(bot, chatId, msg) {
  const caption = msg.caption || 'What is in this image?';
  await handleImageMessage(bot, chatId, msg.document.file_id, caption);
}

async function handleImageMessage(bot, chatId, fileId, text) {
  const selection = bot.userModels.get(chatId);
  if (!selection) {
    await api.sendMessage(bot, chatId, 'No model selected. Use /models to select a provider and model first.');
    return;
  }

  // Send temporary "Generating..." message
  const thinkingMsg = await api.sendMessage(bot, chatId, '✨ _Generating..._', { parse_mode: 'Markdown' });

  try {
    // Get file path from Telegram
    const fileInfo = await api.apiCall(bot, 'getFile', { file_id: fileId });
    const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${fileInfo.file_path}`;

    // Download image as base64
    const imageBuffer = await httpGetBuffer(bot, fileUrl);
    const base64Image = imageBuffer.toString('base64');

    // Determine mime type from file path
    const ext = fileInfo.file_path.split('.').pop().toLowerCase();
    const mimeTypes = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
    const mimeType = mimeTypes[ext] || 'image/jpeg';

    // Build multimodal history entry
    if (!bot.userHistory.has(chatId)) {
      bot.userHistory.set(chatId, []);
    }
    const history = bot.userHistory.get(chatId);

    // Add as multimodal content
    history.push({
      role: 'user',
      content: text,
      image: { base64: base64Image, mimeType }
    });

    while (history.length > bot.maxHistory) {
      history.shift();
    }

    const result = await chatWithModel(bot, selection, history);
    const statusTag = `\`[${result.statusCode}]\``;

    if (result.multimodal) {
      if (thinkingMsg) api.deleteMessage(bot, chatId, thinkingMsg.message_id).catch(() => {});
      const textParts = [];
      for (const part of result.parts) {
        if (part.type === 'image') {
          await api.sendPhoto(bot, chatId, part.url, statusTag);
        } else if (part.type === 'text') {
          textParts.push(part.text);
        }
      }
      const textReply = textParts.join('\n');
      if (textReply) {
        const withStatus = `${textReply}\n\n${statusTag}`;
        await api.sendMessage(bot, chatId, withStatus, { parse_mode: 'Markdown' }).catch(async () => {
          await api.sendMessage(bot, chatId, withStatus);
        });
      }
      history.push({ role: 'assistant', content: textReply || '[image]' });
      while (history.length > bot.maxHistory) history.shift();
      return;
    }

    const reply = result.text;
    const replyWithStatus = `${reply}\n\n${statusTag}`;

    history.push({ role: 'assistant', content: reply });
    while (history.length > bot.maxHistory) {
      history.shift();
    }

    // Replace thinking message with actual reply
    if (thinkingMsg && replyWithStatus.length <= 4096) {
      try {
        await api.editMessage(bot, chatId, thinkingMsg.message_id, replyWithStatus, { parse_mode: 'Markdown' });
      } catch {
        try {
          await api.editMessage(bot, chatId, thinkingMsg.message_id, replyWithStatus);
        } catch {
          await api.sendMessage(bot, chatId, replyWithStatus);
        }
      }
    } else {
      if (thinkingMsg) api.deleteMessage(bot, chatId, thinkingMsg.message_id).catch(() => {});
      const chunks = api.splitMessage(replyWithStatus, 4096);
      for (const chunk of chunks) {
        await api.sendMessage(bot, chatId, chunk, { parse_mode: 'Markdown' }).catch(async () => {
          await api.sendMessage(bot, chatId, chunk);
        });
      }
    }
  } catch (err) {
    if (thinkingMsg) {
      await api.editMessage(bot, chatId, thinkingMsg.message_id, `Error: ${err.message}`).catch(() => {});
    } else {
      await api.sendMessage(bot, chatId, `Error: ${err.message}`);
    }
  }
}

/**
 * HTTP GET that returns a Buffer (used for downloading images).
 */
function httpGetBuffer(url, headers = {}) {
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

module.exports = {
  handleChat,
  chatWithModel,
  handlePhoto,
  handleDocumentImage,
  handleImageMessage
};
