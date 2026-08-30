# FeedRule Development Guide

This guide covers developer workflows, testing standards, adding new LLM providers, and updating DOM selectors when LinkedIn alters its markup.

---

## 1. Commands & Workflows

### Prerequisites
- Node.js 18+ (uses built-in `node:test` runner; zero external npm runtime dependencies).

### Common Commands

```bash
# Build the content script bundle (MUST run after editing src/content/*)
npm run build

# Run the automated unit test suite (331 tests)
npm test

# Run the performance and DOM stress benchmark
npm run bench
```

> [!IMPORTANT]
> Always run `npm test` before committing. `npm test` automatically runs `npm run build` first to ensure tests execute against the freshest bundle.

---

## 2. Adding a New LLM Provider

To add a new provider (e.g. `Mistral`, `Cohere`):

### Step 1: Create Provider Adapter (`src/llm/<provider>-provider.js`)
Implement `executeHttpAttempt` extending the contract in [`src/llm/provider-base.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/provider-base.js):

```javascript
// src/llm/mistral-provider.js
import { buildClassifyPrompt, parseJsonContent } from "./provider-base.js";

export async function executeHttpAttempt({ apiKey, model, baseUrl, rulesText, posts, signal }) {
  const url = (baseUrl || "https://api.mistral.ai/v1").replace(/\/+$/, "") + "/chat/completions";
  const { systemPrompt, userPrompt } = buildClassifyPrompt(rulesText, posts);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "mistral-small-latest",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    }),
    signal,
  });

  const data = await res.json();
  const rawContent = data.choices?.[0]?.message?.content || "[]";
  const results = parseJsonContent(rawContent);

  return { ok: res.ok, status: res.status, results, error: null };
}
```

### Step 2: Register in Request Gateway & Factory
1. In [`src/llm/request-gateway.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/request-gateway.js#L13):
   ```javascript
   import { executeHttpAttempt as mistralAttempt } from "./mistral-provider.js";

   const PROVIDER_ADAPTERS = {
     openai: openaiAttempt,
     gemini: geminiAttempt,
     claude: claudeAttempt,
     mistral: mistralAttempt, // Add new provider adapter
   };
   ```
2. In [`src/llm/test-connection.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/test-connection.js) and [`src/storage/rules-store.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/storage/rules-store.js): Register default model and key normalization.

### Step 3: Add UI Fields in Options
In [`src/options/options.html`](file:///home/amirreza-a2a/linkedin-ai-filter/src/options/options.html) and [`src/options/options.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/options/options.js), add the dropdown option, model inputs, and multi-key pool container.

---

## 3. Updating LinkedIn DOM Selectors

LinkedIn updates its obfuscated CSS class names regularly. To ensure resilience, FeedRule relies on structural attributes, semantic tags, and a weighted two-stage qualification system.

### Key Selector Locations

| Target Area | File | Variable / Constant |
| :--- | :--- | :--- |
| **Feed Root Container** | [`src/content/content-index.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js#L40) | `FEED_ROOT_SELECTORS` |
| **Candidate Containers** | [`src/content/content-index.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js#L60) | `COMBINED_CONTAINER_SELECTOR` |
| **Post Text Elements** | [`src/content/content-index.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js#L75) | `TEXT_CANDIDATES` |
| **Post Permalinks** | [`src/content/content-index.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/content-index.js#L85) | `POST_LINK_CANDIDATES` |
| **Author Link / Name** | [`src/content/author-extractor.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/author-extractor.js#L10) | `AUTHOR_SELECTORS` |
| **Hard Negative Selectors** | [`src/content/post-qualifier.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/post-qualifier.js#L6) | `DISQUALIFIED_COMPOSER_SELECTORS`, `DISQUALIFIED_RECS_SELECTORS` |

### Two-Stage Qualification Thresholds ([`src/content/post-qualifier.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/content/post-qualifier.js))

The classifier uses weighted evidence points to qualify candidates:

```javascript
// Thresholds in src/content/post-qualifier.js
export const ACCEPT_THRESHOLD = 40;
export const AMBIGUOUS_THRESHOLD = 15;
```

#### Signal Weights

- `hasValidPostUrn` (`data-urn="urn:li:activity:..."`): **+40**
- `hasPostPermalink` (`a[href*='/feed/update/']`): **+35**
- `hasUpdateClass` (`.feed-shared-update-v2`): **+25**
- `hasActorStructure` (`.update-components-actor`): **+25**
- `hasPostTextStructure` (`.update-components-text`): **+25**
- `hasLazyMount` (`data-lazy-mount-id`): **+25**
- `hasTimestamp` (`time`, `.sub-description`): **+20**
- `hasControlMenu` (`.feed-shared-control-menu`): **+20**
- `hasAuthorLink` (`a[href*='/in/']`, `a[href*='/company/']`): **+15**
- `hasSocialActions` (`.feed-shared-social-actions`): **+10**

#### Qualification Decision Logic
- **Score $\ge 40$**: `ACCEPT` $\to$ Genuinely verified post container.
- **Score $15\text{--}39$**: `AMBIGUOUS` $\to$ Delegated to `extractPost()` to inspect whether text and author can be resolved.
- **Score $< 15$**: `REJECT` $\to$ Dropped immediately before extraction or queueing.

> [!TIP]
> When LinkedIn introduces a new DOM wrapper, add the new selector to `COMBINED_CONTAINER_SELECTOR` and check if an entry should be added to `post-qualifier.js` signal weights. After updating, run `npm test` to verify no regressions against the test fixtures.
