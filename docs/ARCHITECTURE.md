# FeedRule Architecture

This document provides a technical overview of FeedRule's internals, data flow, subsystem boundaries, and execution lifecycle.

---

## 1. High-Level Data Flow

```
[ LinkedIn Feed DOM ]
       │
       ▼
[ content/content-index.js ]
  ├── 1. Discovery: findContainers(root)
  ├── 2. Qualification: isLikelyPostContainer(el)  ──> (REJECT / AMBIGUOUS / ACCEPT)
  ├── 3. Extraction: extractPost(el) + extractAuthor(el)
  ├── 4. Bounded Caching: decisionsById.get(id)
  └── 5. Batching & Queue: scheduleFlush() ──> flush() ──> processQueue()
       │
       ▼  chrome.runtime.sendMessage({ type: "CLASSIFY_POSTS", posts })
[ background/service-worker.js ]
  ├── 1. Settings & Rules: getSettings()
  ├── 2. Hash Cache Check: buildCacheKey() ──> getCachedDecisions()
  ├── 3. Rate Guardrail: incrementAndCheckDailyCap()
  └── 4. Orchestration: executeClassifyRequest()
       │
       ▼
[ llm/request-gateway.js ]
  ├── 1. Key Leasing: acquireKey() (Round-robin / Cooldown check)
  ├── 2. Provider Adapter: openaiAttempt / geminiAttempt / claudeAttempt
  ├── 3. Failure Classification: classifyFailure(status, body, err)
  └── 4. Outcome & Cooldown: applySuccessOutcome() / applyFailureOutcome()
       │
       ▼  HTTP POST (Payload: post text snippet only)
[ AI Provider / Local LLM Endpoint ]
       │
       ▼  JSON Response: [{ id, hide, reason, topics }]
[ background/service-worker.js ]
  ├── 1. Second Brain Evaluation: evaluateSaveRules(topics, saveRulesText)
  ├── 2. Persistence: savePostsBatch() & appendLogEntries() & setCachedDecisions()
  └── 3. Response: sendResponse({ ok: true, results, provider, model })
       │
       ▼
[ content/content-index.js ]
  ├── 1. Stale Identity Check: nodeToPostId.get(el) === decision.id
  ├── 2. User Reveal Check: userRevealedPostIds.has(decision.id)
  └── 3. DOM Mutation: applyDecision(el, decision)
       ├── Hide: add .feedrule-hidden, pauseVideosInContainer(), inject .feedrule-placeholder
       └── Show: remove .feedrule-hidden, remove .feedrule-placeholder
```

---

## 2. Content Script Subsystem

Because Chrome Manifest V3 content scripts run under strict Content Security Policy (CSP) without ES module support, all content modules are bundled into a single IIFE (`src/content/content-bundle.js`).

### Source Files & Responsibilities

