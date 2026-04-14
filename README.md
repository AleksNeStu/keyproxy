# keyproxy 🛡️

**Universal API Key Proxy & Orchestrator for Windows and Linux.**
*Provides zero-downtime rotation via stable proxy endpoints while automatically syncing active keys to system environment variables on Workstations and VPS.*

keyproxy helps you manage, rotate, and monitor your API keys (OpenAI, Gemini, Anthropic, Tavily, etc.) through a unified, high-performance Node.js interface.

## 🚀 Features

- **Smart Rotation**: Handles multiple keys per provider with failure tracking and deprioritization.
- **Provider Support**: Seamlessly proxy requests to OpenAI, Google Gemini, and custom endpoints.
- **Tavily / Search Integration**: Native support for search engines with dynamic key injection.
- **Admin Dashboard**: Real-time monitoring of key health and configuration via a sleek web UI.
- **Windows Integration**: Automatic synchronization of rotated keys with system environment variables.
- **Security First**: Designed to run locally or as a containerized service with zero data retention.

## 🛠️ Quick Start

### Prerequisites
- Node.js 18+
- `.env` file with your API keys (see `.env.example`)

### Installation
```bash
git clone https://github.com/AleksNeStu/KeyProxy.git
cd KeyProxy
npm install
```

### Running
```bash
npm start
```

## 📊 Configuration
Configure your keys in the root `.env` file. The orchestrator will automatically pick them up and begin rotation.

## 📜 Credits & License
- **Lead Developer**: Alex Nesterovich.
- **Inspiration**: This project is inspired by the original logic from [KeyProxy/KeyProxy](https://github.com/KeyProxy/KeyProxy) under the MIT License.
- **License**: MIT.
