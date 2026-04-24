const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const SlackNotifier = require('../../src/core/slackNotifier');

describe('SlackNotifier', () => {
  let notifier;

  describe('constructor', () => {
    it('creates instance with webhook URL', () => {
      notifier = new SlackNotifier('https://hooks.slack.com/services/T123/B456/abc');
      assert.strictEqual(notifier.webhookUrl, 'https://hooks.slack.com/services/T123/B456/abc');
    });

    it('creates instance without webhook URL', () => {
      notifier = new SlackNotifier(null);
      assert.strictEqual(notifier.webhookUrl, null);
    });

    it('creates instance with empty string webhook URL', () => {
      notifier = new SlackNotifier('');
      assert.strictEqual(notifier.webhookUrl, '');
    });
  });

  describe('send', () => {
    beforeEach(() => {
      // Create notifier with valid webhook URL for testing
      notifier = new SlackNotifier('https://hooks.slack.com/services/T123/B456/abc');
    });

    it('returns false when webhook URL is not set', async () => {
      const noWebhookNotifier = new SlackNotifier(null);
      const result = await noWebhookNotifier.send('test message');
      assert.strictEqual(result, false);
    });

    it('returns false when webhook URL is empty string', async () => {
      const emptyWebhookNotifier = new SlackNotifier('');
      const result = await emptyWebhookNotifier.send('test message');
      assert.strictEqual(result, false);
    });

    it('returns false when webhook URL is undefined', async () => {
      const undefinedWebhookNotifier = new SlackNotifier(undefined);
      const result = await undefinedWebhookNotifier.send('test message');
      assert.strictEqual(result, false);
    });

    it('handles long messages', async () => {
      // This will make an actual HTTP request which will likely fail in test environment
      // The test verifies the structure is correct, not that it sends successfully
      const longMessage = 'A'.repeat(10000);
      // Should not throw
      await notifier.send(longMessage);
    });

    it('handles special characters in messages', async () => {
      // Should not throw
      const specialMessage = 'Test with special chars: !@#$%^&*(){}[]|\\:";\'<>?,./`~';
      await notifier.send(specialMessage);
    });

    it('handles unicode characters in messages', async () => {
      const unicodeMessage = 'Test emoji: 🎉 🔥 ✅ and unicode: 你好 مرحبا';
      await notifier.send(unicodeMessage);
    });

    it('handles empty message', async () => {
      await notifier.send('');
    });

    it('handles null/undefined message gracefully', async () => {
      // These will be converted to string "null" / "undefined" by JSON.stringify
      await notifier.send(null);
      await notifier.send(undefined);
    });
  });

  describe('test', () => {
    it('sends test message', async () => {
      notifier = new SlackNotifier('https://hooks.slack.com/services/T123/B456/abc');

      // Should not throw
      await notifier.test();
    });

    it('returns false when webhook not configured', async () => {
      notifier = new SlackNotifier(null);

      const result = await notifier.test();
      assert.strictEqual(result, false);
    });
  });

  describe('protocol handling', () => {
    it('supports https webhook URLs', () => {
      notifier = new SlackNotifier('https://hooks.slack.com/services/T123/B456/abc');
      assert.strictEqual(notifier.webhookUrl, 'https://hooks.slack.com/services/T123/B456/abc');
    });

    it('supports http webhook URLs', () => {
      notifier = new SlackNotifier('http://hooks.slack.com/services/T123/B456/abc');
      assert.strictEqual(notifier.webhookUrl, 'http://hooks.slack.com/services/T123/B456/abc');
    });
  });

  describe('error handling', () => {
    it('throws on malformed webhook URL in send', async () => {
      // Invalid URL format should throw
      notifier = new SlackNotifier('not-a-valid-url');

      await assert.rejects(
        async () => await notifier.send('test'),
        { name: 'TypeError', code: 'ERR_INVALID_URL' }
      );
    });

    it('throws on webhook URL with invalid port in send', async () => {
      notifier = new SlackNotifier('https://hooks.slack.com:999999/services/T123/B456/abc');

      await assert.rejects(
        async () => await notifier.send('test'),
        { name: 'TypeError', code: 'ERR_INVALID_URL' }
      );
    });
  });
});
