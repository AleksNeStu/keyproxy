const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Windows Environment Destination
 * Handles persistence of API keys into Windows System Environment Variables
 */
class WindowsEnv {
  /**
   * Sets a persistent environment variable using 'setx'
   * @param {string} name Variable name (e.g., OPENAI_API_KEY)
   * @param {string} value API Key value
   */
  static async setEnvVar(name, value) {
    if (!name || !value) return;

    try {
      // Use setx to set the variable persistently in the user environment
      // We use /M only if we had admin rights, but for now user scope is safer and standard
      const command = `setx ${name} "${value}"`;
      
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr && !stderr.includes('SUCCESS')) {
        console.error(`[SYNC-WIN] Error setting ${name}:`, stderr);
        throw new Error(stderr);
      }

      const maskedValue = value.substring(0, 4) + '...' + value.substring(value.length - 4);
      console.log(`[SYNC-WIN] Successfully updated system variable: ${name} = ${maskedValue}`);
      return true;
    } catch (error) {
      console.error(`[SYNC-WIN] Failed to sync ${name} to Windows Environment:`, error.message);
      throw error;
    }
  }

  /**
   * Quick check if the current platform is Windows
   */
  static isWindows() {
    return process.platform === 'win32';
  }
}

module.exports = WindowsEnv;
