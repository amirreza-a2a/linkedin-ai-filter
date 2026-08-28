// src/content/content-index.js
//
// Plain script (no ES module imports) — Chrome content scripts don't
// reliably support static `import` without a bundler, so everything the
// content script needs lives in this one file.
//
// LinkedIn no longer exposes stable data-urn/data-id attributes on feed
// posts, and its CSS classes are hashed per build (e.g. "_963ba617") so
// they're useless as selectors. What IS stable is semantic/ARIA markup:
//   - the feed container: div[data-testid="mainFeed"][role="list"]
//   - each post:          div[role="listitem"]  (child of the above)
//   - the post text:      [data-testid="expandable-text-box"]
// If LinkedIn changes markup again, check these three lines first.

(() => {
  console.log("[FeedRule] content script loaded on", location.href);

  const HIDDEN_CLASS = "feedrule-hidden";

  const CONTAINER_CANDIDATES = [
    'div[data-testid="mainFeed"] div[role="listitem"]',
    'div[role="listitem"]',
    // legacy fallbacks, kept in case LinkedIn reverts or A/B tests markup
    "div.feed-shared-update-v2[data-urn]",
    "div[data-urn][data-id]",
  ];
  const TEXT_CANDIDATES = [
    '[data-testid="expandable-text-box"]',
    ".feed-shared-update-v2__description",
    ".update-components-text",
    ".feed-shared-text",
  ];

  let activeContainerSelector = null;

  function findContainers(root) {
    if (activeContainerSelector) {
      return root.matches?.(activeContainerSelector)
        ? [root]
        : Array.from(root.querySelectorAll?.(activeContainerSelector) || []);
    }
    for (const sel of CONTAINER_CANDIDATES) {
      const found = root.querySelectorAll?.(sel) || [];
      if (found.length > 0) {
        activeContainerSelector = sel;
        console.log(`[FeedRule] matched container selector: "${sel}" (${found.length} found)`);
        return Array.from(found);
      }
    }
    return [];
  }

  // Simple non-cryptographic hash (djb2) — fast, synchronous, good enough
  // to build a stable-ish id from post text since LinkedIn doesn't give
  // us a real one anymore. Two posts with byte-identical text will share
  // an id; acceptable tradeoff for an MVP.
  function hashText(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return "t" + (hash >>> 0).toString(36);
  }

  function extractPost(el) {
    let text = "";
    for (const sel of TEXT_CANDIDATES) {
      const textEl = el.querySelector(sel);
      if (textEl?.innerText?.trim()) {
        text = textEl.innerText.trim();
        break;
      }
    }
    if (!text) text = (el.innerText || "").trim();
    text = text.slice(0, 4000);

    if (!text || text.length < 5) {
      return null; // ads/empty spacers etc.
    }

    const id = el.getAttribute("data-urn") || el.getAttribute("data-id") || hashText(text.slice(0, 300));
    return { id, text, el };
  }

  // --- DOM filtering ---------------------------------------------------
  function applyDecision(el, decision) {
    if (!decision.hide) {
      el.classList.remove(HIDDEN_CLASS);
      return;
    }
    if (el.classList.contains(HIDDEN_CLASS)) return;

    el.classList.add(HIDDEN_CLASS);

    if (!el.dataset.feedruleWrapped) {
      el.dataset.feedruleWrapped = "1";
      const placeholder = document.createElement("div");
      placeholder.className = "feedrule-placeholder";

      const label = document.createElement("span");
      label.textContent = decision.reason
        ? `Hidden by your filter: ${decision.reason}`
        : "Hidden by your filter";

      const showBtn = document.createElement("button");
      showBtn.type = "button";
      showBtn.className = "feedrule-show-btn";
      showBtn.textContent = "Show anyway";
      showBtn.addEventListener("click", () => el.classList.remove(HIDDEN_CLASS));

      placeholder.appendChild(label);
      placeholder.appendChild(showBtn);
      el.prepend(placeholder);
    }
  }

  // --- Feed watcher -----------------------------------------------------
  const elementById = new Map();
  const seen = new WeakSet();
  let pending = [];
  let flushTimer = null;
  const DEBOUNCE_MS = 600;
  const BATCH_SIZE = 8;

  function classifyAndApply(batch) {
    if (!batch || batch.length === 0) return;
    console.log(
      "[FeedRule] sending batch to background:",
      batch.map((p) => ({ id: p.id, textPreview: p.text.slice(0, 60) }))
    );
    for (const post of batch) elementById.set(post.id, post.el);

    try {
      chrome.runtime.sendMessage(
        {
          type: "CLASSIFY_POSTS",
          posts: batch.map((p) => ({ id: p.id, text: p.text })),
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[FeedRule] sendMessage note:",
              chrome.runtime.lastError.message,
              "(If you recently reloaded the extension, refresh this page to reconnect)"
            );
            return;
          }
          console.log("[FeedRule] got response from background:", response);
          const results = response?.results || [];
          for (const decision of results) {
            const el = elementById.get(decision.id);
            if (el) applyDecision(el, decision);
          }
        }
      );
    } catch (e) {
      console.warn("[FeedRule] runtime context unavailable:", e);
    }
  }

  function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      classifyAndApply(batch.slice(i, i + BATCH_SIZE));
    }
  }

  function scan(root) {
    const nodes = findContainers(root);
    for (const node of nodes) {
      if (seen.has(node)) continue;
      seen.add(node);
      const post = extractPost(node);
      if (post) pending.push(post);
    }
  }

  console.log("[FeedRule] running initial scan...");
  scan(document.body);
  console.log(`[FeedRule] initial scan found ${pending.length} post(s) pending`);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 0);

  const observer = new MutationObserver((mutations) => {
    let sawAdditions = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        sawAdditions = true;
        scan(node);
      }
    }
    if (sawAdditions) {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, DEBOUNCE_MS);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  console.log("[FeedRule] MutationObserver attached, watching for new posts");
})();
