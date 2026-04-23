const SlackNotifier = require('./slackNotifier');
const { handleError, ErrorCategories } = require('./errorHandler');

class Notifier {
  constructor(server) {
    this.server = server;
    this.channels = {};
    this.lastSent = {};
    this.minInterval = 60000; // 1 minute dedup per event type
  }

  configure(config) {
    if (config.slackWebhookUrl) {
      this.channels.slack = new SlackNotifier(config.slackWebhookUrl);
    }
    this.notifyOn = {
      slack: (config.slackNotifyOn || '').split(',').map(s => s.trim()).filter(Boolean),
      telegram: (config.telegramNotifyOn || '').split(',').map(s => s.trim()).filter(Boolean)
    };
  }

  async send(message, level = 'info') {
    const now = Date.now();
    if (this.lastSent[level] && now - this.lastSent[level] < this.minInterval) return;
    this.lastSent[level] = now;

    if (this.channels.slack && this.shouldNotify('slack', level)) {
      this.channels.slack.send(message).catch((err) => {
        handleError(err, {
          location: 'notifier',
          category: ErrorCategories.CRITICAL,
          metadata: { channel: 'slack', level, message }
        });

        if (this.server.telegramBot && this.shouldNotify('telegram', level)) {
          this.server.telegramBot.broadcastMessage(
            `[Slack Failed] ${message}`
          ).catch((fallbackErr) => {
            handleError(fallbackErr, {
              location: 'notifier',
              category: ErrorCategories.CRITICAL,
              metadata: { channel: 'telegram', reason: 'fallback' }
            });
          });
        }
      });
    }

    if (this.server.telegramBot && this.shouldNotify('telegram', level)) {
      try {
        this.server.telegramBot.broadcastMessage(message);
      } catch (err) {
        handleError(err, {
          location: 'notifier',
          category: ErrorCategories.HIGH,
          metadata: { channel: 'telegram' }
        });
      }
    }
  }

  shouldNotify(channel, level) {
    const filters = this.notifyOn[channel];
    if (!filters || filters.length === 0) return false;
    if (filters.includes('all')) return true;
    return filters.includes(level);
  }

  async testChannel(channel) {
    if (channel === 'slack' && this.channels.slack) {
      return this.channels.slack.test();
    }
    if (channel === 'telegram' && this.server.telegramBot) {
      try {
        this.server.telegramBot.broadcastMessage('KeyProxy notification test — Telegram connected.');
        return true;
      } catch { return false; }
    }
    return false;
  }
}

module.exports = Notifier;
