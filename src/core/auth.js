const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRYPT_PREFIX = '$scrypt$';
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const COST = 16384;
const HASH_FILE = path.join(process.cwd(), 'data', 'admin.hash');

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

  static loadHashFromFile() {
    try {
      if (fs.existsSync(HASH_FILE)) {
        return fs.readFileSync(HASH_FILE, 'utf8').trim();
      }
    } catch {}
    return null;
  }

  static saveHashToFile(hash) {
    const dir = path.dirname(HASH_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(HASH_FILE, hash, { mode: 0o600 });
  }

  static migrateFromEnv(envPassword) {
    if (!envPassword) return false;

    const hash = Auth.isHash(envPassword)
      ? envPassword
      : Auth.hashPassword(envPassword);

    Auth.saveHashToFile(hash);
    return true;
  }

  static removePasswordFromEnv(envPath) {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    const updated = lines.filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('ADMIN_PASSWORD=') || trimmed.startsWith('#');
    });
    fs.writeFileSync(envPath, updated.join('\n'), 'utf8');
  }

  static getAdminPassword(envPassword) {
    const fileHash = Auth.loadHashFromFile();
    if (fileHash) return fileHash;

    if (envPassword) {
      Auth.migrateFromEnv(envPassword);
      Auth.removePasswordFromEnv(path.join(process.cwd(), '.env'));
      const hash = Auth.isHash(envPassword) ? envPassword : Auth.loadHashFromFile();
      return hash || envPassword;
    }

    return null;
  }
}

module.exports = Auth;
