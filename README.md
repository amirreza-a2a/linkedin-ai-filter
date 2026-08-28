# FeedRule — Custom AI Filter & Second Brain for LinkedIn

A privacy-focused Chrome Extension (Manifest V3) that filters your LinkedIn feed using AI driven by plain-English rules, extracts subject-matter topics, curates high-signal posts into a local **Second Brain**, computes visual **Analytics**, and maps relationships in an interactive **Knowledge Graph**.

Uses your own API keys (OpenAI, Google Gemini, Anthropic Claude) or local inference (Ollama, LM Studio). **Zero remote telemetry or tracking backends.**

---

## Features

### 1. Plain-English Feed Filtering & Custom Base URLs
- **Natural Language Rules**: Write custom filter instructions in plain English (e.g. *"Hide recruiter spam, crypto ads, and humble-brag posts. Keep technical deep dives."*).
- **Custom Base URLs**:
  - **Local Inference (Full Privacy)**:
    - **Ollama**: Base URL `http://localhost:11434/v1`, Model `llama3.2` (API key optional).
    - **LM Studio**: Base URL `http://localhost:1234/v1`, Model `local-model` (API key optional).
  - **OpenAI-Compatible Gateways**:
    - **OpenRouter**: `https://openrouter.ai/api/v1`
    - **Groq**: `https://api.groq.com/openai/v1`
    - **DeepSeek**: `https://api.deepseek.com/v1`
- **Dynamic Host Permissions**: Automatically requests runtime permissions for custom endpoints via Chrome's permission manager.
- **Fail-Open Architecture**: Any API error, timeout (15s), or invalid response keeps posts visible rather than hiding content.

### 2. Subject-Matter Topic Classification
- Extracts 0–5 concise topic tags (e.g. `AI`, `5G`, `Semiconductors`, `Embedded Systems`) per post during classification.
- **Strict Normalization**: Syntactically trimmed, case-insensitively deduplicated, and length-capped.
- **Cache Isolation**: Decision cache v3 is keyed by SHA-256 hash of `[version, provider, model, rulesText, postText]`.

### 3. Second Brain (Saved Posts & Export)
- **Auto-Save Engine**: Define topic rules (e.g. `AI, 5G, Distributed Systems`) to automatically curate matching posts into your local Second Brain.
- **Manual Curation**: Save or unsave posts directly with full metadata (author, profile URL, permalink, timestamp).
- **Obsidian & Markdown Export**: Export saved posts as an Obsidian-ready Markdown document with sanitized hashtags (`#Embedded_Systems`) or as structured JSON.
- **Race-Free Storage**: All writes pass through a promise-serialized mutation queue to prevent data loss.

### 4. Advanced Analytics & Trend Visualizations
- **Single-Pass Engine**: $O(N)$ analytics layer computing KPIs, daily/weekly activity buckets, and topic performance.
- **Local Calendar Date Boundaries**: Aggregates by local calendar dates (`Today`, `Last 7 Days`, `Last 30 Days`, `All Time`).
- **XSS-Safe SVG Charts**: Pure SVG trend lines (Total Analyzed, Kept, Hidden, Saved) and top topic frequency bars.
- **Rolling Dataset**: Operates on the rolling retained decision log (capped at the most recent 500 entries).

### 5. Deterministic Knowledge Graph
- **Structural Network**: Visualizes relationships directly from your Second Brain:
  - `Saved Post` $\xrightarrow{\text{HAS\_TOPIC}}$ `Topic`
  - `Saved Post` $\xrightarrow{\text{WRITTEN\_BY}}$ `Author`
- **Hardware-Accelerated HTML5 Canvas**: 60fps rendering with smooth pan, zoom ($0.2\times$ to $4.0\times$), node dragging, and neighborhood highlight on hover.
- **Zero-Dependency Force Simulation**: Physics layout (Coulomb repulsion, Hooke spring attraction, center gravity) with automatic alpha cooldown.
- **Interactive Detail Sidebar**: Click any node to view full post details, author post lists, or topic post lists with instant links to LinkedIn.

---

## Privacy & Data Flow Architecture

FeedRule is designed with strict client-side data boundaries:

