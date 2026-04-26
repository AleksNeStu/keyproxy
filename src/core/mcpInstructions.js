/**
 * Agent Configuration Context Generator
 * Generates comprehensive markdown documentation for configuring AI agents, MCP servers, 
 * API clients, and other tools to use KeyProxy as their API gateway
 */

class AgentContextGenerator {
  constructor(config) {
    this.config = config;
    this.port = process.env.PORT || 8990;
    this.baseUrl = `http://localhost:${this.port}`;
  }

  /**
   * Generate complete agent configuration context for all providers
   */
  generateAllContext() {
    const providers = this.getActiveProviders();
    
    let markdown = `# KeyProxy Agent Configuration Context

**Generated:** ${new Date().toISOString()}  
**KeyProxy URL:** \`${this.baseUrl}\`  
**Admin Panel:** \`${this.baseUrl}/admin\`

## Overview

KeyProxy is a unified API gateway that provides intelligent routing, key management, and monitoring for AI API providers. Use this context to configure AI agents, MCP servers, API clients, and other tools to route their requests through KeyProxy.

### Key Features

- ✅ **Automatic key rotation** — Seamless failover between multiple API keys
- ✅ **Rate limiting protection** — Prevents hitting provider rate limits
- ✅ **Budget tracking** — Monitor and control API spending per key
- ✅ **Health monitoring** — Auto-recovery of failed keys after cooldown
- ✅ **Circuit breaker** — Protects against cascading failures
- ✅ **Response caching** — Reduces costs for repeated requests
- ✅ **Fallback routing** — Cross-provider failover support
- ✅ **Analytics & metrics** — Request tracking, latency monitoring, cost estimation

---

## Quick Start

### For MCP Servers

Add to your MCP configuration file (\`.claude.json\`, \`.kiro/settings/mcp.json\`, etc.):

\`\`\`json
{
  "mcpServers": {
    "my-service": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "some-mcp-package"],
      "env": {
        "OPENAI_API_KEY": "dummy-key-not-used",
        "OPENAI_BASE_URL": "${this.baseUrl}/openai/PROVIDER/v1"
      }
    }
  }
}
\`\`\`

### For API Clients

Configure your API client to use KeyProxy as the base URL:

\`\`\`python
# Python example with OpenAI SDK
from openai import OpenAI

client = OpenAI(
    api_key="dummy-key",  # KeyProxy handles authentication
    base_url="${this.baseUrl}/openai/PROVIDER/v1"
)
\`\`\`

\`\`\`javascript
// JavaScript example with OpenAI SDK
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key',  // KeyProxy handles authentication
  baseURL: '${this.baseUrl}/openai/PROVIDER/v1'
});
\`\`\`

Replace \`PROVIDER\` with one of the available providers below.

---

## Available Providers

`;

    // Add each provider
    providers.forEach(provider => {
      markdown += this.generateProviderSection(provider);
      markdown += '\n---\n\n';
    });

    // Add usage examples
    markdown += this.generateUsageExamples();
    markdown += '\n---\n\n';

    // Add troubleshooting section
    markdown += this.generateTroubleshootingSection();

    return markdown;
  }

  /**
   * Generate context for a specific provider
   */
  generateProviderContext(providerKey) {
    const providers = this.getActiveProviders();
    const provider = providers.find(p => `${p.apiType}_${p.name}` === providerKey);
    
    if (!provider) {
      throw new Error(`Provider ${providerKey} not found`);
    }

    let markdown = `# ${this.formatProviderName(provider.name)} Configuration Context

**Generated:** ${new Date().toISOString()}  
**Provider:** ${provider.name}  
**API Type:** ${provider.apiType.toUpperCase()}  
**KeyProxy URL:** \`${this.baseUrl}\`

`;

    markdown += this.generateProviderSection(provider);
    markdown += '\n\n';
    markdown += this.generateUsageExamples(provider);
    markdown += '\n\n';
    markdown += this.generateTroubleshootingSection();

    return markdown;
  }

  /**
   * Generate provider-specific section
   */
  generateProviderSection(provider) {
    const baseUrl = this.getProviderBaseUrl(provider);
    const models = provider.allowedModels && provider.allowedModels.length > 0 
      ? provider.allowedModels 
      : ['(all models available)'];

    let section = `### ${this.formatProviderName(provider.name)}

**Base URL:** \`${baseUrl}\`  
**API Type:** ${provider.apiType.toUpperCase()}  
**Active Keys:** ${provider.keys.filter(k => !k.disabled).length}  
**Available Models:** ${models.join(', ')}

#### MCP Configuration Example

\`\`\`json
{
  "mcpServers": {
    "${provider.name}-service": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "your-mcp-package"],
      "env": {
        "${provider.apiType === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'}": "dummy-key",
        "${provider.apiType === 'openai' ? 'OPENAI_BASE_URL' : 'GEMINI_BASE_URL'}": "${baseUrl}"${provider.defaultModel ? `,\n        "MODEL": "${provider.defaultModel}"` : ''}
      }
    }
  }
}
\`\`\`

#### cURL Test Example

\`\`\`bash
curl ${baseUrl}${provider.apiType === 'openai' ? '/chat/completions' : '/models'} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer dummy-key" \\
  ${provider.apiType === 'openai' ? `-d '{
    "model": "${provider.defaultModel || 'gpt-3.5-turbo'}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'` : ''}
\`\`\`

#### Use Cases

${this.getProviderUseCases(provider.name)}

`;

    return section;
  }

