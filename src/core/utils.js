function maskApiKey(key) {
  if (!key || key.length < 8) return '***';
  return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ts() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

module.exports = { maskApiKey, sleep, ts, fmtMs, fmtBytes };
