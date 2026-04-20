const fs = require('fs');
const path = require('path');

/**
 * File Sync Destination
 * Maintains a .env file with current active keys
 */
class FileSync {
  constructor(filePath = '.active_keys.env') {
    this.filePath = path.resolve(process.cwd(), filePath);
    this.activeKeys = new Map(); // name -> key
    this.lastWriteHash = null;
  }

  /**
   * Synchronize the key to the local file
   * @param {string} name 
   * @param {string} key 
   */
  async syncIfChanged(name, key) {
    if (!name || !key) return;
    
    // Only update if changed
    if (this.activeKeys.get(name) === key) return;
    
    this.activeKeys.set(name, key);
    await this.writeFile();
  }

  /**
   * Writes the current mapped keys to the file
   */
  async writeFile() {
    try {
      let content = '# KeyProxy: Active Healthy Keys (Auto-generated)\n';
      content += '# Sourced at: ' + new Date().toISOString() + '\n\n';

      for (const [name, key] of this.activeKeys.entries()) {
        content += `${name}="${key}"\n`;
      }

      fs.writeFileSync(this.filePath, content, 'utf8');
      
      const maskedPath = path.basename(this.filePath);
      console.log(`[SYNC-FILE] Updated active keys file: ${maskedPath}`);
    } catch (error) {
      console.error(`[SYNC-FILE] Failed to write active keys file:`, error.message);
    }
  }
}

module.exports = FileSync;