  /**
   * Get provider base URL
   */
  getProviderBaseUrl(provider) {
    if (provider.apiType === 'openai') {
      return `${this.baseUrl}/openai/${provider.name}/v1`;
    } else if (provider.apiType === 'gemini') {
      return `${this.baseUrl}/gemini/${provider.name}/v1beta`;
    }
    return `${this.baseUrl}/${provider.apiType}/${provider.name}`;
  }

  /**
   * Get provider-specific use cases
   */
  getProviderUseCases(providerName) {
    const useCases = {
      zhipuai: '- GLM-4 and GLM-5 models for Chinese and English tasks\n- Code generation with GLM-Coder\n- Long context processing (up to 128K tokens)',
      groq: '- Ultra-fast inference with Llama 3 models\n- Real-time chat applications\n- Low-latency API calls',
      mistral: '- Mistral 7B and Mixtral models\n- European data residency requirements\n- Cost-effective inference',
      gemini: '- Google Gemini Pro and Flash models\n- Multimodal capabilities (text + images)\n- Large context windows',
      brave: '- Web search integration\n- Real-time information retrieval\n- Search API for agents',
      tavily: '- AI-optimized search results\n- Research and fact-checking\n- Content discovery',
      exa: '- Neural search for code and documentation\n- Semantic code search\n- Repository discovery',
      firecrawl: '- Web scraping and crawling\n- Content extraction\n- Site mapping',
      context7: '- Library documentation lookup\n- Code examples and snippets\n- API reference search',
      jina: '- Document reading and parsing\n- Web content extraction\n- Text embedding generation'
    };

    return useCases[providerName.toLowerCase()] || '- General-purpose API access\n- Custom integrations\n- Development and testing';
  }

  /**
   * Generate usage examples section
   */
  generateUsageExamples(provider = null) {
    const exampleProvider = provider || { apiType: 'openai', name: 'zhipuai', defaultModel: 'glm-4' };
    const baseUrl = this.getProviderBaseUrl(exampleProvider);

    return `## Usage Examples

### MCP Server Configuration

\`\`\`json
{
  "mcpServers": {
    "${exampleProvider.name}-service": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "your-mcp-package"],
      "env": {
        "${exampleProvider.apiType === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'}": "dummy-key",
        "${exampleProvider.apiType === 'openai' ? 'OPENAI_BASE_URL' : 'GEMINI_BASE_URL'}": "${baseUrl}"
      }
    }
  }
}
\`\`\`

### Python API Client

\`\`\`python
from openai import OpenAI

client = OpenAI(
    api_key="dummy-key",
    base_url="${baseUrl}"
)

response = client.chat.completions.create(
    model="${exampleProvider.defaultModel || 'gpt-3.5-turbo'}",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
\`\`\`

### JavaScript/TypeScript API Client

\`\`\`typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key',
  baseURL: '${baseUrl}'
});

const response = await client.chat.completions.create({
  model: '${exampleProvider.defaultModel || 'gpt-3.5-turbo'}',
  messages: [{ role: 'user', content: 'Hello!' }]
});

console.log(response.choices[0].message.content);
\`\`\`

### cURL Command

\`\`\`bash
curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer dummy-key" \\
  -d '{
    "model": "${exampleProvider.defaultModel || 'gpt-3.5-turbo'}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
\`\`\`

### LangChain Integration

\`\`\`python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    api_key="dummy-key",
    base_url="${baseUrl}",
    model="${exampleProvider.defaultModel || 'gpt-3.5-turbo'}"
)

response = llm.invoke("Hello!")
print(response.content)
\`\`\`

`;
  }

