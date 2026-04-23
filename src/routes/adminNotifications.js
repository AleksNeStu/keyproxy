/**
 * Admin notification settings route handlers.
 * Slack/Telegram notifications, Telegram bot settings.
 */

const fs = require('fs');
const path = require('path');
const { sendError } = require('./httpHelpers');

/**
 * GET /admin/api/notifications — get notification settings.
 */
async function handleGetNotifications(server, res) {
  const envVars = server.config.envVars;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    slackWebhookUrl: envVars.SLACK_WEBHOOK_URL || '',
    slackNotifyOn: envVars.SLACK_NOTIFY_ON || '',
    telegramNotifyOn: envVars.TELEGRAM_NOTIFY_ON || ''
  }));
}

/**
 * POST /admin/api/notifications — update notification settings.
 * Body: { slackWebhookUrl, slackNotifyOn, telegramNotifyOn }
 */
async function handleUpdateNotifications(server, req, res, body) {
  try {
    const { slackWebhookUrl, slackNotifyOn, telegramNotifyOn } = JSON.parse(body);
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    if (slackWebhookUrl !== undefined) envVars.SLACK_WEBHOOK_URL = slackWebhookUrl;
    if (slackNotifyOn !== undefined) envVars.SLACK_NOTIFY_ON = slackNotifyOn;
    if (telegramNotifyOn !== undefined) envVars.TELEGRAM_NOTIFY_ON = telegramNotifyOn;

    server.writeEnvFile(envVars);
    server.config.loadConfig();

    if (server.notifier) {
      server.notifier.configure({
        slackWebhookUrl: server.config.envVars.SLACK_WEBHOOK_URL,
        slackNotifyOn: server.config.envVars.SLACK_NOTIFY_ON,
        telegramNotifyOn: server.config.envVars.TELEGRAM_NOTIFY_ON
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to update notifications: ' + error.message);
  }
}

/**
 * POST /admin/api/notifications/test — send a test notification.
 * Body: { channel }
 */
async function handleTestNotification(server, req, res, body) {
  try {
    const { channel } = JSON.parse(body || '{}');
    if (!server.notifier) {
      sendError(res, 503, 'Notifier not initialized');
      return;
    }
    const result = await server.notifier.testChannel(channel);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: result }));
  } catch (error) {
    sendError(res, 500, 'Test failed: ' + error.message);
  }
}

/**
 * GET /admin/api/telegram — get Telegram bot settings.
 */
async function handleGetTelegramSettings(server, res) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    const keepAliveRaw = envVars.KEEP_ALIVE_MINUTES;
    const keepAliveMinutes = keepAliveRaw != null ? parseInt(keepAliveRaw) : 10;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      botToken: envVars.TELEGRAM_BOT_TOKEN || '',
      allowedUsers: envVars.TELEGRAM_ALLOWED_USERS || '',
      defaultStatusCodes: envVars.DEFAULT_STATUS_CODES || '429',
      keepAliveMinutes,
      botRunning: server.telegramBot.polling
    }));
  } catch (error) {
    sendError(res, 500, 'Failed to read telegram settings');
  }
}

/**
 * POST /admin/api/telegram — update Telegram bot settings.
 * Body: { botToken, allowedUsers, defaultStatusCodes, keepAliveMinutes }
 */
async function handleUpdateTelegramSettings(server, req, res, body) {
  try {
    const { botToken, allowedUsers, defaultStatusCodes, keepAliveMinutes } = JSON.parse(body);
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars = server.config.parseEnvFile(envContent);

    if (botToken !== undefined) {
      if (botToken) {
        envVars.TELEGRAM_BOT_TOKEN = botToken;
      } else {
        delete envVars.TELEGRAM_BOT_TOKEN;
      }
    }
    if (allowedUsers !== undefined) {
      if (allowedUsers) {
        envVars.TELEGRAM_ALLOWED_USERS = allowedUsers;
      } else {
        delete envVars.TELEGRAM_ALLOWED_USERS;
      }
    }
    if (defaultStatusCodes !== undefined) {
      // Parse, deduplicate, sort numerically
      const codes = defaultStatusCodes
        .split(',')
        .map(s => s.trim())
        .filter(s => /^\d+$/.test(s))
        .map(Number)
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort((a, b) => a - b);
      if (codes.length > 0) {
        envVars.DEFAULT_STATUS_CODES = codes.join(',');
      } else {
        delete envVars.DEFAULT_STATUS_CODES;
      }
    }
    if (keepAliveMinutes !== undefined) {
      const val = parseInt(keepAliveMinutes);
      if (val > 0) {
        envVars.KEEP_ALIVE_MINUTES = String(val);
      } else {
        delete envVars.KEEP_ALIVE_MINUTES;
      }
    }

    server.writeEnvFile(envVars);

    // Restart bot with new settings
    const token = envVars.TELEGRAM_BOT_TOKEN;
    const users = envVars.TELEGRAM_ALLOWED_USERS
      ? envVars.TELEGRAM_ALLOWED_USERS.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Apply keep-alive setting
    const kaMinutes = envVars.KEEP_ALIVE_MINUTES ? parseInt(envVars.KEEP_ALIVE_MINUTES) : 0;
    server.telegramBot.setKeepAliveInterval(kaMinutes);

    if (token) {
      await server.telegramBot.start(token, users);
    } else {
      await server.telegramBot.stop();
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      botRunning: server.telegramBot.polling,
      defaultStatusCodes: envVars.DEFAULT_STATUS_CODES || '429',
      keepAliveMinutes: kaMinutes
    }));
  } catch (error) {
    sendError(res, 500, 'Failed to update telegram settings');
  }
}

module.exports = {
  handleGetNotifications,
  handleUpdateNotifications,
  handleTestNotification,
  handleGetTelegramSettings,
  handleUpdateTelegramSettings
};