```
+---------------------------------------------------------------------------------------+
| User Device (Local Chrome Storage)                                                   |
|   - API Keys: Stored exclusively in chrome.storage.local (never synced to cloud)     |
|   - Decision Log: Retained locally (capped at 500 rolling entries)                    |
|   - Second Brain: Stored locally in chrome.storage.local (4,000 char cap per post)    |
|   - Metadata: Author names, profile URLs, and permalinks remain 100% local            |
+-------------------------------------------+-------------------------------------------+
                                            |
                                            | Outbound HTTP POST (Only when classifying)
                                            v
+---------------------------------------------------------------------------------------+
| Configured LLM Endpoint (OpenAI / Gemini / Claude / Custom Base URL / Local LLM)      |
|   - Transmitted Payload: Post ID + Post Text snippet (first 1,200 chars only)         |
|   - Author names, profile URLs, and post permalinks are NEVER sent to the LLM         |
|   - Local LLMs (Ollama / LM Studio): Zero outbound network traffic                    |
+---------------------------------------------------------------------------------------+
```

---

## Installation (Unpacked Extension)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/linkedin-ai-filter.git
   ```
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `linkedin-ai-filter/` root directory.
5. Click the extension icon $\rightarrow$ **API key & provider settings** to select your provider, enter your API key, or set a custom Base URL.
6. Configure your filter and save rules in the extension popup.
7. Open [LinkedIn](https://www.linkedin.com/feed/) — filtered posts will collapse with a placeholder and a *"Show anyway"* toggle.

---

## Project Structure

```
linkedin-ai-filter/
├── manifest.json              # Manifest V3 configuration (storage permission only)
├── icons/                     # Extension icon assets (16px, 48px, 128px)
├── test/                      # Automated unit test suite (node --test)
│   ├── manifest.test.js       # Manifest V3 permission and match validation
│   ├── url-helper.test.js     # URL normalization & endpoint resolution
│   ├── providers.test.js      # Provider adapters & authentication
│   ├── cache.test.js          # Cache isolation & versioning
│   ├── normalization.test.js  # Topic normalization & deduplication
│   ├── save-rules.test.js     # Exact topic match save engine
│   ├── saved-posts.test.js    # Concurrency, deduplication & invariants
│   ├── logging.test.js        # Decision log retention & legacy defaults
│   ├── analytics.test.js      # Single-pass metrics & SVG safety
│   └── graph.test.js          # Graph builder & force layout physics
└── src/
    ├── content/
    │   ├── content-index.js   # Feed watcher, DOM extractor & filtering
    │   └── content.css        # Collapsed post placeholder styles
    ├── background/
    │   └── service-worker.js  # Background router, classification & caching
    ├── llm/
    │   ├── factory.js         # Provider resolver
    │   ├── provider-base.js   # Topic normalization & JSON response parser
    │   ├── url-helper.js      # URL validation & endpoint construction
    │   ├── openai-provider.js # OpenAI & OpenAI-compatible adapter
    │   ├── gemini-provider.js # Google Gemini structured output adapter
    │   └── claude-provider.js # Anthropic Claude adapter
    ├── rules/
    │   └── save-rule-engine.js# Exact-match topic rule evaluator
    ├── storage/
    │   ├── rules-store.js     # Settings & cache persistence
    │   ├── log-store.js       # Rolling 500 decision log
    │   └── saved-posts-store.js # Second Brain serialized storage
    ├── export/
    │   └── export-helper.js   # Obsidian Markdown & JSON export
    ├── analytics/
    │   └── dashboard-analytics.js # Single-pass KPI & time-series engine
    ├── dashboard/
    │   ├── dashboard.html     # Analytics & decision log viewer
    │   ├── dashboard.js       # Dashboard reactive controller
    │   └── charts.js          # XSS-safe pure SVG chart renderers
    ├── saved/
    │   ├── saved.html         # Second Brain post viewer UI
    │   └── saved.js           # Second Brain controller & exporter
    ├── graph/
    │   ├── graph-builder.js   # O(N+E) pure graph model builder
    │   ├── force-layout.js    # Spring-embedder physics simulation
    │   ├── graph-renderer.js  # High-DPI interactive Canvas renderer
    │   ├── graph.html         # Knowledge Graph view
    │   └── graph.js           # Graph page controller & sidebar
    ├── popup/                 # Filter toggle & rules editor popup
    └── options/               # Provider, Base URL & API key settings
```

---

## Known Limitations

- **Rolling Decision Log**: The filter decision log is capped at the most recent 500 decisions in local storage to prevent unbounded growth.
- **Feed Scope**: Focuses on the main LinkedIn social feed (`/feed/`); recruiter search, messages, and job listings are not filtered.
- **Daily Call Cap**: The daily limit in Settings is a request count guardrail (e.g. 500 requests/day), not a token-count meter.
- **Knowledge Graph Scale**: The zero-dependency spring-embedder calculates pairwise forces at $O(N^2)$, optimized for up to 1,500 nodes.
- **Platform Support**: Designed and verified for Manifest V3 on Google Chrome and Chromium-based browsers.
