# FeedRule — Custom AI Filter for LinkedIn

A Chrome extension that filters your LinkedIn feed using AI, driven by
plain-English rules you write yourself (not a fixed list of categories).
Uses your own OpenAI, Gemini, or Claude API key — or a local LLM (Ollama, LM Studio) — nothing goes through a
third-party tracking server.

## Load it in Chrome (dev mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`linkedin-ai-filter/`)
5. Click the extension icon → **API key & model settings** → configure your provider, key, or local Base URL
6. Click the extension icon → type your rules, e.g.:
   > Hide: recruiter spam, humble-brag posts, crypto/finance ads. Keep anything about AI or semiconductors.
7. Go to linkedin.com and refresh — matching posts collapse with a
   "Hidden by your filter" placeholder (click "Show anyway" to expand).
8. Click the extension icon → **View filter dashboard →** to see stats and
   a searchable log of every post that's been hidden or kept.

## Custom Base URLs & Local Models

FeedRule supports custom Base URLs across providers in Settings:

- **Local Inference (Zero External API Keys / Full Privacy)**:
  - **Ollama**: Base URL `http://localhost:11434/v1`, Model `llama3.2` (API key can be left empty).
  - **LM Studio**: Base URL `http://localhost:1234/v1`, Model `your-local-model` (API key can be left empty).
- **OpenAI-Compatible Gateways**:
  - **OpenRouter**: Base URL `https://openrouter.ai/api/v1`, Model `anthropic/claude-3.5-sonnet` (or any OpenRouter model).
  - **Groq**: Base URL `https://api.groq.com/openai/v1`, Model `llama-3.3-70b-versatile`.
  - **DeepSeek**: Base URL `https://api.deepseek.com/v1`, Model `deepseek-chat`.

## Dashboard

`src/dashboard/dashboard.html` shows:
- Total posts seen, hidden, kept, and hide rate
- A filterable/searchable table of every logged decision (excerpt, reason, time)
- A "Clear log" button

It reads from a rolling log (`src/storage/log-store.js`) capped at the most
recent 500 posts, stored in `chrome.storage.local`.

## How it works

1. `src/content/content-index.js` watches the feed with a `MutationObserver`
   and extracts post text as it renders.
2. Posts are batched and sent via `chrome.runtime.sendMessage` to
   `src/background/service-worker.js`.
3. The service worker checks a local decision cache (keyed by a hash of
   rules+post text) — repeat views don't re-call the API.
4. Uncached posts go to your chosen provider (`src/llm/*-provider.js`),
   which classifies each post as hide/keep against your rules.
5. The content script applies the decision to the DOM.

**Fails open everywhere**: missing key on authenticated endpoints, API error, unparseable response,
or daily cap reached → posts stay visible rather than being hidden.

## Project structure

```
linkedin-ai-filter/
├── manifest.json
├── icons/
├── test/                      # automated unit test suite
│   ├── url-helper.test.js
│   └── providers.test.js
└── src/
    ├── content/
    │   ├── content-index.js   # feed watcher + DOM filtering (plain script, no bundler needed)
    │   └── content.css
    ├── background/
    │   └── service-worker.js  # batches, caches, calls the LLM provider
    ├── llm/
    │   ├── provider-base.js   # shared prompt + response parsing
    │   ├── url-helper.js      # URL validation, normalization, and endpoint resolution
    │   ├── factory.js
    │   ├── openai-provider.js
    │   ├── gemini-provider.js
    │   └── claude-provider.js
    ├── popup/                 # rules editor, on/off toggle
    ├── options/               # API keys, Base URLs, model choice, daily call cap
    ├── dashboard/             # stats + searchable log of filtered posts
    └── storage/
        ├── rules-store.js     # chrome.storage wrapper + decision cache
        └── log-store.js       # rolling log of every decision, for the dashboard
```

## Known limitations (v1 / MVP)

- LinkedIn's DOM changes often and uses hashed/randomized CSS class names
  per build, so class selectors are useless. The extension instead relies
  on semantic markup: `div[data-testid="mainFeed"] div[role="listitem"]`
  for post containers and `[data-testid="expandable-text-box"]` for post
  text. If filtering stops working, check `CONTAINER_CANDIDATES` /
  `TEXT_CANDIDATES` at the top of `content-index.js` first — open a post
  in DevTools → Elements and see whether these `data-testid`/`role`
  attributes still exist.
- Since LinkedIn no longer exposes a stable `data-urn`/`data-id` per post,
  the extension derives an id from a hash of the post's text. Two posts
  with byte-identical text will share an id (rare in practice, but a
  known tradeoff).
- Social feed only; job listings and other feed types aren't covered yet.
- No token/cost estimator in the UI yet — the daily call cap in Settings
  is a basic safety guardrail (call count, not token count).
- Firefox/Edge: MV3 is supported by both, but this hasn't been tested there
  yet — expect minor manifest tweaks.
