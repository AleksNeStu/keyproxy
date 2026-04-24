# Agent Context Copy Feature

## Overview

The **Agent Context** feature provides AI agents with comprehensive configuration instructions for integrating with KeyProxy. This eliminates manual configuration errors and speeds up agent setup.

## Features

### Per-Provider Context
- Click "Agent Context" button next to any provider
- Generates provider-specific configuration
- Includes:
  - MCP server configuration
  - API client examples (Python, JavaScript)
  - cURL commands
  - LangChain integration
  - Provider-specific use cases

### Global Context
- Click "Copy All Agent Context" button
- Generates complete configuration for all providers
- Includes:
  - Overview of KeyProxy features
  - Quick start guides
  - All provider configurations
  - Usage examples
  - Troubleshooting guide

## Usage

### For AI Agents (Claude, Kiro, etc.)

1. Open KeyProxy admin panel: `http://localhost:8990/admin`
2. Navigate to "API Keys" tab
3. Click "Copy All Agent Context" button
4. Paste into agent chat with instruction:
   ```
   Use this KeyProxy configuration context to help me set up my MCP servers / API clients
   ```

### For Specific Provider

1. Find the provider in the list
2. Click "Agent Context" button next to provider name
3. Paste into agent chat or save to file

## Generated Content Structure

```markdown
# KeyProxy Agent Configuration Context

## Overview
- KeyProxy features and benefits
- Quick start instructions

## Available Providers
### Provider Name
- Base URL
- API Type
- Active Keys
- Available Models
- MCP Configuration Example
- cURL Test Example
- Use Cases

## Usage Examples
- MCP Server Configuration
- Python API Client
- JavaScript/TypeScript API Client
- cURL Command
- LangChain Integration

## Troubleshooting
- Connection Issues
- Authentication Errors
- Rate Limiting
- Model Not Available
- Performance Issues
```

## Integration Examples

### MCP Server (Claude Desktop)

```json
{
  "mcpServers": {
    "zhipuai-service": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "your-mcp-package"],
      "env": {
        "OPENAI_API_KEY": "dummy-key",
        "OPENAI_BASE_URL": "http://localhost:8990/openai/zhipuai/v1"
      }
    }
  }
}
```

### Python API Client

```python
from openai import OpenAI

client = OpenAI(
    api_key="dummy-key",
    base_url="http://localhost:8990/openai/zhipuai/v1"
)

response = client.chat.completions.create(
    model="glm-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

### JavaScript API Client

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key',
  baseURL: 'http://localhost:8990/openai/zhipuai/v1'
});

const response = await client.chat.completions.create({
  model: 'glm-4',
  messages: [{ role: 'user', content: 'Hello!' }]
});
```

## Benefits

✅ **Eliminates manual configuration errors** — Copy-paste ready examples  
✅ **Speeds up agent setup** — Complete context in one click  
✅ **Supports multiple integration methods** — MCP, SDK, cURL, LangChain  
✅ **Provider-specific guidance** — Tailored use cases and examples  
✅ **Always up-to-date** — Generated from current KeyProxy configuration  
✅ **Troubleshooting included** — Common issues and solutions  

## API Endpoint

**GET** `/admin/api/agent-context`

**Query Parameters:**
- `provider` (optional) - Provider key in format `apiType_providerName` (e.g., `openai_zhipuai`)

**Response:**
- Content-Type: `text/markdown`
- Returns markdown documentation

**Examples:**
```bash
# Get all providers context
curl http://localhost:8990/admin/api/agent-context

# Get specific provider context
curl http://localhost:8990/admin/api/agent-context?provider=openai_zhipuai
```

## Use Cases

### 1. Setting up MCP Servers
Copy context and paste into `.claude.json` or `.kiro/settings/mcp.json`

### 2. Configuring API Clients
Use Python/JavaScript examples to integrate KeyProxy into your applications

### 3. Testing Providers
Use cURL commands to verify provider connectivity

### 4. LangChain Integration
Copy LangChain examples for AI application development

### 5. Documentation
Save context as reference documentation for your team

## Tips

- **For new users**: Use "Copy All Agent Context" to get complete overview
- **For specific tasks**: Use per-provider context for focused configuration
- **For troubleshooting**: Context includes common issues and solutions
- **For teams**: Share context as onboarding documentation

## Related Features

- [MCP Configuration](./MCP_CONFIGURATION.md)
- [API Client Setup](./API_CLIENT_SETUP.md)
- [Provider Management](./PROVIDER_MANAGEMENT.md)
