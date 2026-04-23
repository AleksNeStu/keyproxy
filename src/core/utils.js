function maskApiKey(key) {
  if (!key || key.length < 8) return '***';
  return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { maskApiKey, sleep };