| File | Primary Role |
| :--- | :--- |
| [`src/content/post-qualifier.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/post-qualifier.js) | Two-stage candidate evaluation. Performs hard-negative rejections (composers, recommendation carousels, feed controls, comments) and weighted positive scoring (`ACCEPT_THRESHOLD = 40`, `AMBIGUOUS_THRESHOLD = 15`). |
| [`src/content/author-extractor.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/author-extractor.js) | Single source of truth for author extraction (`extractAuthor(el)`). Couply extracts author name and profile URL. |
| [`src/content/debug-overlay.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/debug-overlay.js) | Non-intrusive on-page visual diagnostic badges activated via `sessionStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1"`. |
| [`src/content/content-index.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js) | Core coordinator: attaches `MutationObserver` to `main#workspace`, handles candidate discovery, queueing, debounced batching, caching, video autoplay pausing, and DOM hide/reveal manipulation. |
| [`src/content/content.css`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content.css) | Styles for collapsed posts (`.feedrule-hidden > *:not(...) { display: none !important; }`), `.feedrule-placeholder`, and diagnostic badges. |

### Lifecycle of a Post in the DOM

1. **DOM Attachment**: LinkedIn inserts DOM nodes into `<main id="workspace">`.
2. **Mutation Capture**: `handleMutations(mutations)` captures child node additions. If nodes are inside an unclassified post container, the enclosing container is scheduled in `mutationQueue`.
3. **Container Discovery**: `findContainers(root)` queries `COMBINED_CONTAINER_SELECTOR` (`div[data-lazy-mount-id]`, `div.feed-shared-update-v2`, `div[role="listitem"]`), discarding redundant inner descendants when an outer canonical post container exists.
4. **Qualification**: `isLikelyPostContainer(node)` runs:
   - **Hard Negative Check**: Rejects composer widgets (`"Start a post"`), follow recommendation cards (`"Recommended for you"`), comment blocks, and feed controls (`"Sort by: Top"`, `"Load more"`).
   - **Weighted Score**: Sums positive signal weights (URN attribute: 40, permalink: 35, update class: 25, actor structure: 25, post text: 25, lazy mount ID: 25, timestamp: 20, control menu: 20, author link: 15, social actions: 10).
   - If score $\ge 40 \to$ `ACCEPT`. If score $\ge 15 \to$ `AMBIGUOUS` (delegates to text extraction). Otherwise $\to$ `REJECT`.
5. **Extraction**: `extractPost(node)` extracts clean text, author, author URL, and canonical post ID (checking URN attributes, lazy mount IDs, permalink regex, or deterministic fallback hash).
6. **Queue & Debounced Batching**:
   - Genuinely new posts are added to `pending` and tracked in `inFlightPostIds`.
   - `scheduleFlush(150)` sets a $150\text{ms}$ timer (without cancelling in-flight timers) to flush batches into `batchQueue` in slices of `BATCH_SIZE = 8`.
7. **Background Dispatch**: `sendBatchMessage(batch)` calls `chrome.runtime.sendMessage({ type: "CLASSIFY_POSTS", posts })`.
8. **DOM Application**: When the classification response returns:
   - Verifies element identity hasn't been recycled (`nodeToPostId.get(el) === decision.id`).
   - If `decision.hide === true` and post was not user-revealed: adds `.feedrule-hidden`, sets `data-feedrule-hidden="true"`, pauses any autoplaying videos via `pauseVideosInContainer(el)`, and prepends `.feedrule-placeholder` with a *"Show anyway"* button.
   - If `decision.hide === false`: removes `.feedrule-hidden` and placeholder.

---

## 3. Background Service Worker

The service worker ([`src/background/service-worker.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/background/service-worker.js)) runs as an ES module in Chrome MV3.

### Message Handlers

- `CLASSIFY_POSTS`: Batched post classification.
- `SAVE_POST`: Manual post save to Second Brain.
- `UNSAVE_POST`: Remove post from Second Brain.
- `GET_SAVED_POSTS`: Retrieve saved posts with optional search/topic filtering.
- `IS_POST_SAVED`: Query saved status for a specific post ID.

### Classification & Caching Flow (`handleClassify`)

1. Loads active configuration from [`rules-store.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/storage/rules-store.js) (`rulesText`, `saveRulesText`, `provider`, `model`, `baseUrl`, `apiKeys`, `dailyCallCap`).
2. If filtering is disabled or `rulesText` is empty, returns all posts as `hide: false` with reason `"disabled-or-no-rules"`.
3. Computes SHA-256 cache keys via `buildCacheKey({ version: 3, provider, model, rulesText, text })`.
4. Reads cached decisions from `chrome.storage.local`.
5. For uncached posts:
   - Checks daily call limit via `incrementAndCheckDailyCap()`. If limit exceeded, fails open (`hide: false`, reason `"daily-cap-reached"`).
   - Groups unique post hashes to prevent duplicate API requests within the same batch.
   - Forwards request to [`executeClassifyRequest()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/request-gateway.js#L41).
   - Writes successful classification outcomes to cache (`chrome.storage.local`).
6. Evaluates topic save rules on extracted topics via [`evaluateSaveRules()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/rules/save-rule-engine.js#L35).
7. Automatically persists matching posts via [`savePostsBatch()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/storage/saved-posts-store.js#L140).
8. Records decision entries in the local rolling log (capped at 500 entries) via [`appendLogEntries()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/storage/log-store.js#L30).

---

## 4. LLM & Request Gateway Subsystem

All outbound LLM traffic is managed through [`src/llm/request-gateway.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/request-gateway.js).

```
executeClassifyRequest()
       │
       ▼
[ key-scheduler.js ] ──> acquireKey() (Least-active, non-cooldown round-robin lease)
       │
       ▼
[ provider adapter ] ──> openaiAttempt / geminiAttempt / claudeAttempt
       │
       ├── Success (200 OK)
       │     ├── applySuccessOutcome(keyIndex) (clears failure counters)
       │     └── appendApiLog() (operation: "classify", status: 200)
       │
       └── Failure (429 / 5xx / 401 / Timeout)
             ├── classifyFailure(status, body, err)
             ├── applyFailureOutcome(keyIndex, failureClass) (triggers 30s-60s cooldown)
             ├── appendApiLog() (operation: "classify", error logged)
             └── Failover: Re-enters loop to acquire next available key
```

### Subsystem Components

- **Key Scheduler** ([`src/llm/key-scheduler.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/key-scheduler.js)): Multi-key concurrency manager. Balances active leases across configured API keys and enforces cooldown periods upon rate limits (`RATE_LIMIT`: 60s cooldown) or server errors (`SERVER_ERROR`: 45s cooldown, `TIMEOUT`: 30s cooldown).
- **Failure Policy** ([`src/llm/failure-policy.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/failure-policy.js)): Classifies HTTP responses into standardized error codes (`INVALID_KEY`, `RATE_LIMIT`, `QUOTA_EXCEEDED`, `MODEL_NOT_FOUND`, `BAD_REQUEST`, `SERVER_ERROR`, `TIMEOUT`, `NETWORK_ERROR`).
- **Provider Adapters**:
  - [`openai-provider.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/openai-provider.js): Standard OpenAI Chat Completions API & compatible endpoints (Ollama, LM Studio, OpenRouter, Groq, DeepSeek).
  - [`gemini-provider.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/gemini-provider.js): Google Gemini REST API (`generateContent`) using `response_schema` / `response_mime_type: "application/json"`.
  - [`claude-provider.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/claude-provider.js): Anthropic Claude Messages API (`/v1/messages`).
- **Connection Testing** ([`src/llm/test-connection.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/test-connection.js)): Minimal non-destructive ping payloads to verify API keys and custom base URLs from the options UI without modifying runtime state.

---

## 5. Storage Architecture

| Storage Area | Key / Pattern | Description |
| :--- | :--- | :--- |
| `chrome.storage.sync` | `enabled`, `rulesText`, `saveRulesText`, `provider`, `model`, `baseUrl`, `dailyCallCap` | User configuration synced across devices. API keys are **never** stored here. |
| `chrome.storage.local` | `apiKeys` | Provider API key arrays (`{ openai: string[], gemini: string[], claude: string[] }`). Kept strictly local to the machine. |
| `chrome.storage.local` | `cachedDecisions` | Keyed by SHA-256 hash `[v3, provider, model, rulesText, postText]`. |
| `chrome.storage.local` | `saved_posts_index` + `saved_post_${id}` | Second Brain post repository. Uses serialized promise queue ([`saved-posts-store.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/storage/saved-posts-store.js)) to prevent write races. |
| `chrome.storage.local` | `feedrule_decision_logs` | Rolling classification log (last 500 entries) used by Analytics Dashboard. |
| `chrome.storage.local` | `feedrule_api_logs` | Rolling network log (last 200 entries) for gateway observability. |
| `chrome.storage.local` | `feedrule_daily_cap` | Tracks daily request count and date string for the call cap guardrail. |

---

## 6. Content Script Bundling

The build script ([`scripts/bundle-content.js`](file:///home/amirreza-a2a/linkedin-ai-filter/scripts/bundle-content.js)) concatenates modular content files into `src/content/content-bundle.js`:

1. [`src/utils/logger.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/utils/logger.js)
2. `sanitizeUrl` helper from [`src/storage/saved-posts-store.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/storage/saved-posts-store.js)
3. [`src/content/debug-overlay.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/debug-overlay.js)
4. [`src/content/post-qualifier.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/post-qualifier.js)
5. [`src/content/author-extractor.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/author-extractor.js)
6. [`src/content/content-index.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js)

> [!IMPORTANT]
> Any edits made in `src/content/` require running `npm run build` to update `src/content/content-bundle.js`. Chrome loads `content-bundle.js`, not the individual source files.
