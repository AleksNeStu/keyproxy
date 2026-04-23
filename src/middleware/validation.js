/**
 * Input Validation Middleware
 *
 * Provides Joi-based validation schemas and middleware for all admin API endpoints.
 * Prevents injection attacks, ensures data integrity, and provides clear error messages.
 */

const Joi = require('joi');

// Common validators
const providerNameSchema = Joi.string().alphanum().min(1).max(50).required();
const apiTypeSchema = Joi.string().valid('OPENAI', 'GEMINI', 'ANTHROPIC', 'GROQ', 'OPENROUTER').required();
const keyIndexSchema = Joi.number().integer().min(0).required();
const booleanSchema = Joi.boolean().required();

// Validation schemas for each endpoint
const schemas = {
  // Key management
  toggleKey: Joi.object({
    apiType: apiTypeSchema,
    providerName: providerNameSchema,
    keyIndex: keyIndexSchema,
    disabled: booleanSchema
  }),

  // Virtual keys
  createVirtualKey: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    allowedProviders: Joi.array().items(apiTypeSchema).min(1).required(),
    allowedModels: Joi.array().items(Joi.string().min(1).max(100)).min(1).required(),
    rateLimit: Joi.number().integer().min(1).max(10000).default(60),
    expiry: Joi.date().iso().greater('now').optional()
  }),

  toggleVirtualKey: Joi.object({
    disabled: booleanSchema
  }),

  // Budgets
  setBudget: Joi.object({
    keyHash: Joi.string().length(64).hex().required(),
    dailyBudget: Joi.number().min(0).optional(),
    monthlyBudget: Joi.number().min(0).optional()
  }).or('dailyBudget', 'monthlyBudget'),

  // Notifications
  updateNotifications: Joi.object({
    slackWebhookUrl: Joi.string().uri().allow('').optional(),
    telegramNotifyOn: Joi.array().items(Joi.string().valid('health', 'key_failure', 'recovery')).optional(),
    slackNotifyOn: Joi.array().items(Joi.string().valid('health', 'key_failure', 'recovery')).optional()
  }),

  // Settings
  updateSettings: Joi.object({
    cacheEnabled: booleanSchema.optional(),
    cacheTtl: Joi.number().integer().min(1).max(86400).optional(),
    cacheMaxEntries: Joi.number().integer().min(1).max(10000).optional(),
    cbThreshold: Joi.number().integer().min(1).max(100).optional(),
    cbTimeout: Joi.number().integer().min(1).max(3600).optional()
  }),

  // Retry config
  updateRetryConfig: Joi.object({
    maxRetries: Joi.number().integer().min(0).max(10).required(),
    retryDelay: Joi.number().integer().min(100).max(60000).required()
  }),

  // Environment
  updateEnv: Joi.object({
    key: Joi.string().pattern(/^[A-Z_][A-Z0-9_]*$/).min(1).max(100).required(),
    value: Joi.string().max(10000).allow('').required()
  }),

  // Password change
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).max(100)
      .pattern(/[A-Z]/, { name: 'uppercase' })
      .pattern(/[a-z]/, { name: 'lowercase' })
      .pattern(/[0-9]/, { name: 'number' })
      .pattern(/[!@#$%^&*(),.?":{}|<>]/, { name: 'special' })
      .required()
      .messages({
        'string.pattern.name': 'Password must contain at least one {#name} character'
      })
  }),

  // Circuit breaker
  circuitBreakerAction: Joi.object({
    action: Joi.string().valid('open', 'close', 'reset').required()
  }),

  // Fallbacks
  setFallback: Joi.object({
    providerType: apiTypeSchema,
    fallbackProvider: apiTypeSchema,
    fallbackModel: Joi.string().min(1).max(100).optional()
  }),

  // Cache config
  cacheConfig: Joi.object({
    enabled: booleanSchema.optional(),
    ttl: Joi.number().integer().min(1).max(86400).optional(),
    maxEntries: Joi.number().integer().min(1).max(10000).optional()
  }),

  // Analytics
  analyticsQuery: Joi.object({
    startDate: Joi.date().iso().optional(),
    endDate: Joi.date().iso().optional(),
    provider: apiTypeSchema.optional()
  })
};

/**
 * Middleware factory for request body validation.
 * @param {string} schemaName - Name of the schema to use
 * @returns {Function} Express middleware
 */
function validateBody(schemaName) {
  return (req, res, next) => {
    const schema = schemas[schemaName];
    if (!schema) {
      console.error(`[VALIDATION] Schema not found: ${schemaName}`);
      return sendError(res, 400, 'Validation configuration error');
    }

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(d => d.message).join('; ');
      console.log(`[VALIDATION] Failed for ${req.method} ${req.url}: ${details}`);
      return sendError(res, 400, `Validation error: ${details}`);
    }

    // Replace body with sanitized value
    req.body = value;
    next();
  };
}

/**
 * Middleware factory for query parameter validation.
 * @param {Object} schema - Joi schema for query params
 * @returns {Function} Express middleware
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const details = error.details.map(d => d.message).join('; ');
      console.log(`[VALIDATION] Query validation failed for ${req.method} ${req.url}: ${details}`);
      return sendError(res, 400, `Query validation error: ${details}`);
    }

    req.query = value;
    next();
  };
}

/**
 * Middleware to limit request body size.
 * @param {number} maxSize - Maximum size in bytes (default: 1MB)
 * @returns {Function} Express middleware
 */
function limitBodySize(maxSize = 1024 * 1024) {
  return (req, res, next) => {
    let contentLength = 0;

    req.on('data', (chunk) => {
      contentLength += chunk.length;
      if (contentLength > maxSize) {
        console.log(`[SECURITY] Request body too large: ${contentLength} bytes`);
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request entity too large' }));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (contentLength <= maxSize) {
        next();
      }
    });
  };
}

/**
 * Send error response.
 */
function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Password strength validator.
 * @param {string} password - Password to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validatePasswordStrength(password) {
  const errors = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (password.length > 100) {
    errors.push('Password must not exceed 100 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Common weak passwords
  const weakPasswords = ['password', 'Password1', '12345678', 'qwerty123', 'admin123'];
  if (weakPasswords.some(weak => password.toLowerCase().includes(weak.toLowerCase()))) {
    errors.push('Password is too common');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  schemas,
  validateBody,
  validateQuery,
  limitBodySize,
  validatePasswordStrength
};
