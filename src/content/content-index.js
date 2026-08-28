// src/content/content-index.js
//
// Plain script (no ES module imports) — Chrome content scripts don't
// reliably support static `import` without a bundler, so everything the
// content script needs lives in this one file.

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
  const ACTOR_NAME_CANDIDATES = [
    ".update-components-actor__name",
    ".feed-shared-actor__name",
    "span.update-components-actor__title span[dir='ltr']",
    ".update-components-actor__title",
  ];
  const ACTOR_LINK_CANDIDATES = [
    "a.update-components-actor__image",
    "a.app-aware-link[href*='/in/']",
    "a.feed-shared-actor__container-link",
  ];
  const POST_LINK_CANDIDATES = [
    "a.update-components-actor__sub-description-link[href*='/feed/update/']",
    "a.update-components-actor__sub-description-link[href*='/posts/']",
    "a.update-components-actor__sub-description a[href*='/feed/update/']",
    "a.feed-shared-actor__sub-description a[href*='/feed/update/']",
    "a[href*='/feed/update/urn:li:activity:']",
    "a[href*='/feed/update/urn:li:ugcPost:']",
    "a.app-aware-link[href*='/feed/update/']",
    "a.app-aware-link[href*='/posts/']",
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

  // Simple non-cryptographic hash (djb2) for fallback fingerprinting
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

    // 1. Author Name
    let author = "";
    for (const sel of ACTOR_NAME_CANDIDATES) {
      const authorEl = el.querySelector(sel);
      if (authorEl?.innerText?.trim()) {
        author = authorEl.innerText.trim().split("\n")[0].trim();
        break;
      }
    }

    // 2. Author Profile URL
    let authorUrl = "";
    for (const sel of ACTOR_LINK_CANDIDATES) {
      const linkEl = el.querySelector(sel);
      if (linkEl?.href) {
        authorUrl = linkEl.href.split("?")[0];
        break;
      }
    }

    // 3. Post Permalink (Direct Header / Timestamp anchor)
    let postUrl = "";
    for (const sel of POST_LINK_CANDIDATES) {
      const linkEl = el.querySelector(sel);
      if (linkEl?.href) {
        postUrl = linkEl.href.split("?")[0];
        break;
      }
    }

    // 4. Stable 3-level Post ID Strategy
    // Level 1: Direct activity or UGC URN attribute on container or children
    let id =
      el.getAttribute("data-urn") ||
      el.getAttribute("data-id") ||
      el.querySelector("[data-urn*='activity:']")?.getAttribute("data-urn") ||
      el.querySelector("[data-urn*='ugcPost:']")?.getAttribute("data-urn") ||
      "";

    // Level 2: Extract verified URN from permalink if available
    if (!id && postUrl) {
      const urnMatch = postUrl.match(/urn:li:(?:activity|ugcPost):\d+/);
      if (urnMatch) id = urnMatch[0];
    }

    // Level 3: Deterministic fallback fingerprint (author + text snippet)
    if (!id) {
      id = hashText(`${author}::${text.slice(0, 500)}`);
    }

    // If postUrl was not found from anchors but container has a verified activity/ugcPost URN, construct canonical URL
    if (!postUrl && id && /^urn:li:(?:activity|ugcPost):\d+$/.test(id)) {
      postUrl = `https://www.linkedin.com/feed/update/${id}`;
    }

    return { id, text, author, authorUrl, postUrl, el };
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

  // --- Feed watcher & Request Queue --------------------------------------
  const elementById = new Map();
  const seen = new WeakSet();
  let pending = [];
  let flushTimer = null;
  const DEBOUNCE_MS = 600;
  const BATCH_SIZE = 8;

  const batchQueue = [];
  let isProcessingQueue = false;

  function sendBatchMessage(batch, callback) {
    if (!batch || batch.length === 0) {
      callback();
      return;
    }
    for (const post of batch) elementById.set(post.id, post.el);

    try {
      chrome.runtime.sendMessage(
        {
          type: "CLASSIFY_POSTS",
          posts: batch.map((p) => ({
            id: p.id,
            text: p.text,
            author: p.author,
            authorUrl: p.authorUrl,
            postUrl: p.postUrl,
          })),
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[FeedRule] background message status:",
              chrome.runtime.lastError.message
            );
            callback();
            return;
          }
          console.log("[FeedRule] got response from background:", response);
          const results = response?.results || [];
          for (const decision of results) {
            const el = elementById.get(decision.id);
            if (el) applyDecision(el, decision);
          }
          callback();
        }
      );
    } catch (err) {
      console.warn("[FeedRule] extension context disconnected:", err);
      callback();
    }
  }

  async function processQueue() {
    if (isProcessingQueue || batchQueue.length === 0) return;
    isProcessingQueue = true;

    try {
      while (batchQueue.length > 0) {
        const nextBatch = batchQueue.shift();
        await new Promise((resolve) => {
          try {
            sendBatchMessage(nextBatch, resolve);
          } catch (sendErr) {
            console.error("[FeedRule] sendBatchMessage failed:", sendErr);
            resolve();
          }
        });
      }
    } catch (err) {
      console.error("[FeedRule] unexpected error in processQueue:", err);
    } finally {
      isProcessingQueue = false;
      if (batchQueue.length > 0) {
        setTimeout(processQueue, 0);
      }
    }
  }

  function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      batchQueue.push(batch.slice(i, i + BATCH_SIZE));
    }
    processQueue();
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
