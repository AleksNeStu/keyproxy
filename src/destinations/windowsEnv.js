const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Windows Environment Destination
 * Handles persistence of API keys into Windows System Environment Variables
 */
class WindowsEnv {
  /**
   * Destination Manager Interface
   * @param {string} name 
   * @param {string} value 
   */
  async syncIfChanged(name, value) {
    // Note: Destinations handle their own 'change' detection if needed, 
    // but the rotator also checks it. For Windows Env, we just set it.
    return this.setEnvVar(name, value);
  }

  /**
   * Sets a persistent environment variable using 'setx'
   * @param {string} name Variable name (e.g., OPENAI_API_KEY)
   * @param {string} value API Key value
   */
  async setEnvVar(name, value) {
    if (!name || !value) return;

    try {
      // Use setx to set the variable persistently in the user environment
      const command = `setx ${name} "${value}"`;
      
      const { stderr } = await execAsync(command);
      
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
  isWindows() {
    return process.platform === 'win32';
  }

  /**
   * Helper to derive the system env var name from provider name
   * @param {string} providerName 
   * @returns {string} e.g. gemini -> GEMINI_API_KEY
   */
  deriveEnvName(providerName) {
    if (!providerName) return null;
    return `${providerName.toUpperCase()}_API_KEY`;
  }
}

module.exports = new WindowsEnv();
