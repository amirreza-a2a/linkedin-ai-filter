// src/content/content-index.js
// Feed watcher & DOM filter for LinkedIn feed using standard ES modules.

import { isLikelyPostContainer } from "./post-qualifier.js";
import { extractAuthor } from "./author-extractor.js";
import { logger, isDebugEnabled } from "../utils/logger.js";

logger.debug("CONTENT", "content script module loaded on", typeof location !== "undefined" ? location.href : "");

const HIDDEN_CLASS = "feedrule-hidden";

const COMBINED_CONTAINER_SELECTOR = [
  "div.feed-shared-update-v2",
  "div[data-urn*='activity:']",
  "div[data-urn*='ugcPost:']",
  "div[data-urn*='sponsoredUpdate:']",
  "div[data-id*='activity:']",
  'div[data-testid="mainFeed"] div[role="listitem"]',
  'div[role="listitem"]',
].join(", ");

const TEXT_CANDIDATES = [
  '[data-testid="expandable-text-box"]',
  ".feed-shared-update-v2__description",
  ".update-components-text",
  ".feed-shared-text",
  ".feed-shared-inline-show-more-text",
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

// Simple non-cryptographic hash (djb2) for fallback fingerprinting
export function hashText(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return "t" + (hash >>> 0).toString(36);
}

/**
 * Extracts normalized post data from a LinkedIn post container.
 * Uses the dedicated extractAuthor helper as the single source of truth for author identity.
 *
 * @param {Element|Object} el
 * @returns {{ id: string, text: string, author: string, authorUrl: string, postUrl: string, el: Element|Object } | null}
 */
export function extractPost(el) {
  if (!el || typeof el.querySelector !== "function") return null;

  let text = "";
  for (const sel of TEXT_CANDIDATES) {
    const textEl = el.querySelector(sel);
    if (textEl?.innerText?.trim()) {
      text = textEl.innerText.trim();
      break;
    }
  }
  if (!text) text = (el.innerText || el.textContent || "").trim();
  text = text.slice(0, 4000);

  if (!text || text.length < 5) {
    return null; // ads/empty spacers etc.
  }

  // 1. Single Source of Truth: Coupled Author & Author Profile URL Extraction
  const { author, authorUrl } = extractAuthor(el);

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
    el.getAttribute?.("data-urn") ||
    el.getAttribute?.("data-id") ||
    el.querySelector("[data-urn*='activity:']")?.getAttribute?.("data-urn") ||
    el.querySelector("[data-urn*='ugcPost:']")?.getAttribute?.("data-urn") ||
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

/**
 * Finds candidate container elements with deduplication favoring canonical inner update nodes.
 * Executes in a single consolidated query pass for high throughput.
 *
 * @param {Element|Object} root
 * @returns {Array<Element|Object>}
 */
export function findContainers(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];

  const rawCandidates = [];
  if (root.matches?.(COMBINED_CONTAINER_SELECTOR)) {
    rawCandidates.push(root);
  }
  const found = root.querySelectorAll(COMBINED_CONTAINER_SELECTOR) || [];
  for (const node of found) {
    rawCandidates.push(node);
  }

  // Deduplicate and filter out redundant outer wrappers when an inner canonical update exists
  const uniqueNodes = new Set();
  const canonicalNodes = [];

  for (const node of rawCandidates) {
    if (uniqueNodes.has(node)) continue;
    uniqueNodes.add(node);

    // If this is a generic listitem that wraps an inner .feed-shared-update-v2, prefer the inner container
    if (node.getAttribute?.("role") === "listitem" && !node.classList?.contains?.("feed-shared-update-v2")) {
      const innerUpdate = node.querySelector?.(".feed-shared-update-v2, [data-urn*='activity:']");
      if (innerUpdate) {
        if (!uniqueNodes.has(innerUpdate)) {
          uniqueNodes.add(innerUpdate);
          canonicalNodes.push(innerUpdate);
        }
        continue;
      }
    }

    canonicalNodes.push(node);
  }

  return canonicalNodes;
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
          logger.warn(
            "CONTENT",
            "background message status:",
            chrome.runtime.lastError.message
          );
          callback();
          return;
        }
        logger.debug("CONTENT", "got response from background:", response);
        const results = response?.results || [];
        for (const decision of results) {
          const el = elementById.get(decision.id);
          if (el) applyDecision(el, decision);
        }
        callback();
      }
    );
  } catch (err) {
    logger.warn("CONTENT", "extension context disconnected:", err);
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
          logger.error("CONTENT", "sendBatchMessage failed:", sendErr);
          resolve();
        }
      });
    }
  } catch (err) {
    logger.error("CONTENT", "unexpected error in processQueue:", err);
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

export function scan(root) {
  const nodes = findContainers(root);
  for (const node of nodes) {
    if (seen.has(node)) continue;
    seen.add(node);

    // Two-Stage Post Qualification Layer
    const qual = isLikelyPostContainer(node);

    if (isDebugEnabled()) {
      const sigs = qual.signals || {};
      logger.debug(
        "CONTENT",
        `CANDIDATE\n` +
          `class=${node.getAttribute?.("class") || ""}\n` +
          `urn=${Boolean(sigs.urn)} permalink=${Boolean(sigs.permalink)} actor=${Boolean(sigs.actor)} text=${Boolean(sigs.text)} authorLink=${Boolean(sigs.authorLink)}\n` +
          `score=${qual.score} decision=${qual.decision} reason=${qual.reason}`
      );
    }

    if (qual.decision === "REJECT") {
      continue;
    }

    // Process ACCEPT and AMBIGUOUS candidates through extractPost
    const post = extractPost(node);
    if (post) {
      if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
        logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> ACCEPTED (${post.id})`);
      }
      pending.push(post);
    } else {
      if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
        logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> REJECTED (no valid text or ID extracted)`);
      }
    }
  }
}

// --- Coalesced MutationObserver Processing ---------------------------
let mutationTimer = null;
const mutationQueue = new Set();
const MUTATION_BUFFER_MS = 50;

export function processMutationQueue() {
  if (mutationQueue.size === 0) return;

  const rootsToScan = [];
  for (const node of mutationQueue) {
    let isChild = false;
    let parent = node.parentElement;
    while (parent) {
      if (mutationQueue.has(parent)) {
        isChild = true;
        break;
      }
      parent = parent.parentElement;
    }
    if (!isChild) {
      rootsToScan.push(node);
    }
  }
  mutationQueue.clear();

  for (const root of rootsToScan) {
    scan(root);
  }

  if (pending.length > 0) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, DEBOUNCE_MS);
  }
}

if (typeof document !== "undefined") {
  logger.debug("CONTENT", "running initial scan...");
  scan(document.body);
  logger.debug("CONTENT", `initial scan found ${pending.length} post(s) pending`);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 0);

  const observer = new MutationObserver((mutations) => {
    let sawAdditions = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        mutationQueue.add(node);
        sawAdditions = true;
      }
    }
    if (sawAdditions) {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(processMutationQueue, MUTATION_BUFFER_MS);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  logger.debug("CONTENT", "MutationObserver attached, watching for new posts with coalesced buffer");
}
