/**
 * Admin Agent Context Routes
 */

const { sendError, sendResponse } = require('./httpHelpers');
const AgentContextGenerator = require('../core/mcpInstructions');

/**
 * GET /admin/api/agent-context
 * Query params: provider (optional) - specific provider key like "openai_zhipuai"
 * Returns markdown context for configuring AI agents, MCP servers, and API clients
 */
async function handleGetAgentContext(server, res, params) {
  try {
    const generator = new AgentContextGenerator(server.config);
    const providerKey = params?.provider;

    let markdown;
    if (providerKey) {
      // Generate context for specific provider
      try {
        markdown = generator.generateProviderContext(providerKey);
      } catch (error) {
        return sendError(res, 404, `Provider ${providerKey} not found`);
      }
    } else {
      // Generate context for all providers
      markdown = generator.generateAllContext();
    }

    res.writeHead(200, { 
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': providerKey 
        ? `attachment; filename="agent-context-${providerKey}.md"`
        : 'attachment; filename="agent-context-all.md"'
    });
    res.end(markdown);
  } catch (error) {
    console.error('[Agent Context] Error generating context:', error);
    sendError(res, 500, 'Failed to generate agent context');
  }
}

module.exports = {
  handleGetAgentContext
};
