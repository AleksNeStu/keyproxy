const crypto = require('crypto');

const SCRYPT_PREFIX = '$scrypt$';
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const COST = 16384;

class Auth {
  static hashPassword(password) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const hash = crypto.scryptSync(password, salt, KEY_LENGTH, { N: COST });
    return `${SCRYPT_PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
  }

  static verifyPassword(input, stored) {
    if (!stored || !input) return false;

    if (stored.startsWith(SCRYPT_PREFIX)) {
      const parts = stored.substring(SCRYPT_PREFIX.length).split('$');
      if (parts.length !== 2) return false;

      const salt = Buffer.from(parts[0], 'hex');
      const expectedHash = Buffer.from(parts[1], 'hex');
      const hash = crypto.scryptSync(input, salt, KEY_LENGTH, { N: COST });

      try {
        return crypto.timingSafeEqual(hash, expectedHash);
      } catch {
        return false;
      }
    }

    return input === stored;
  }

  static isHash(value) {
    return typeof value === 'string' && value.startsWith(SCRYPT_PREFIX);
  }
}

module.exports = Auth;
