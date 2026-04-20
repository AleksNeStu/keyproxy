# 🗺️ KeyProxy Variable Mapping

KeyProxy automatically maps your rotating keys from the root `.env` file to persistent system variables and local sync files.

## 📡 Search & Discovery
Primary focus for agentic workflows and deep research.

| Provider | .env Source Pattern | System Sync Variable |
|---|---|---|
| **Tavily** | `TAVILY_API_KEY_1`, `_2` | `TAVILY_API_KEY` |
| **Exa** | `EXA_API_KEY_1`, `_2` | `EXA_API_KEY` |
| **Brave Search** | `BRAVE_API_KEY_1`, `_2` | `BRAVE_API_KEY` |
| **Serper** | `SERPER_API_KEY_1`, `_2` | `SERPER_API_KEY` |

## 🧠 LLM & Reasoners
Managed rotation for high-reliability inference.

| Provider | .env Source Pattern | System Sync Variable |
|---|---|---|
| **OpenAI** | `OPENAI_API_KEY_1`, `_2` | `OPENAI_API_KEY` |
| **Gemini** (Google) | `GEMINI_API_KEY_1`, `_2` | `GEMINI_API_KEY` |
| **Anthropic** | `ANTHROPIC_API_KEY_1`, `_2` | `ANTHROPIC_API_KEY` |
| **Groq** | `GROQ_API_KEY_1`, `_2` | `GROQ_API_KEY` |

## 🛠️ Infrastructure & Data
Web scraping and data extraction services.

| Provider | .env Source Pattern | System Sync Variable |
|---|---|---|
| **Firecrawl** | `FIRECRAWL_API_KEY_1`, `_2` | `FIRECRAWL_API_KEY` |
| **Jina** | `JINA_API_KEY_1`, `_2` | `JINA_API_KEY` |

---

## 🛠️ Advanced Settings

Configure global behavior in your `.env`:

*   **`ENABLE_SYSTEM_SYNC`**: Set to `true` to enable Windows/Linux OS variable updates.
*   **`KEYPROXY_ENV_FILE`**: Path to the local sync file (defaults to `.active_keys.env`).
*   **`KEYPROXY_PORT`**: Port for the local proxy (defaults to `8990`).

---

## 💡 Usage Tip
When adding a new key, just add `PROVIDER_API_KEY_N` to your root `.env`. KeyProxy will discover it automatically, check its health, and synchronize it to the active pool.