  /**
   * Generate troubleshooting section
   */
  generateTroubleshootingSection() {
    return `## Troubleshooting

### Connection Issues

**Problem:** MCP server cannot connect to KeyProxy  
**Solution:** 
1. Verify KeyProxy is running: \`curl ${this.baseUrl}/health\`
2. Check the base URL matches your KeyProxy port
3. Ensure no firewall blocking localhost connections

### Authentication Errors

**Problem:** 401 Unauthorized or 403 Forbidden  
**Solution:**
- KeyProxy handles authentication automatically
- Use any dummy API key (e.g., "dummy-key") in your MCP config
- KeyProxy will use its configured keys internally

### Rate Limiting

**Problem:** 429 Too Many Requests  
**Solution:**
- KeyProxy automatically rotates keys on rate limits
- Check KeyProxy admin panel for key status
- Add more API keys to the provider configuration

### Model Not Available

**Problem:** Model not found or not allowed  
**Solution:**
- Check provider's allowed models in KeyProxy admin panel
- Verify model name matches provider's naming convention
- Some providers may have model restrictions

### Performance Issues

**Problem:** Slow response times  
**Solution:**
- Enable response caching in KeyProxy settings
- Check provider health status in admin panel
- Consider using fallback providers for redundancy

---

## Additional Resources

- **Admin Panel:** ${this.baseUrl}/admin
- **Health Check:** ${this.baseUrl}/health
- **Metrics:** ${this.baseUrl}/metrics
- **Documentation:** Check KeyProxy README.md

---

**Note:** This configuration guide is auto-generated based on your current KeyProxy setup. Provider availability and settings may change. Always verify in the admin panel.
`;
  }

  /**
   * Get active providers from config
   */
  getActiveProviders() {
    const providers = [];
    const envVars = this.config.getEffectiveEnvVars();

    const providerMap = {};

    for (const [key, value] of Object.entries(envVars)) {
      // Match API_TYPE_PROVIDER_API_KEYS pattern
      const keysMatch = key.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_API_KEYS?$/i);
      if (keysMatch && value) {
        const apiType = keysMatch[1].toLowerCase();
        const providerName = keysMatch[2].toLowerCase();
        const providerKey = `${apiType}_${providerName}`;

        if (!providerMap[providerKey]) {
          providerMap[providerKey] = {
            name: providerName,
            apiType: apiType,
            keys: [],
            baseUrl: '',
            defaultModel: '',
            allowedModels: [],
            disabled: false
          };
        }

        const rawKeys = value.split(',').map(k => k.trim()).filter(k => k);
        providerMap[providerKey].keys = rawKeys.map(k => ({
          key: k.startsWith('~') ? k.substring(1) : k,
          disabled: k.startsWith('~')
        }));
      }

      // Match BASE_URL
      const baseUrlMatch = key.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_BASE_URL$/i);
      if (baseUrlMatch && value) {
        const apiType = baseUrlMatch[1].toLowerCase();
        const providerName = baseUrlMatch[2].toLowerCase();
        const providerKey = `${apiType}_${providerName}`;

        if (!providerMap[providerKey]) {
          providerMap[providerKey] = {
            name: providerName,
            apiType: apiType,
            keys: [],
            baseUrl: '',
            defaultModel: '',
            allowedModels: [],
            disabled: false
          };
        }

        providerMap[providerKey].baseUrl = value;
      }

      // Match DEFAULT_MODEL
      const modelMatch = key.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_DEFAULT_MODEL$/i);
      if (modelMatch && value) {
        const apiType = modelMatch[1].toLowerCase();
        const providerName = modelMatch[2].toLowerCase();
        const providerKey = `${apiType}_${providerName}`;

        if (!providerMap[providerKey]) {
          providerMap[providerKey] = {
            name: providerName,
            apiType: apiType,
            keys: [],
            baseUrl: '',
            defaultModel: '',
            allowedModels: [],
            disabled: false
          };
        }

        providerMap[providerKey].defaultModel = value;
      }

      // Match ALLOWED_MODELS
      const allowedModelsMatch = key.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_ALLOWED_MODELS$/i);
      if (allowedModelsMatch && value) {
        const apiType = allowedModelsMatch[1].toLowerCase();
        const providerName = allowedModelsMatch[2].toLowerCase();
        const providerKey = `${apiType}_${providerName}`;

        if (!providerMap[providerKey]) {
          providerMap[providerKey] = {
            name: providerName,
            apiType: apiType,
            keys: [],
            baseUrl: '',
            defaultModel: '',
            allowedModels: [],
            disabled: false
          };
        }

        providerMap[providerKey].allowedModels = value.split(',').map(m => m.trim()).filter(m => m);
      }

      // Match DISABLED
      const disabledMatch = key.match(/^(OPENAI|GEMINI)_([A-Z0-9_]+)_DISABLED$/i);
      if (disabledMatch && value) {
        const apiType = disabledMatch[1].toLowerCase();
        const providerName = disabledMatch[2].toLowerCase();
        const providerKey = `${apiType}_${providerName}`;

        if (!providerMap[providerKey]) {
          providerMap[providerKey] = {
            name: providerName,
            apiType: apiType,
            keys: [],
            baseUrl: '',
            defaultModel: '',
            allowedModels: [],
            disabled: false
          };
        }

        providerMap[providerKey].disabled = value.trim().toLowerCase() === 'true';
      }
    }

    // Filter out disabled providers and those without keys
    return Object.values(providerMap)
      .filter(p => !p.disabled && p.keys.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Format provider name for display
   */
  formatProviderName(name) {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
}

module.exports = AgentContextGenerator;
