/**
 * Provider pricing tables for cost estimation.
 * Prices in USD per 1M tokens.
 */

const PRICING = {
  openai: {
    default: { input: 5.0, output: 15.0 },
    models: {
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'gpt-4-turbo': { input: 10.0, output: 30.0 },
      'gpt-4': { input: 30.0, output: 60.0 },
      'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
      'o1': { input: 15.0, output: 60.0 },
      'o1-mini': { input: 3.0, output: 12.0 },
      'o3-mini': { input: 1.1, output: 4.4 },
    }
  },
  gemini: {
    default: { input: 1.25, output: 5.0 },
    models: {
      'gemini-2.0-flash': { input: 0.1, output: 0.4 },
      'gemini-2.0-flash-lite': { input: 0.075, output: 0.3 },
      'gemini-1.5-flash': { input: 0.075, output: 0.3 },
      'gemini-1.5-pro': { input: 1.25, output: 5.0 },
    }
  },
  anthropic: {
    default: { input: 3.0, output: 15.0 },
    models: {
      'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
      'claude-haiku-4-20250506': { input: 1.0, output: 5.0 },
      'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },
    }
  },
  groq: {
    default: { input: 0.59, output: 0.79 },
    models: {
      'llama-3.3-70b': { input: 0.59, output: 0.79 },
      'mixtral-8x7b': { input: 0.24, output: 0.24 },
    }
  }
};

/**
 * Estimate cost for a request based on provider, model, and token counts.
 * @param {string} apiType - Provider type (openai, gemini, etc.)
 * @param {string} model - Model identifier
 * @param {number} inputTokens - Estimated input token count
 * @param {number} outputTokens - Estimated output token count
 * @returns {{ inputCost: number, outputCost: number, totalCost: number, pricing: {input:number,output:number} }}
 */
function estimateCost(apiType, model, inputTokens, outputTokens) {
  const providerPricing = PRICING[apiType] || PRICING.openai;

  let pricing = providerPricing.default;
  if (model && providerPricing.models) {
    for (const [key, p] of Object.entries(providerPricing.models)) {
      if (model.includes(key) || key.includes(model)) {
        pricing = p;
        break;
      }
    }
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    pricing
  };
}

/**
 * Rough token estimate from string length.
 * ~4 chars per token for English text.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Extract model name from request body or path.
 */
function extractModel(body, path) {
  if (!body) return null;
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) : body;
    if (parsed.model) return parsed.model;
  } catch {}
  if (path) {
    const match = path.match(/models\/([^:/]+)/);
    if (match) return match[1];
  }
  return null;
}

module.exports = { PRICING, estimateCost, estimateTokens, extractModel };
