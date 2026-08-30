# FeedRule — Custom AI Filter & Second Brain for LinkedIn

A privacy-focused Chrome Extension (Manifest V3) that filters your LinkedIn feed using natural-language AI rules, curates high-value posts into a local **Second Brain**, visualizes feed trends with **Analytics**, and maps relationships in an interactive **Knowledge Graph**. It operates with your own API keys (OpenAI, Gemini, Claude) or local models (Ollama, LM Studio) with **zero remote tracking or telemetry**.

---

## 🚀 Quick Start & Installation

### Step 1: Clone the Repository
```bash
git clone https://github.com/your-username/linkedin-ai-filter.git
cd linkedin-ai-filter
```

### Step 2: Build the Content Bundle (CRITICAL)
> [!IMPORTANT]
> You **MUST** run `npm run build` before loading the extension.
>
> `src/content/content-bundle.js` is an auto-generated file compiled from modular sources (`post-qualifier.js`, `author-extractor.js`, `debug-overlay.js`, `content-index.js`). Editing source files without rebuilding will cause Chrome to load an outdated bundle.

```bash
npm run build
```

### Step 3: Load into Chrome
1. Open Chrome and navigate to `chrome://extensions`.
2. Turn ON **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the root directory of this repository (`linkedin-ai-filter/`).

### Step 4: Configure Provider & Rules
1. Click the FeedRule extension icon in your Chrome toolbar $\rightarrow$ **⚙️ API key & provider settings**.
2. Select your provider (OpenAI, Gemini, Claude, or Local Base URL), enter your key, and click **Test Connection**.
3. In the extension popup, enter your plain-English filter rules (e.g. *"Hide: recruiter spam, crypto ads, and humble-brag posts. Keep technical deep dives."*).
4. Open [LinkedIn](https://www.linkedin.com/feed/) — matching posts will automatically collapse with a *"Show anyway"* toggle.

---

## 📚 Documentation

Detailed technical documentation and guides are organized in the [`docs/`](docs/) directory:

- 🏗️ **[Architecture & Pipeline Design](docs/ARCHITECTURE.md)**: End-to-end data flow, DOM lifecycle, background service worker, request gateway, multi-key rotation, and storage schemas.
- ⚙️ **[Configuration & Setup Guide](docs/CONFIGURATION.md)**: Setting up OpenAI, Gemini, Claude, local models (Ollama, LM Studio), multi-key pools, daily request caps, and rule syntax.
- 🌟 **[Features & UI Surfaces](docs/FEATURES.md)**: Deep dive into the Feed Filtering placeholder, Second Brain post archive, Analytics Dashboard, and interactive Knowledge Graph.
- 🔍 **[Debugging & Diagnostics](docs/DEBUGGING.md)**: Using on-page diagnostic overlays (`FEEDRULE_DIAGNOSTIC`), console inspection hooks (`window.__dumpFeedRuleState()`), and troubleshooting known edge cases.
- 🛠️ **[Developer Guide](docs/DEVELOPMENT.md)**: Build & test commands (`npm test`, `npm run bench`), adding new LLM provider adapters, and updating DOM selector scoring.

---

## 🧪 Testing & Verification

FeedRule includes a comprehensive zero-dependency test suite running on Node.js's native test runner:

```bash
# Run all 331 automated unit and regression tests
npm test

# Run DOM stress and memory benchmark
npm run bench
```

---

## 🔒 Privacy Invariants

- **API Keys**: Stored exclusively in `chrome.storage.local` on your device. Never synced to cloud storage or third-party servers.
- **Minimal Payload**: Only the post text snippet and active rules are transmitted to your configured LLM endpoint. Author names, profile URLs, and personal identifiers are never sent over the wire.
- **Local Inference Support**: Fully supports running against local instances of Ollama or LM Studio (`http://localhost:11434/v1` or `http://localhost:1234/v1`) with zero external internet traffic.
