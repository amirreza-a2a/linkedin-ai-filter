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

  const VALID_AUTHOR_PATH_REGEX = /\/(in|company|school|showcase)\/[a-zA-Z0-9_\-%]+/i;
  const INVALID_AUTHOR_PATH_REGEX = /\/(feed\/update|posts|messaging|jobs|notifications)\b/i;

  function sanitizeUrl(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      const host = parsed.host.toLowerCase().replace(/^www\./, "");
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      return `${parsed.protocol}//${host}${pathname === "/" ? "" : pathname}`;
    } catch {
      return "";
    }
  }

  function isValidAuthorUrl(url) {
    if (typeof url !== "string" || !url.trim()) return false;
    if (INVALID_AUTHOR_PATH_REGEX.test(url)) return false;
    return VALID_AUTHOR_PATH_REGEX.test(url);
  }

  function cleanAuthorName(rawName) {
    if (typeof rawName !== "string" || !rawName.trim()) return "";
    let name = rawName.trim();
    name = name.replace(/^View\s+(.+?)['’]s\s+(profile|page|company\s+page).*$/i, "$1");
    name = name.replace(/\s*[•·]\s*(1st|2nd|3rd\+?|Following|You|Premium)\b.*/i, "");
    name = name.replace(/\s+(reposted|shared|liked|commented\s+on)\s+this.*$/i, "");
    name = name.replace(/^(Promoted|Suggested\s+for\s+you|Suggested)\b.*/i, "");
    name = name.split("\n")[0].trim();
    name = name.replace(/^[•·\s-]+|[•·\s-]+$/g, "").trim();
    name = name.replace(/\s+/g, " ");
    return name;
  }

  function extractAuthorFromDOM(el) {
    if (!el || typeof el.querySelector !== "function") {
      return { author: "", authorUrl: "" };
    }

    const ACTOR_CONTAINER_SELECTORS = [
      ".update-components-actor",
      ".feed-shared-actor",
      "[data-testid='actor-container']",
      ".feed-shared-actor__container-link",
    ];

    let actorScope = null;
    for (const sel of ACTOR_CONTAINER_SELECTORS) {
      const found = el.querySelector(sel);
      if (found) {
        actorScope = found;
        break;
      }
    }

    const searchRoot = actorScope || el;

    const PROFILE_LINK_SELECTORS = [
      "a.update-components-actor__image[href]",
      "a.feed-shared-actor__container-link[href]",
      "a.update-components-actor__container-link[href]",
      "a.app-aware-link[href*='/in/']",
      "a.app-aware-link[href*='/company/']",
      "a.app-aware-link[href*='/school/']",
      "a.app-aware-link[href*='/showcase/']",
      "a[href*='/in/']",
      "a[href*='/company/']",
      "a[href*='/school/']",
      "a[href*='/showcase/']",
    ];

    let profileAnchor = null;
    for (const sel of PROFILE_LINK_SELECTORS) {
      const anchors = Array.from(searchRoot.querySelectorAll(sel));
      for (const a of anchors) {
        if (a.closest?.(".update-components-header") || a.closest?.(".feed-shared-header")) {
          continue;
        }
        const rawHref = a.getAttribute("href") || a.href || "";
        if (isValidAuthorUrl(rawHref)) {
          profileAnchor = a;
          break;
        }
      }
      if (profileAnchor) break;
    }

    let rawAuthor = "";
    let authorUrl = "";

    if (profileAnchor) {
      const rawHref = profileAnchor.getAttribute("href") || profileAnchor.href || "";
      const sanitized = sanitizeUrl(rawHref);
      if (isValidAuthorUrl(sanitized)) {
        authorUrl = sanitized;
      }

      const ariaLabel = profileAnchor.getAttribute("aria-label");
      if (ariaLabel && cleanAuthorName(ariaLabel)) {
        rawAuthor = ariaLabel;
      }

      if (!rawAuthor) {
        const nameEl =
          profileAnchor.querySelector(".update-components-actor__name, .feed-shared-actor__name, span[dir='ltr']") ||
          searchRoot.querySelector(".update-components-actor__name, .feed-shared-actor__name, span[dir='ltr']");
        if (nameEl?.innerText?.trim()) {
          rawAuthor = nameEl.innerText.trim();
        } else if (nameEl?.textContent?.trim()) {
          rawAuthor = nameEl.textContent.trim();
        }
      }

      if (!rawAuthor && profileAnchor.textContent?.trim()) {
        rawAuthor = profileAnchor.textContent.trim();
      }

      if (!rawAuthor) {
        const img = profileAnchor.querySelector("img[alt]");
        if (img?.getAttribute("alt")?.trim()) {
          rawAuthor = img.getAttribute("alt").trim();
        }
      }
    }

    if (!rawAuthor) {
      const nameEl = searchRoot.querySelector(
        ".update-components-actor__name, .feed-shared-actor__name, span.update-components-actor__title span[dir='ltr']"
      );
      if (nameEl && !nameEl.closest?.(".update-components-header") && !nameEl.closest?.(".feed-shared-header")) {
        rawAuthor = (nameEl.innerText || nameEl.textContent || "").trim();
      }
    }

    return {
      author: cleanAuthorName(rawAuthor),
      authorUrl: authorUrl,
    };
  }

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

    // 1. Coupled Author & Author Profile URL Extraction
    const { author, authorUrl } = extractAuthorFromDOM(el);

    // 2. Post Permalink (Direct Header / Timestamp anchor)
    let postUrl = "";
    for (const sel of POST_LINK_CANDIDATES) {
      const linkEl = el.querySelector(sel);
      if (linkEl?.href) {
        postUrl = linkEl.href.split("?")[0];
        break;
      }
    }

    // 3. Stable 3-level Post ID Strategy
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
