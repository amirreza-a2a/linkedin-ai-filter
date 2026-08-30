# FeedRule Debugging & Diagnostics Guide

This guide describes how to inspect the content script runtime, activate on-page visual diagnostic overlays, and troubleshoot known LinkedIn DOM edge cases.

---

## 1. Runtime State Inspection

When inspecting LinkedIn in Chrome DevTools, FeedRule exposes diagnostic hooks in the content script execution context.

### Commands

Open Chrome DevTools $\rightarrow$ **Console** (ensure the context dropdown is set to **FeedRule — Custom AI Filter for LinkedIn**):

```javascript
// Dump a human-readable runtime report to the console
window.__dumpFeedRuleState();
```

#### Example Output

```text
FeedRule Runtime State
────────────────────────
feedRoot: main#workspace._304b5951._8300cafe
observer: attached
pending: 0
inFlight: 0
decisionCache: 14
revealedCount: 1
currentObserverAttached: 1
observerAttachCount: 1
observerDisconnectCount: 0
scanCalls: 28
classificationDispatches: 3
```

### Key Metrics Explained

| Metric | What It Means | Healthy Value |
| :--- | :--- | :--- |
| `feedRoot` | The root DOM element being observed by `MutationObserver`. | `main#workspace...` or `.scaffold-finite-scroll` |
| `observer` | Whether the `MutationObserver` is actively listening. | `attached` |
| `pending` | Posts discovered and waiting for the $150\text{ms}$ batch timer to flush. | `0` (or $1\text{--}8$ during rapid scroll) |
| `inFlight` | Posts currently sent to background service worker and waiting for LLM response. | `0` when idle, $>0$ during API call |
| `decisionCache` | Number of unique post decisions cached in memory. | Grows as you browse (bounded at 2,000) |
| `scanCalls` | Total number of container discovery sweeps executed. | Increments on scroll and DOM additions |
| `classificationDispatches` | Number of batch requests dispatched to the background worker. | $>0$ after browsing feed |

---

## 2. On-Page Visual Diagnostic Overlay

FeedRule includes a non-intrusive on-page visual badge attached to every discovered container.

### How to Enable Diagnostic Mode

In DevTools Console (Main World or Content Script):

```javascript
// Activate diagnostic badges
sessionStorage.setItem("FEEDRULE_DIAGNOSTIC", "1");
```

Reload the feed (`F5`) or scroll. Each candidate container will display a badge in its top-right corner.

### How to Disable Diagnostic Mode

```javascript
sessionStorage.removeItem("FEEDRULE_DIAGNOSTIC");
```

Reload the feed to remove overlays.

---

## 3. Diagnostic Badge Pipeline Stages

Every badge displays the candidate's exact progress through the 6-stage pipeline:

```text
┌────────────────────────────────────────┐
│ FeedRule (v3)                          │
│ STAGE: DOM_APPLIED                     │
│ STATUS: DOM_HIDDEN                     │
│ ID: u8bmnq                             │
│ SELECTOR: div[data-lazy-mount-id]       │
│ QUALIFY: ACCEPT (Score: 95)            │
│ REASON: Not related to telecommunications│
│ PROVIDER: Gemini (gemini-3.5-flash)    │
└────────────────────────────────────────┘
```

### Stage Definitions

| Stage | Meaning |
| :--- | :--- |
| `DISCOVERED` | Container node was returned by `findContainers()`. |
| `QUALIFIED` | Evaluated by `isLikelyPostContainer()`. Displays decision (`ACCEPT`, `AMBIGUOUS`, `REJECT`) and weighted score. |
| `EXTRACTED` | Post text, author, and canonical ID were parsed by `extractPost()`. |
| `QUEUED` | Placed in the `pending` array awaiting batch dispatch. |
| `DISPATCHED` | Sent to background worker via `CLASSIFY_POSTS`. |
| `RESPONSE_RECEIVED` | Response returned from LLM provider. |
| `DOM_APPLIED` | Terminal state. `.feedrule-hidden` applied or post allowed visible. |
| `STALE_CHECK` | DOM recycling protection: if node was reused by LinkedIn before response arrived, the response was safely discarded. |

---

## 4. Known Failure Modes & Troubleshooting

### 1. "I made a change in `src/content/`, but LinkedIn doesn't see it"
* **Root Cause**: `src/content/content-bundle.js` was not recompiled. Chrome loads `content-bundle.js`, not the modular source files.
* **Fix**: Run `npm run build` after modifying any file in `src/content/`, then reload the extension in `chrome://extensions` and refresh LinkedIn.

### 2. "Posts are visible for a few seconds before disappearing"
* **Root Cause**: Modern LinkedIn uses progressive lazy hydration. Container elements mount at $t=0$, but text streams in $1\text{--}3$ seconds later.
* **Normal Behavior**: FeedRule runs progressive hydration sweeps at $500\text{ms}$, $1200\text{ms}$, $2500\text{ms}$, and $4000\text{ms}$. As soon as LinkedIn renders the text, the post qualifies and filters automatically.

### 3. "All posts say `error-fail-open` or `MISSING_API_KEY`"
* **Root Cause**: No API key is configured, or all keys in the pool have encountered HTTP 401 / 429 errors.
* **Fix**:
  1. Open Options (`src/options/options.html`).
  2. Click **"Test Connection"** on your active provider to verify key validity.
  3. Check the **Recent API Gateway Logs** table at the bottom of the Options page to inspect error responses.

### 4. "Scrolling on desktop doesn't trigger new post scans"
* **Root Cause**: Desktop LinkedIn scrolls `<main id="workspace">` instead of `window` (`window.scrollY === 0`).
* **Implementation Note**: FeedRule binds a capture-phase listener (`window.addEventListener("scroll", ..., { capture: true, passive: true })`) to capture inner workspace scroll events.
