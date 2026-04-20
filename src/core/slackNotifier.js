const https = require('https');
const http = require('http');

class SlackNotifier {
  constructor(webhookUrl) {
    this.webhookUrl = webhookUrl;
  }

  async send(message) {
    if (!this.webhookUrl) return false;

    return new Promise((resolve) => {
      const payload = JSON.stringify({ text: message });
      const url = new URL(this.webhookUrl);
      const mod = url.protocol === 'https:' ? https : http;

      const req = mod.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(res.statusCode === 200));
      });

      req.on('error', (err) => {
        console.error('[SLACK] Send failed:', err.message);
        resolve(false);
      });

      req.write(payload);
      req.end();
    });
  }

  async test() {
    return this.send('KeyProxy notification test — Slack channel connected.');
  }
}

module.exports = SlackNotifier;
