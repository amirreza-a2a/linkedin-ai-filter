// src/content/content-index.js
// Feed watcher & DOM filter for LinkedIn feed using standard ES modules.
// Identity-aware incremental reprocessing for initial load, Load More, container reuse, and video autoplay.
// High-performance architecture: non-feed fast rejection, scoped mutation routing, cached video state, and 0 in-flight memory leaks.

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

const NON_FEED_ANCESTOR_SELECTOR = [
  "#global-nav",
  ".global-nav",
  ".msg-overlay-container",
  ".msg-overlay-list-bubble",
  ".scaffold-layout__aside",
  "#artdeco-toasts__wormhole",
  ".feed-follows-module",
  "aside",
  "header",
  "footer",
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

// --- Performance Instrumentation Counters (Dev / Diagnostic) ---------
export const performanceStats = {
  mutationCallbacks: 0,
  childListMutations: 0,
  attributeMutations: 0,
  classMutations: 0,
  identityMutations: 0,
  relevantMutations: 0,
  ignoredMutations: 0,
  feedContainerResolutions: 0,
  postContainerResolutions: 0,
  scanCalls: 0,
  findContainersCalls: 0,
  querySelectorAllCalls: 0,
  videoPauseTraversals: 0,
  videosPaused: 0,
  classificationDispatches: 0,
  mutationQueueMaxSize: 0,
  inFlightElementMaxSize: 0,
  startTime: typeof Date !== "undefined" ? Date.now() : 0,
};

export function resetPerformanceStats() {
  performanceStats.mutationCallbacks = 0;
  performanceStats.childListMutations = 0;
  performanceStats.attributeMutations = 0;
  performanceStats.classMutations = 0;
  performanceStats.identityMutations = 0;
  performanceStats.relevantMutations = 0;
  performanceStats.ignoredMutations = 0;
  performanceStats.feedContainerResolutions = 0;
  performanceStats.postContainerResolutions = 0;
  performanceStats.scanCalls = 0;
  performanceStats.findContainersCalls = 0;
  performanceStats.querySelectorAllCalls = 0;
  performanceStats.videoPauseTraversals = 0;
  performanceStats.videosPaused = 0;
  performanceStats.classificationDispatches = 0;
  performanceStats.mutationQueueMaxSize = 0;
  performanceStats.inFlightElementMaxSize = 0;
  performanceStats.startTime = Date.now();
}

export function getContentPerformanceStats() {
  return {
    ...performanceStats,
    mutationQueueSize: mutationQueue.size,
    cachedDecisionsCount: decisionsById.size,
    userRevealedCount: userRevealedPostIds.size,
    inFlightCount: inFlightPostIds.size,
    inFlightElementCount: elementById.size,
    uptimeMs: Date.now() - performanceStats.startTime,
  };
}

// Simple non-cryptographic hash (djb2) for fallback fingerprinting
export function hashText(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return "t" + (hash >>> 0).toString(36);
}

// Track processed / paused video elements to prevent repeat full-subtree traversals
const processedVideos = new WeakSet();

/**
 * Helper to pause any active video playback within a hidden post container.
 * Uses WeakSet caching to avoid repeated calls on already-paused video elements.
 *
 * @param {Element|Object} container
 */
export function pauseVideosInContainer(container) {
  if (!container || typeof container.querySelectorAll !== "function") return;
  performanceStats.videoPauseTraversals++;
  try {
    const videos = container.querySelectorAll("video");
    performanceStats.querySelectorAllCalls++;
    for (const v of videos) {
      if (v && !processedVideos.has(v)) {
        processedVideos.add(v);
        if (typeof v.pause === "function" && !v.paused) {
          v.pause();
          performanceStats.videosPaused++;
        }
      }
    }
  } catch {}
}

export function pauseSingleVideo(videoNode) {
  if (!videoNode || processedVideos.has(videoNode)) return;
  processedVideos.add(videoNode);
  try {
    if (typeof videoNode.pause === "function" && !videoNode.paused) {
      videoNode.pause();
      performanceStats.videosPaused++;
    }
  } catch {}
}

/**
 * Evaluates whether a DOM node is within the relevant LinkedIn feed scope.
 * Drops mutations from chat drawer, top navigation, sidebars, and ads in a single check.
 *
 * @param {Element|Object} node
 * @returns {boolean}
 */
export function isRelevantFeedScope(node) {
  if (!node || node.nodeType !== 1) return false;

  // Extension-injected UI is never an unclassified post container
  if (
    node.classList?.contains?.("feedrule-placeholder") ||
    node.classList?.contains?.("feedrule-show-btn")
  ) {
    return false;
  }

  // Reject non-feed regions (Messaging, Global Nav, Rail, Modals)
  if (node.closest?.(NON_FEED_ANCESTOR_SELECTOR)) {
    return false;
  }

  return true;
}

export function isFeedContainerRoot(node) {
  if (!node || node.nodeType !== 1) return false;
  return Boolean(
    node.classList?.contains?.("scaffold-finite-scroll__content") ||
    node.classList?.contains?.("scaffold-finite-scroll") ||
    node.getAttribute?.("data-testid") === "mainFeed" ||
    node.classList?.contains?.("core-rail")
  );
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
    el.querySelector?.("[data-urn*='activity:']")?.getAttribute?.("data-urn") ||
    el.querySelector?.("[data-urn*='ugcPost:']")?.getAttribute?.("data-urn") ||
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
 * Optimized with fast-path return when root is already a resolved post container.
 *
 * @param {Element|Object} root
 * @returns {Array<Element|Object>}
 */
export function findContainers(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  performanceStats.findContainersCalls++;

  // Fast Path: If root is already a leaf post container, return immediately without subtree query
  if (
    root.classList?.contains?.("feed-shared-update-v2") &&
    root.getAttribute?.("role") !== "listitem"
  ) {
    return [root];
  }

  const rawCandidates = [];
  if (root.matches?.(COMBINED_CONTAINER_SELECTOR)) {
    rawCandidates.push(root);
  }
  const found = root.querySelectorAll(COMBINED_CONTAINER_SELECTOR) || [];
  performanceStats.querySelectorAllCalls++;
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

// --- DOM filtering & Bounded Caches ----------------------------------
const MAX_CACHED_DECISIONS = 2000;
const MAX_USER_REVEALED = 500;

const decisionsById = new Map(); // postId -> decision object (bounded LRU)
const userRevealedPostIds = new Set(); // postId user explicitly revealed via "Show anyway"

export function cacheDecision(postId, decision) {
  if (!postId || !decision) return;
  if (decisionsById.size >= MAX_CACHED_DECISIONS) {
    const oldestKey = decisionsById.keys().next().value;
    if (oldestKey) decisionsById.delete(oldestKey);
  }
  decisionsById.set(postId, decision);
}

function markPostUserRevealed(postId) {
  if (!postId) return;
  if (userRevealedPostIds.size >= MAX_USER_REVEALED) {
    const oldest = userRevealedPostIds.keys().next().value;
    if (oldest) userRevealedPostIds.delete(oldest);
  }
  userRevealedPostIds.add(postId);
}

export function applyDecision(el, decision) {
  if (!el || !decision) return;

  cacheDecision(decision.id, decision);
  inFlightPostIds.delete(decision.id);
  elementById.delete(decision.id);

  // Stale selection protection: if el is currently bound to a different post, do not touch this element
  const currentPostOnNode = nodeToPostId.get(el);
  if (currentPostOnNode && currentPostOnNode !== decision.id) {
    return;
  }

  // If user previously clicked "Show anyway" on this post identity, preserve user reveal
  if (userRevealedPostIds.has(decision.id) || el.dataset?.feedruleUserRevealed === "1") {
    el.classList?.remove?.(HIDDEN_CLASS);
    el.removeAttribute?.("data-feedrule-hidden");
    if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
    return;
  }

  if (!decision.hide) {
    el.classList?.remove?.(HIDDEN_CLASS);
    el.removeAttribute?.("data-feedrule-hidden");
    if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
    if (el.dataset?.feedruleWrapped) {
      delete el.dataset.feedruleWrapped;
      const placeholder = el.querySelector?.(".feedrule-placeholder");
      if (placeholder?.remove) placeholder.remove();
    }
    return;
  }

  // Authoritative hidden state application
  el.classList?.add?.(HIDDEN_CLASS);
  el.setAttribute?.("data-feedrule-hidden", "true");
  if (el.dataset) el.dataset.feedruleHidden = "true";

  // Pause any autoplaying videos inside the hidden post
  pauseVideosInContainer(el);

  if (el.dataset?.feedruleWrapped && el.querySelector?.(".feedrule-placeholder")) return;

  if (typeof document !== "undefined") {
    if (el.dataset) el.dataset.feedruleWrapped = "1";
    let placeholder = el.querySelector?.(".feedrule-placeholder");
    if (!placeholder) {
      placeholder = document.createElement("div");
      placeholder.className = "feedrule-placeholder";

      const label = document.createElement("span");
      label.textContent = decision.reason
        ? `Hidden by your filter: ${decision.reason}`
        : "Hidden by your filter";

      const showBtn = document.createElement("button");
      showBtn.type = "button";
      showBtn.className = "feedrule-show-btn";
      showBtn.textContent = "Show anyway";
      if (showBtn.addEventListener) {
        showBtn.addEventListener("click", () => {
          markPostUserRevealed(decision.id);
          if (el.dataset) {
            el.dataset.feedruleUserRevealed = "1";
            delete el.dataset.feedruleHidden;
          }
          el.removeAttribute?.("data-feedrule-hidden");
          el.classList?.remove?.(HIDDEN_CLASS);
        });
      }

      placeholder.appendChild(label);
      placeholder.appendChild(showBtn);
      if (el.prepend) {
        el.prepend(placeholder);
      } else if (el.insertBefore && el.firstChild) {
        el.insertBefore(placeholder, el.firstChild);
      } else if (el.appendChild) {
        el.appendChild(placeholder);
      }
    }
  }
}

// --- Feed watcher & Request Queue --------------------------------------
const elementById = new Map(); // postId -> Element (in-flight only, bounded to active batch)
const nodeToPostId = new WeakMap(); // Element -> postId (tracks current post on this DOM node)
const inFlightPostIds = new Set(); // postId currently queued in pending or batchQueue
let pending = [];
let flushTimer = null;
const DEBOUNCE_MS = 600;
const BATCH_SIZE = 8;

const batchQueue = [];
let isProcessingQueue = false;

// Inspection helpers for unit/regression testing
export function getPendingPosts() { return [...pending]; }
export function getCachedDecisions() { return new Map(decisionsById); }
export function getInFlightPostIds() { return new Set(inFlightPostIds); }
export function getUserRevealedPostIds() { return new Set(userRevealedPostIds); }
export function getInFlightElementCount() { return elementById.size; }

export function resetContentState() {
  elementById.clear();
  decisionsById.clear();
  userRevealedPostIds.clear();
  inFlightPostIds.clear();
  pending = [];
  batchQueue.length = 0;
  isProcessingQueue = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (mutationTimer) clearTimeout(mutationTimer);
  mutationTimer = null;
  mutationQueue.clear();
  resetPerformanceStats();
}

function sendBatchMessage(batch, callback) {
  if (!batch || batch.length === 0) {
    callback();
    return;
  }
  performanceStats.classificationDispatches++;
  for (const post of batch) elementById.set(post.id, post.el);

  if (elementById.size > performanceStats.inFlightElementMaxSize) {
    performanceStats.inFlightElementMaxSize = elementById.size;
  }

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
          for (const post of batch) {
            inFlightPostIds.delete(post.id);
            elementById.delete(post.id);
          }
          callback();
          return;
        }
        logger.debug("CONTENT", "got response from background:", response);
        const results = response?.results || [];
        for (const decision of results) {
          cacheDecision(decision.id, decision);
          inFlightPostIds.delete(decision.id);

          const el = elementById.get(decision.id);
          elementById.delete(decision.id); // Immediate release of DOM reference for garbage collection

          // Stale selection protection: verify DOM element has not been recycled for a different post
          if (el && nodeToPostId.get(el) === decision.id) {
            applyDecision(el, decision);
          }
        }
        callback();
      }
    );
  } catch (err) {
    logger.warn("CONTENT", "extension context disconnected:", err);
    for (const post of batch) {
      inFlightPostIds.delete(post.id);
      elementById.delete(post.id);
    }
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

export function flush() {
  if (pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    batchQueue.push(batch.slice(i, i + BATCH_SIZE));
  }
  processQueue();
}

/**
 * Scans a DOM root or subtree for candidate posts.
 * Utilizes identity-aware deduplication to support initial load, Load More, and container reuse.
 *
 * @param {Element|Object} root
 */
export function scan(root) {
  performanceStats.scanCalls++;
  const nodes = findContainers(root);

  if (isDebugEnabled()) {
    logger.debug(
      "CONTENT",
      `[SCAN] root=${root?.tagName || "UNKNOWN"} containersFound=${nodes.length}`
    );
  }

  for (const node of nodes) {
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
    if (!post) {
      if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
        logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> REJECTED (no valid text or ID extracted)`);
      }
      continue;
    }

    if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
      logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> ACCEPTED (${post.id})`);
    }

    const prevPostIdOnNode = nodeToPostId.get(node);

    // If node was previously used for a different post (DOM reuse), clean up previous state
    if (prevPostIdOnNode && prevPostIdOnNode !== post.id) {
      node.classList?.remove?.(HIDDEN_CLASS);
      node.removeAttribute?.("data-feedrule-hidden");
      if (node.dataset?.feedruleHidden) delete node.dataset.feedruleHidden;
      if (node.dataset?.feedruleWrapped) {
        delete node.dataset.feedruleWrapped;
        const oldPlaceholder = node.querySelector?.(".feedrule-placeholder");
        if (oldPlaceholder?.remove) oldPlaceholder.remove();
      }
      if (node.dataset?.feedruleUserRevealed) {
        delete node.dataset.feedruleUserRevealed;
      }
    }

    // Associate current post ID with this DOM node
    nodeToPostId.set(node, post.id);

    // 1. Check if we already have a cached classification decision for this post identity
    if (decisionsById.has(post.id)) {
      const cachedDecision = decisionsById.get(post.id);
      if (isDebugEnabled()) {
        logger.debug(
          "CONTENT",
          `[POST] id=${post.id} decision=${cachedDecision.hide ? "HIDE" : "SHOW"} alreadyProcessed=true (cached)`
        );
      }
      applyDecision(node, cachedDecision);
      continue;
    }

    // 2. Check if this post is already in-flight (queued in pending or batchQueue)
    if (inFlightPostIds.has(post.id)) {
      if (isDebugEnabled()) {
        logger.debug(
          "CONTENT",
          `[POST] id=${post.id} decision=PENDING alreadyProcessed=true (in-flight)`
        );
      }
      // Update element mapping in case node reference changed
      elementById.set(post.id, node);
      continue;
    }

    // 3. Genuinely new post identity: queue for classification
    if (isDebugEnabled()) {
      logger.debug("CONTENT", `[POST] id=${post.id} decision=UNPROCESSED alreadyProcessed=false`);
    }

    inFlightPostIds.add(post.id);
    elementById.set(post.id, node);
    pending.push(post);
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

/**
 * Centralized MutationObserver handler.
 * High-performance routed pipeline:
 * 1. Scope filter drops non-feed mutations (chat, nav, sidebars) immediately.
 * 2. Class mutations on hidden posts trigger synchronous presentation enforcement without queueing.
 * 3. Identity mutations (data-urn) trigger post container recycling / re-evaluation.
 * 4. Child additions queue only verified post containers or feed sections.
 *
 * @param {MutationRecord[]} mutations
 */
export function handleMutations(mutations) {
  performanceStats.mutationCallbacks++;
  let sawAdditions = false;

  for (const m of mutations || []) {
    const target = m.target;
    if (!target || target.nodeType !== 1) continue;

    // Fast Non-Feed Scope Filter (drops chat, nav, notifications in 1 check)
    if (!isRelevantFeedScope(target)) {
      performanceStats.ignoredMutations++;
      continue;
    }

    if (m.type === "attributes") {
      performanceStats.attributeMutations++;
      const attrName = m.attributeName;

      // Case A: Presentation Attribute (class)
      if (attrName === "class") {
        performanceStats.classMutations++;
        // Resolve enclosing container
        const enclosing = target.closest?.(COMBINED_CONTAINER_SELECTOR) || (target.matches?.(COMBINED_CONTAINER_SELECTOR) ? target : null);
        if (!enclosing) {
          performanceStats.ignoredMutations++;
          continue;
        }

        const currentPostId = nodeToPostId.get(enclosing);
        if (currentPostId && decisionsById.has(currentPostId)) {
          const decision = decisionsById.get(currentPostId);
          if (
            decision?.hide &&
            !userRevealedPostIds.has(currentPostId) &&
            enclosing.dataset?.feedruleUserRevealed !== "1"
          ) {
            // Synchronously re-assert hidden state if stripped by LinkedIn video playback
            if (!enclosing.classList?.contains?.(HIDDEN_CLASS)) {
              enclosing.classList?.add?.(HIDDEN_CLASS);
            }
            if (enclosing.getAttribute?.("data-feedrule-hidden") !== "true") {
              enclosing.setAttribute?.("data-feedrule-hidden", "true");
            }
            pauseVideosInContainer(enclosing);
          }
          // Class mutation on an already-classified post never triggers a scan
          performanceStats.ignoredMutations++;
          continue;
        }

        // Class mutations on unclassified nodes do not trigger scans
        performanceStats.ignoredMutations++;
        continue;
      }

      // Case B: Identity Attributes (data-urn, data-id, data-chameleon-urn)
      if (attrName === "data-urn" || attrName === "data-id" || attrName === "data-chameleon-urn") {
        performanceStats.identityMutations++;
        const enclosing = target.closest?.(COMBINED_CONTAINER_SELECTOR) || target;
        if (enclosing) {
          mutationQueue.add(enclosing);
          sawAdditions = true;
          performanceStats.relevantMutations++;
        }
        continue;
      }

      performanceStats.ignoredMutations++;
      continue;
    }

    // Case C: ChildList Mutations
    if (m.type === "childList") {
      performanceStats.childListMutations++;
      for (const node of m.addedNodes || []) {
        if (!node || node.nodeType !== 1) continue;

        if (!isRelevantFeedScope(node)) {
          performanceStats.ignoredMutations++;
          continue;
        }

        // Check if added node is inside an existing post container
        const enclosing = node.closest?.(COMBINED_CONTAINER_SELECTOR);
        if (enclosing) {
          const currentPostId = nodeToPostId.get(enclosing);
          if (currentPostId && decisionsById.has(currentPostId)) {
            const decision = decisionsById.get(currentPostId);
            if (
              decision?.hide &&
              !userRevealedPostIds.has(currentPostId) &&
              enclosing.dataset?.feedruleUserRevealed !== "1"
            ) {
              // Synchronously maintain hidden attributes
              if (!enclosing.classList?.contains?.(HIDDEN_CLASS)) {
                enclosing.classList?.add?.(HIDDEN_CLASS);
              }
              if (enclosing.getAttribute?.("data-feedrule-hidden") !== "true") {
                enclosing.setAttribute?.("data-feedrule-hidden", "true");
              }
              // If added node is or contains video, pause directly
              if (node.tagName === "VIDEO") {
                pauseSingleVideo(node);
              } else {
                pauseVideosInContainer(node);
              }
              performanceStats.ignoredMutations++;
              continue; // Do NOT queue already-hidden post
            }
          }
          // Unclassified enclosing post container
          mutationQueue.add(enclosing);
          sawAdditions = true;
          performanceStats.relevantMutations++;
          continue;
        }

        // Node is NOT inside an existing post container. Is it a post container candidate or feed root?
        if (node.matches?.(COMBINED_CONTAINER_SELECTOR) || isFeedContainerRoot(node)) {
          mutationQueue.add(node);
          sawAdditions = true;
          performanceStats.relevantMutations++;
        } else {
          // Check if it contains candidate post containers
          const hasPosts = node.querySelector?.(COMBINED_CONTAINER_SELECTOR);
          if (hasPosts) {
            mutationQueue.add(node);
            sawAdditions = true;
            performanceStats.relevantMutations++;
          } else {
            performanceStats.ignoredMutations++;
          }
        }
      }
    }
  }

  if (mutationQueue.size > performanceStats.mutationQueueMaxSize) {
    performanceStats.mutationQueueMaxSize = mutationQueue.size;
  }

  if (sawAdditions) {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(processMutationQueue, MUTATION_BUFFER_MS);
  }
}

if (typeof document !== "undefined") {
  logger.debug("CONTENT", "running initial scan...");
  scan(document.body);
  logger.debug("CONTENT", `initial scan found ${pending.length} post(s) pending`);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 0);

  // Dynamic feed root resolution: attach to feed root if available, otherwise document.body
  const feedRoot =
    document.querySelector("main.scaffold-layout__main") ||
    document.querySelector("div[data-testid='mainFeed']") ||
    document.querySelector(".scaffold-finite-scroll") ||
    document.body;

  const observer = new MutationObserver(handleMutations);

  observer.observe(feedRoot, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-urn", "data-id", "data-chameleon-urn", "class"],
  });
  logger.debug("CONTENT", "MutationObserver attached with scoped feed filter and enclosing-container resolution");
}
