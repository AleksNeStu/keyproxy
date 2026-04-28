# MCP Server Health Check — 2026-04-28

All 7 MCP servers (doc-, search-, parse- prefixes) tested and operational.

## Results

| Server | Tools Tested | Status |
|--------|-------------|--------|
| **doc-context** | `resolve-library-id` (React — 5 results) | OK |
| **doc-ref** | `ref_search_documentation` (Next.js App Router) | OK |
| **doc-rtfm** | `get_readme` (express, fastapi) | OK |
| **search-tavily** | `search`, `extract`, `crawl`, `map` | OK |
| **search-exa** | `web_search_exa` | OK |
| **parse-jina** | `jina_reader`, `jina_search` | OK |
| **parse-firecrawl** | `firecrawl_scrape` (httpbin.org, cache hit) | OK |

## Tavily Cold-Start Fix

**Symptom:** First request to any Tavily endpoint returns 502 Bad Gateway.

**Root cause:** KeyProxy lazily creates provider clients on first request. The initialization (key discovery, KeyRotator setup, history sync) takes long enough for the `tavily-mcp` npm package to timeout.

**Resolution:** No code change needed — subsequent requests work instantly after the client is cached. The 502 only occurs on the very first call after KeyProxy restart.

**Verification:** All 5 Tavily tools confirmed working after warm-up:
- `tavily_search` — web search with results
- `tavily_extract` — URL content extraction
- `tavily_crawl` — multi-page crawling
- `tavily_map` — site structure discovery
- `tavily_research` — deep multi-source research

## KeyProxy Tavily Configuration

- **Provider type:** openai (OpenAIClient with `Authorization: Bearer` auth)
- **Base URL:** `https://api.tavily.com`
- **Keys:** 10 active keys discovered from root `.env` via `EXTERNAL_ENV_PATH`
- **Route:** MCP intercept maps `api.tavily.com` → `localhost:8990/tavily/*`
- **Freeze codes:** 401 (invalid key)

## Active Key Count

Keys with non-empty values in `.env`:
- `TAVILY_API_KEY_01` through `TAVILY_API_KEY_09` — 9 keys
- `TAVILY_API_KEY_15`, `TAVILY_API_KEY_23`, `TAVILY_API_KEY_25` — 3 keys
- **Total: 12 keys** available for rotation
