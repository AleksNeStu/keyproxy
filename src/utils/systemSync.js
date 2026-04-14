const { exec } = require('child_process');

/**
 * Utility to sync API keys to Windows System Environment Variables
 */
class SystemSync {
  /**
   * Updates a Windows User Environment Variable using PowerShell
   * @param {string} name The variable name (e.g. GEMINI_API_KEY)
   * @param {string} value The value to set
   * @returns {Promise<void>}
   */
  static async setEnvVar(name, value) {
    if (process.platform !== 'win32') {
      // console.log(`[SYSTEM-SYNC] Skip: Not on Windows`);
      return;
    }

    if (!name || !value) return;

    return new Promise((resolve, reject) => {
      // Logic: [System.Environment]::SetEnvironmentVariable(name, value, 'User')
      // Note: We use 'User' scope so we don't need Admin privileges
      const script = `[System.Environment]::SetEnvironmentVariable('${name}', '${value}', 'User')`;
      const command = `powershell -Command "${script}"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`[SYSTEM-SYNC] Error updating env var ${name}:`, error.message);
          return reject(error);
        }
        console.log(`[SYSTEM-SYNC] Successfully updated Windows User Env Var: ${name}`);
        resolve();
      });
    });
  }

  /**
   * Helper to derive the system env var name from provider name
   * @param {string} providerName 
   * @returns {string} e.g. gemini -> GEMINI_API_KEY
   */
  static deriveEnvName(providerName) {
    if (!providerName) return null;
    return `${providerName.toUpperCase()}_API_KEY`;
  }
}

module.exports = SystemSync;
