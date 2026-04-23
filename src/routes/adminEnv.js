/**
 * Admin environment management route handlers.
 * Env vars, env files, settings, retry config.
 */

const fs = require('fs');
const path = require('path');
const { sendError } = require('./httpHelpers');

/**
 * GET /admin/api/env — retrieve effective environment variables.
 */
async function handleGetEnvVars(server, res) {
  try {
    const envVars = server.config.getEffectiveEnvVars();
    const localEnvPath = path.join(process.cwd(), '.env');
    const rootEnvPath = envVars.EXTERNAL_ENV_PATH
      ? path.resolve(process.cwd(), envVars.EXTERNAL_ENV_PATH)
      : path.resolve(process.cwd(), '../../.env');
    const envPath = fs.existsSync(rootEnvPath) ? rootEnvPath : localEnvPath;

    // Don't send sensitive config to UI
    const safeEnv = {
      vars: { ...envVars },
      envPath: envPath
    };

    delete safeEnv.vars.ADMIN_PASSWORD;
    delete safeEnv.vars.TELEGRAM_BOT_TOKEN;
    delete safeEnv.vars.TELEGRAM_ALLOWED_USERS;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(safeEnv));
  } catch (error) {
    sendError(res, 500, 'Failed to retrieve effective environment variables');
  }
}

/**
 * GET /admin/api/env-file — read raw .env file content.
 */
async function handleGetEnvFile(server, res) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf8');

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(envContent);
  } catch (error) {
    sendError(res, 500, 'Failed to read .env file');
  }
}

/**
 * POST /admin/api/env — update environment variables.
 */
async function handleUpdateEnvVars(server, req, res, body) {
  try {
    const envVars = JSON.parse(body);
    const envPath = path.join(process.cwd(), '.env');

    // Read current env to preserve admin password and disabled states
    const currentEnvContent = fs.readFileSync(envPath, 'utf8');
    const currentEnvVars = server.config.parseEnvFile(currentEnvContent);

    // Merge with new vars but preserve admin password
    const finalEnvVars = { ...envVars };
    if (currentEnvVars.ADMIN_PASSWORD) {
      finalEnvVars.ADMIN_PASSWORD = currentEnvVars.ADMIN_PASSWORD;
    }

    // Preserve _DISABLED, TELEGRAM_, and DEFAULT_STATUS_CODES entries from current env if not in new vars
    for (const [key, value] of Object.entries(currentEnvVars)) {
      if ((key.endsWith('_DISABLED') || key.startsWith('TELEGRAM_') || key === 'DEFAULT_STATUS_CODES' || key === 'KEEP_ALIVE_MINUTES') && !(key in finalEnvVars)) {
        finalEnvVars[key] = value;
      }
    }

    server.writeEnvFile(finalEnvVars);
    server.config.loadConfig();
    server.reinitializeClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to update environment variables');
  }
}

/**
 * POST /admin/api/settings — update settings (e.g. EXTERNAL_ENV_PATH).
 */
async function handleUpdateSettings(server, req, res, body) {
  try {
    const settings = JSON.parse(body);
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    const envVars = server.config.parseEnvFile(envContent);

    if (settings.EXTERNAL_ENV_PATH !== undefined) {
      if (settings.EXTERNAL_ENV_PATH.trim() === '') {
        delete envVars.EXTERNAL_ENV_PATH;
      } else {
        envVars.EXTERNAL_ENV_PATH = settings.EXTERNAL_ENV_PATH;
      }
    }

    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to update settings: ' + error.message);
  }
}

/**
 * POST /admin/api/reload — reload config and reinitialize clients.
 */
async function handleReloadConfig(server, req, res) {
  try {
    server.config.loadConfig();
    server.reinitializeClients();
    const providers = [];
    for (const [name, config] of server.config.getProviders().entries()) {
      providers.push({ name, apiType: config.apiType, keyCount: config.keys.length, baseUrl: config.baseUrl });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, providers }));
  } catch (error) {
    sendError(res, 500, 'Failed to reload config: ' + error.message);
  }
}

/**
 * GET /admin/api/retry-config — get retry configuration.
 */
async function handleGetRetryConfig(server, res) {
  try {
    const globalConfig = server.config.getRetryConfig();
    const perProvider = {};
    for (const [name] of server.config.getProviders().entries()) {
      perProvider[name] = server.config.getRetryConfig(name);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ global: globalConfig, perProvider }));
  } catch (error) {
    sendError(res, 500, 'Failed to get retry config: ' + error.message);
  }
}

/**
 * POST /admin/api/retry-config — update retry configuration.
 */
