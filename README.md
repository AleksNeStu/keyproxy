# 🛰️ KeyProxy: The Universal API Key Orchestrator

**KeyProxy** is a lightweight, cross-platform engine designed to provide a stable, "immortal" API interface for all your AI tools and services. It acts as a smart bridge between your applications and API providers, managing the entire lifecycle of your credentials behind the scenes.

While it is a general-purpose orchestrator for any API-based workflow, it features **deep, native integration for the Model Context Protocol (MCP)** ecosystem.

---

### 🚀 Core Capabilities

* **🔄 Intelligent Rotation:** Automatically switches between keys based on usage, priority, or rate limits (429 errors).
* **🩺 Proactive Health Monitoring:** Instantly detects and disables "dead" keys (401/403 errors) before they break your scripts or agents.
* **🔗 Stable Proxy Endpoint:** Connect any tool (Cursor, VS Code, Python, etc.) to a single local URL; KeyProxy handles the key swapping invisibly.
* **💉 Native Environment Injection:** Automatically syncs active keys to system environment variables on **Windows (Workstations)** and **Linux (VPS)**.
* **📦 Infrastructure Ready:** Deployable via Docker for 24/7 uptime on remote servers.

---

### 🧩 Deep MCP Integration
KeyProxy isn't just for general APIs—it’s the missing link for your **MCP infrastructure**. It solves the "manual config" headache by:
- **Auto-updating JSON configs:** Dynamically injects fresh keys into `claude_desktop_config.json` and other MCP-hub settings.
- **Pre-configured Templates:** Built-in support for popular MCP servers like **Brave Search, Jina Reader, Firecrawl**, and more.
- **Agent Survival:** Ensures your AI tools (Claude, Cursor) never lose their "vision" or "tools" due to expired or exhausted API keys.

---

### 🛠️ Use Cases
- **Development:** Use a single endpoint for all your local AI projects.
- **MCP Power Users:** Keep your Claude Desktop tools running without ever touching a JSON file.
- **Production/VPS:** Provide a reliable, rotated API proxy for automated workers and bots.

---

### 📦 Installation & Setup

```bash
# Clone the repository
git clone https://github.com/AleksNeStu/keyproxy.git
cd keyproxy

# Install dependencies
npm install

# Start the orchestrator
node main.js
```

### ⚙️ How it Works: Smart Environment Sync

KeyProxy does more than just proxy requests; it manages your system's "source of truth" for keys:

1.  **Discovery:** It scans your `.env` for patterns like `OPENAI_API_KEY`, `OPENAI_API_KEY_1`, `OPENAI_API_KEY_2`, etc.
2.  **Rotation:** When a key is rate-limited or fails, KeyProxy automatically switches to the next available indexed key.
3.  **System Injection:** The **currently active and healthy key** is automatically injected into your system's root environment variable (e.g., `OPENAI_API_KEY`).
    - **Windows:** Injected via `setx` (persists across reboots and new terminals).
    - **Linux:** Syncs via standard environment management (perfect for VPS).
4.  **Zero Manual Work:** Your tools (Cursor, VS Code, Python scripts) can simply read the standard `OPENAI_API_KEY` variable, and KeyProxy ensures it **always contains a working key**.

---

### 🧩 Configuration & Patterns

KeyProxy is designed for flexibility:

- **Indexed Keys:** Add as many as you want:
  ```env
  GEMINI_API_KEY=key_zero
  GEMINI_API_KEY_1=key_one
  GEMINI_API_KEY_2=key_two
  ```
- **External Config:** Use `EXTERNAL_ENV_PATH` to point KeyProxy to a global configuration file (e.g., in your monorepo root):
  ```env
  EXTERNAL_ENV_PATH=../../.env
  ```
- **Custom Providers:** Support for any OpenAI-compatible API (Tavily, Firecrawl, etc.) with custom base URLs.

---

### ⚖️ License
MIT License

Copyright (c) 2025 Fayaz Bin Salam
Copyright (c) 2026 AleksNeStu (KeyProxy)
