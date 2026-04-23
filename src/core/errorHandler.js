/**
 * Centralized Error Handler
 *
 * Provides error categorization and consistent logging across the application.
 * Replaces silent catch blocks with proper error visibility.
 */

/**
 * Error categories for determining logging level and notification behavior.
 */
const ErrorCategories = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
};

/**
 * Handle errors with appropriate logging level based on severity.
 * @param {Error} error - The error object
 * @param {Object} context - { location, category, userVisible, metadata }
 */
function handleError(error, context = {}) {
  const {
    location = 'unknown',
    category = ErrorCategories.MEDIUM,
    userVisible = false,
    metadata = {}
  } = context;

  const logLevel = category === ErrorCategories.CRITICAL ? 'error' :
                   category === ErrorCategories.HIGH ? 'warn' : 'debug';

  const prefix = `[ERROR-${location.toUpperCase()}]`;
  const message = error?.message || String(error);

  console[logLevel](`${prefix} ${message}`, Object.keys(metadata).length > 0 ? metadata : '');

  // Track metrics if available
  if (global.metrics || (typeof window !== 'undefined' && window.metrics)) {
    const metrics = global.metrics || (typeof window !== 'undefined' && window.metrics);
    if (metrics?.incCounter) {
      metrics.incCounter('keyproxy_errors_total', {
        location: location,
        category: category
      });
    }
  }

  // Notify for critical errors
  if (category === ErrorCategories.CRITICAL && global.notifier) {
    global.notifier.send(`${prefix} ${message}`, 'failures');
  }
}

/**
 * Categorize an error based on type and location.
 * @param {Error} error - Error object
 * @param {string} location - Where error occurred
 * @returns {string} Error category
 */
function categorizeError(error, location) {
  if (!error) return ErrorCategories.LOW;

  const msg = error?.message?.toLowerCase() || '';

  // Notification system failures
  if (location.includes('notifier') || location.includes('slack')) {
    return ErrorCategories.CRITICAL;
  }

  // Provider/client failures
  if (location.includes('provider') || location.includes('client')) {
    return ErrorCategories.HIGH;
  }

  // File operations
  if (location.includes('fs') || location.includes('file') || location.includes('admin')) {
    return ErrorCategories.HIGH;
  }

  // Network/timeout issues
  if (msg.includes('timeout') || msg.includes('network') || msg.includes('etimedout')) {
    return ErrorCategories.MEDIUM;
  }

  // Expected failures (validation, auth)
  if (msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('validation')) {
    return ErrorCategories.LOW;
  }

  return ErrorCategories.MEDIUM;
}

/**
 * Categorize HTTP status codes.
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @returns {string} Error category
 */
function categorizeHttpError(statusCode, message) {
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode === 429) return 'rate_limit';
  if (statusCode >= 400 && statusCode < 500) return 'client_error';
  if (statusCode >= 500) return 'server_error';
  return 'unknown';
}

module.exports = {
  handleError,
  categorizeError,
  categorizeHttpError,
  ErrorCategories
};
