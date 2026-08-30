# FeedRule Configuration Guide

This guide covers provider authentication, custom base URLs, local model setup, multi-key rotation, rate limiting, and rule authoring.

---

## 1. Provider Setup & Authentication

Access the configuration page by clicking the extension icon $\rightarrow$ **⚙️ API key & provider settings** (or right-clicking the extension icon $\rightarrow$ **Options**).

### Supported Providers

| Provider | Supported Models (Defaults) | API Key Format |
| :--- | :--- | :--- |
| **OpenAI** | `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-turbo` | `sk-...` |
| **Google Gemini** | `gemini-3.5-flash`, `gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-1.5-pro` | `AIza...` |
| **Anthropic Claude** | `claude-haiku-4-5-20251001`, `claude-3-5-sonnet-20241022` | `sk-ant-...` |

> [!NOTE]
> API keys are stored exclusively in `chrome.storage.local` and are **never** synced to Google account storage (`chrome.storage.sync`) or sent to any remote server other than the chosen LLM endpoint.

---

## 2. Multi-Key Pools & Automatic Rotation

FeedRule supports configuring multiple API keys per provider in [`src/options/options.html`](file:///home/amirreza-a2a/linkedin-ai-filter/src/options/options.html).

### How Rotation Works ([`src/llm/key-scheduler.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/key-scheduler.js))

1. **Least-Active Round-Robin**: When a batch request begins, [`acquireKey()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/key-scheduler.js#L35) selects the key with the fewest active in-flight leases.
2. **Rate Limit & Server Error Cooldowns**:
   - HTTP 429 (`RATE_LIMIT`): Key enters a **60-second cooldown**.
   - HTTP 5xx (`SERVER_ERROR`): Key enters a **45-second cooldown**.
   - Request Timeout (`TIMEOUT`): Key enters a **30-second cooldown**.
3. **Automatic Failover**: If an attempt on Key #1 returns a retryable status code (429, 5xx, or timeout), [`executeClassifyRequest()`](file:///home/amirreza-a2a/linkedin-ai-filter/src/llm/request-gateway.js#L41) transparently acquires Key #2 to fulfill the batch.
4. **Permanent Rejection**: HTTP 401 (`INVALID_KEY`) immediately disqualifies the key from subsequent rotation until the key is updated in Options.

---

## 3. Custom Base URLs & Local Models

You can route requests to self-hosted LLMs or third-party OpenAI-compatible gateways by configuring the **Base URL** field in Options.

### Local LLMs (Ollama & LM Studio)

When using a local model on `localhost`, **no API key is required**.

#### Ollama
1. Start Ollama:
   ```bash
   ollama run llama3.2
   ```
2. In FeedRule Options:
   - Provider: **OpenAI**
   - Base URL: `http://localhost:11434/v1`
   - Model: `llama3.2`
   - API Key: *(Leave empty)*

#### LM Studio
1. In LM Studio, start the Local Server on port `1234`.
2. In FeedRule Options:
   - Provider: **OpenAI**
   - Base URL: `http://localhost:1234/v1`
   - Model: *(Enter your loaded model ID, e.g. `qwen2.5-7b`)*
   - API Key: *(Leave empty)*

### Third-Party Gateways

| Service | Provider Selection | Base URL | Required Key |
| :--- | :--- | :--- | :--- |
| **OpenRouter** | OpenAI | `https://openrouter.ai/api/v1` | `sk-or-...` |
| **Groq** | OpenAI | `https://api.groq.com/openai/v1` | `gsk_...` |
| **DeepSeek** | OpenAI | `https://api.deepseek.com/v1` | `sk-...` |

> [!TIP]
> Use the **"Test Connection"** button in Options to verify your endpoint and credentials before saving. The test runs a lightweight non-destructive ping without modifying your cached decisions.

---

## 4. Daily Request Call Cap

To protect against unexpected API spend or rate exhaustion:
- Configurable under **Daily Call Cap** in Options (default: `500` requests/day).
- Reset automatically each calendar day at midnight (local time).
- When the daily cap is exceeded, FeedRule **fails open** — posts remain visible with reason `"daily-cap-reached"`.

---

## 5. Rule Syntax & Authoring

FeedRule uses two distinct rule systems: **Filter Rules (Hide/Keep)** and **Second Brain (Auto-Save Topics)**.

### 1. Filter Rules (Hide / Keep)

Filter rules are written in plain English. They are injected directly into the LLM system prompt:

```text
Hide: recruiter spam, generic hiring announcements, crypto ads, motivational quotes, humble-brag posts.
Keep: technical engineering deep dives, compiler design, Linux kernel tutorials, open source project releases.
```

#### Real-World Rule Examples

- **Strict Tech Filter**:
  ```text
  Hide every post not related to electrical engineering, telecommunications, or embedded systems.
  ```
- **Hiring & Job Search Only**:
  ```text
  Hide promotional corporate marketing and lifestyle posts. Keep all software engineering job postings and internships.
  ```
- **Language / Regional Focus**:
  ```text
  Hide all non-English posts except technical posts written in Persian or German.
  ```

### 2. Second Brain (Auto-Save Topic Rules)

Unlike filter rules (which evaluate natural language), **Save Rules** operate on the structured **topic tags** extracted by the LLM during classification.

- **Matching Engine**: [`src/rules/save-rule-engine.js`](file:///home/amirreza-a2a/linkedin-ai-filter/src/rules/save-rule-engine.js) performs **exact case-insensitive string matching**.
- **Syntax**: Comma, newline, or bullet-separated topic keywords.

#### Example Save Rules

```text
AI, 5G, Embedded Systems, RISC-V, Rust, Distributed Systems
```

#### How They Interact

1. When a post is processed, the LLM assigns 0–5 topic tags (e.g. `["Embedded Systems", "Robotics"]`).
2. If `"Embedded Systems"` matches a topic in your Save Rules, the post is **automatically saved** to your local Second Brain repository with `saveReason: "Matched topic: Embedded Systems"`.
3. The post can still be hidden or kept on your feed depending on your Filter Rules.