async function handleUpdateRetryConfig(server, req, res, body) {
  try {
    const data = JSON.parse(body);
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    const envVars = server.config.parseEnvFile(envContent);

    // Global settings
    if (data.global) {
      if (data.global.maxRetries !== undefined) envVars.KEYPROXY_MAX_RETRIES = String(data.global.maxRetries);
      if (data.global.retryDelayMs !== undefined) envVars.KEYPROXY_RETRY_DELAY_MS = String(data.global.retryDelayMs);
      if (data.global.retryBackoff !== undefined) envVars.KEYPROXY_RETRY_BACKOFF = String(data.global.retryBackoff);
    }

    // Per-provider overrides
    if (data.perProvider) {
      // Clear existing per-provider retry settings
      for (const key of Object.keys(envVars)) {
        if (key.endsWith('_MAX_RETRIES') && !key.startsWith('KEYPROXY_')) delete envVars[key];
        if (key.endsWith('_RETRY_DELAY_MS') && !key.startsWith('KEYPROXY_')) delete envVars[key];
        if (key.endsWith('_RETRY_BACKOFF') && !key.startsWith('KEYPROXY_')) delete envVars[key];
      }
      for (const [prov, settings] of Object.entries(data.perProvider)) {
        const provUpper = prov.toUpperCase();
        if (settings.maxRetries !== undefined && settings.maxRetries !== null) {
          envVars[`${provUpper}_MAX_RETRIES`] = String(settings.maxRetries);
        }
        if (settings.retryDelayMs !== undefined && settings.retryDelayMs !== null) {
          envVars[`${provUpper}_RETRY_DELAY_MS`] = String(settings.retryDelayMs);
        }
        if (settings.retryBackoff !== undefined && settings.retryBackoff !== null) {
          envVars[`${provUpper}_RETRY_BACKOFF`] = String(settings.retryBackoff);
        }
      }
    }

    server.writeEnvFile(envVars);
    server.config.loadConfig();
    server.reinitializeClients();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (error) {
    sendError(res, 500, 'Failed to update retry config: ' + error.message);
  }
}

/**
 * GET /admin/api/env-files — list configured env files.
 */
async function handleGetEnvFiles(server, res) {
  try {
    const data = server.config.getEnvFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  } catch (error) {
    sendError(res, 500, 'Failed to get env files: ' + error.message);
  }
}

/**
 * POST /admin/api/env-files — add an env file.
 */
async function handleAddEnvFile(server, req, res, body) {
  try {
    const { name, path: filePath } = JSON.parse(body);
    if (!name || !filePath) {
      sendError(res, 400, 'Missing name or path');
      return;
    }
    if (!fs.existsSync(filePath)) {
      sendError(res, 400, 'File does not exist: ' + filePath);
      return;
    }
    server.config.addEnvFile(name, filePath);
    const data = server.config.getEnvFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (error) {
    sendError(res, 500, 'Failed to add env file: ' + error.message);
  }
}

/**
 * DELETE /admin/api/env-files — remove an env file.
 */
async function handleRemoveEnvFile(server, req, res, body) {
  try {
    const { name } = JSON.parse(body);
    if (!name) {
      sendError(res, 400, 'Missing name');
      return;
    }
    server.config.removeEnvFile(name);
    const data = server.config.getEnvFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (error) {
    sendError(res, 500, 'Failed to remove env file: ' + error.message);
  }
}

/**
 * POST /admin/api/switch-env — switch active environment.
 */
async function handleSwitchEnv(server, req, res, body) {
  try {
    const { name } = JSON.parse(body);
    if (!name) {
      sendError(res, 400, 'Missing env name');
      return;
    }
    server.config.setActiveEnv(name);
    server.reinitializeClients();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      providers: server.getProviderStats()
    }));
  } catch (error) {
    sendError(res, 500, 'Failed to switch env: ' + error.message);
  }
}

/**
 * POST /admin/api/reorder-env-files — reorder env files.
 */
async function handleReorderEnvFiles(server, req, res, body) {
  try {
    const { names } = JSON.parse(body);
    if (!Array.isArray(names)) {
      sendError(res, 400, 'Missing names array');
      return;
    }
    server.config.reorderEnvFiles(names);
    const data = server.config.getEnvFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (error) {
    sendError(res, 500, 'Failed to reorder env files: ' + error.message);
  }
}

/**
 * POST /admin/api/toggle-env-file-disabled — toggle env file enabled/disabled.
 */
async function handleToggleEnvFileDisabled(server, req, res, body) {
  try {
    const { name } = JSON.parse(body);
    if (!name) {
      sendError(res, 400, 'Missing name');
      return;
    }
    server.config.toggleEnvFileDisabled(name);
    const data = server.config.getEnvFiles();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...data }));
  } catch (error) {
    sendError(res, 500, 'Failed to toggle env file: ' + error.message);
  }
}

/**
 * GET|POST /admin/api/select-env — open file picker for .env selection.
 */
async function handleSelectEnv(server, req, res) {
  try {
    const { exec } = require('child_process');
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.TopMost = $true
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = "Env files (*.env)|*.env|All files (*.*)|*.*"
$f.Title = "Select global .env file"
$result = $f.ShowDialog($form)
if ($result -eq 'OK') { Write-Output $f.FileName }
$form.Dispose()
`;
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');

    exec(`powershell -NoProfile -STA -EncodedCommand ${encoded}`, (error, stdout) => {
      const selectedPath = stdout ? stdout.trim() : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: selectedPath || null }));
    });
  } catch (error) {
    sendError(res, 500, 'Failed to launch file picker: ' + error.message);
  }
}

module.exports = {
  handleGetEnvVars,
  handleGetEnvFile,
  handleUpdateEnvVars,
  handleUpdateSettings,
  handleReloadConfig,
  handleGetRetryConfig,
  handleUpdateRetryConfig,
  handleGetEnvFiles,
  handleAddEnvFile,
  handleRemoveEnvFile,
  handleSwitchEnv,
  handleReorderEnvFiles,
  handleToggleEnvFileDisabled,
  handleSelectEnv
};
