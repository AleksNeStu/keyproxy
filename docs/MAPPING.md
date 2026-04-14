# 🗺️ KeyProxy Service Mapping Documentation

KeyProxy functions as a **Transparent Multi-API Proxy**. It allows you to use multiple AI and scraping services through a single local endpoint while handling automatic key rotation and rate-limit recovery.

## 🚀 Routing Logic

KeyProxy uses a simple, predictable routing pattern to determine which upstream service to call:

`http://localhost:8990/{provider_name}/{API_PATH}`

- **`{provider_name}`**: A unique identifier defined in your environment configuration.
- **`{API_PATH}`**: The standard path of the target API (e.g., `/v1/chat/completions`).

### 🔄 Dynamic Discovery

KeyProxy automatically discovers providers based on the environment variables in your root `.env` file (`nest-solo/.env`). You don't need to register providers in code; just add the keys following the naming convention.

---

## 🔑 Key Discovery Patterns

To enable a provider, add environment variables using the following patterns:

### 1. General Pattern
`{API_TYPE}_{PROVIDER_NAME}_API_KEY_{N}`

- **`API_TYPE`**: Either `GEMINI` or `OPENAI` (determines the protocol and authentication header).
- **`PROVIDER_NAME`**: The name you will use in the URL (e.g., `openai`, `gemini`).
- **`N`**: A unique suffix (usually a number) for each key in the pool.

### 2. Base URL Configuration (Optional)
`{API_TYPE}_{PROVIDER_NAME}_BASE_URL`

If not provided, the proxy defaults to the official provider endpoint (e.g., Google or OpenAI). For custom aggregators, you can specify the base URL.

---

## 📋 Standard Service Mappings (Blog Reference)

The following tables document how to integrate specific services through KeyProxy.

### AI & LLM Services

| Service | Local KeyProxy URL | .env Pattern Example | Upstream Base URL |
|---------|------------------|----------------------|-------------------|
| **Tavily** | `http://localhost:8990/tavily/*` | `OPENAI_TAVILY_API_KEY_01` | `https://api.tavily.com` |
| **Exa** | `http://localhost:8990/exa/*` | `OPENAI_EXA_API_KEY_01` | `https://api.exa.ai` |

### Scraping & Search Services

| Service | Local KeyProxy URL | .env Pattern Example | Upstream Base URL |
|---------|------------------|----------------------|-------------------|
| **Firecrawl** | `http://localhost:8990/firecrawl/*` | `OPENAI_FIRECRAWL_API_KEY_01` | `https://api.firecrawl.dev` |
| **Context7** | `http://localhost:8990/context7/*` | `OPENAI_CONTEXT7_API_KEY_01` | `https://api.context7.com` |
| **Ref** | `http://localhost:8990/onref/*` | `OPENAI_REF_API_KEY_01` | `https://api.onref.com` |

---

## 🛠️ Implementation Example (Python)

If you are using the OpenAI SDK and want to route through KeyProxy with a specific provider:

```python
from openai import OpenAI

client = OpenAI(
    api_key="ANY_LOCAL_ACCESS_KEY", # KeyProxy ignores this and uses rotated keys
    base_url="http://localhost:8990/openai/v1" # Point to the KeyProxy provider endpoint
)

response = client.chat.completions.create(
    model="gpt-4",
    messages=[{"role": "user", "content": "Hello!"}]
)
```

> [!TIP]
> You can find the exact location of your active `.env` file and the expected naming patterns for every provider directly in the **KeyProxy Admin Panel** at `http://localhost:8990/admin`.
