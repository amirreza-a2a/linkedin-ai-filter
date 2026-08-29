// test/content-performance-stress.test.js
// High-volume performance & memory stress tests for LinkedIn content script architecture.
// Validates 10,000 irrelevant mutations, 500 Load More posts, 500 recycling ops, SPA feed root replacement, and memory lifecycle bounding.

import test from "node:test";
import assert from "node:assert/strict";
import {
  scan,
  applyDecision,
  handleMutations,
  processMutationQueue,
  resetContentState,
  getPendingPosts,
  getCachedDecisions,
  getUserRevealedPostIds,
  getInFlightElementCount,
  getContentPerformanceStats,
  resetPerformanceStats,
  attachFeedObserver,
  disconnectFeedObserver,
  findFeedRoot,
} from "../src/content/content-index.js";

// Mock node generator for stress testing
function createMockNode(tagName, attrs = {}, text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const attributes = { ...attrs };
  const children = [];
  const dataset = { ...attrs.dataset };

  const node = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes,
    children,
    dataset,
    textContent: text,
    innerText: text,
    parentElement: null,
    firstChild: null,
    paused: false,

    pause() {
      this.paused = true;
    },

    get className() {
      return this.getAttribute("class") || "";
    },
    set className(val) {
      this.setAttribute("class", val || "");
    },

    classList: {
      contains(cls) {
        return classListSet.has(cls);
      },
      add(cls) {
        classListSet.add(cls);
        attributes.class = Array.from(classListSet).join(" ");
      },
      remove(cls) {
        classListSet.delete(cls);
        attributes.class = Array.from(classListSet).join(" ");
      },
    },

    getAttribute(name) {
      return attributes[name] || null;
    },

    setAttribute(name, val) {
      attributes[name] = String(val);
      if (name === "class") {
        classListSet.clear();
        String(val).split(/\s+/).filter(Boolean).forEach((c) => classListSet.add(c));
      }
    },

    removeAttribute(name) {
      delete attributes[name];
      if (name === "class") classListSet.clear();
    },

    appendChild(child) {
      if (child) {
        child.parentElement = this;
        children.push(child);
        if (!this.firstChild) this.firstChild = child;
      }
      return child;
    },

    remove() {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) this.parentElement.children.splice(idx, 1);
        this.parentElement.firstChild = this.parentElement.children[0] || null;
        this.parentElement = null;
      }
    },

    closest(selector) {
      let curr = this;
      while (curr) {
        if (curr.matches && curr.matches(selector)) return curr;
        curr = curr.parentElement;
      }
      return null;
    },

    matches(selector) {
      return checkMatches(this, selector);
    },

    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },

    querySelectorAll(selector) {
      const subSelectors = selector.split(",").map((s) => s.trim());
      const results = [];
      function traverse(n) {
        if (!n || !n.children) return;
        for (const child of n.children) {
          for (const sub of subSelectors) {
            if (checkMatches(child, sub)) {
              results.push(child);
              break;
            }
          }
          traverse(child);
        }
      }
      traverse(this);
      return results;
    },
  };

  return node;
}

function checkMatches(node, sel) {
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toLowerCase();

  if (sel.includes(",")) {
    return sel.split(",").some((sub) => checkMatches(node, sub.trim()));
  }

  if (sel.startsWith("#")) {
    const id = sel.slice(1);
    return node.getAttribute("id") === id;
  }

  if (sel.startsWith("div.")) {
    if (tag !== "div") return false;
    const cls = sel.slice(4);
    return node.classList.contains(cls);
  }

  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    return node.classList.contains(cls);
  }

  if (sel === "aside" || sel === "header" || sel === "footer" || sel === "video") {
    return tag === sel;
  }

  if (sel.startsWith("div[data-urn*='activity:']")) {
    return tag === "div" && (node.getAttribute("data-urn") || "").includes("activity:");
  }

  if (sel === 'div[role="listitem"]') {
    return tag === "div" && node.getAttribute("role") === "listitem";
  }

  if (sel.startsWith('[data-testid="expandable-text-box"]')) {
    return node.getAttribute("data-testid") === "expandable-text-box";
  }

  return false;
}

function buildSyntheticPost(urnId, authorName, authorHandle, postText) {
  const container = createMockNode("div", {
    class: "feed-shared-update-v2",
    "data-urn": urnId,
  });

  const header = createMockNode("div", { class: "update-components-actor" });
  const authorLink = createMockNode("a", {
    class: "update-components-actor__container-link app-aware-link",
    href: `https://www.linkedin.com/in/${authorHandle}/`,
  });
  const nameSpan = createMockNode("span", { class: "update-components-actor__name" }, authorName);
  authorLink.appendChild(nameSpan);

  const permalink = createMockNode("a", {
    class: "update-components-actor__sub-description-link",
    href: `https://www.linkedin.com/feed/update/${urnId}/`,
  });

  header.appendChild(authorLink);
  header.appendChild(permalink);

  const body = createMockNode("div", {
    class: "update-components-text",
    "data-testid": "expandable-text-box",
  }, postText);

  container.appendChild(header);
  container.appendChild(body);

  return container;
}

// Global Document mock for placeholder creation
globalThis.document = {
  createElement: (tag) => createMockNode(tag),
  getElementById: () => null,
  querySelectorAll: () => [],
};

// Global MutationObserver mock
globalThis.MutationObserver = class MockMutationObserver {
  constructor(cb) {
    this.cb = cb;
    this.observedTarget = null;
  }
  observe(target) {
    this.observedTarget = target;
  }
  disconnect() {
    this.observedTarget = null;
  }
};

test("1. 10,000 irrelevant nav/chat mutations -> zero scans, zero dispatches, 0 queue growth", () => {
  resetContentState();
  resetPerformanceStats();

  const navBar = createMockNode("div", { id: "global-nav", class: "global-nav" });
  const chatOverlay = createMockNode("div", { class: "msg-overlay-container" });
  const asideRail = createMockNode("aside", { class: "scaffold-layout__aside" });

  const mutations = [];
  for (let i = 0; i < 10000; i++) {
    const target = (i % 3 === 0) ? navBar : (i % 3 === 1) ? chatOverlay : asideRail;
    mutations.push({
      type: "attributes",
      target,
      attributeName: "class",
    });
  }

  handleMutations(mutations);
  processMutationQueue();

  const stats = getContentPerformanceStats();
  assert.equal(stats.scanCalls, 0, "Scan calls must be 0 for non-feed class mutations");
  assert.equal(stats.classificationDispatches, 0, "Classification dispatches must be 0");
  assert.equal(stats.mutationQueueMaxSize, 0, "Peak mutationQueue size must be 0");
  assert.equal(stats.ignoredMutations, 10000, "All 10,000 mutations must be rejected");
  assert.equal(getPendingPosts().length, 0);
});

test("2. 5,000 irrelevant childList mutations -> zero scans and zero dispatches", () => {
  resetContentState();
  resetPerformanceStats();

  const chatContainer = createMockNode("div", { class: "msg-overlay-list-bubble" });
  const mutations = [];

  for (let i = 0; i < 5000; i++) {
    const chatBubble = createMockNode("div", { class: "msg-s-message-listitem" }, `Chat message ${i}`);
    chatContainer.appendChild(chatBubble);
    mutations.push({
      type: "childList",
      target: chatContainer,
      addedNodes: [chatBubble],
    });
  }

  handleMutations(mutations);
  processMutationQueue();

  const stats = getContentPerformanceStats();
  assert.equal(stats.scanCalls, 0, "Scan calls must be 0 for chat messages");
  assert.equal(stats.classificationDispatches, 0, "Classification dispatches must be 0");
  assert.equal(stats.ignoredMutations, 5000, "All 5,000 chat mutations must be rejected");
  assert.equal(getPendingPosts().length, 0);
});

test("3. 500 hidden-video class mutations -> zero full-container video traversals after initial processing", () => {
  resetContentState();
  resetPerformanceStats();

  const post = buildSyntheticPost("urn:li:activity:video500", "Video Streamer", "v-stream", "Live video trading session");
  const video = createMockNode("video", { class: "vjs-tech" });
  post.appendChild(video);

  scan(post);
  applyDecision(post, { id: "urn:li:activity:video500", hide: true, reason: "Trading video", topics: ["trading"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);
  assert.equal(video.paused, true);

  const statsAfterInit = getContentPerformanceStats();
  const traversalsAtInit = statsAfterInit.videoPauseTraversals;

  // Simulate 500 rapid video playback class mutations on the hidden post container
  const mutations = [];
  for (let i = 0; i < 500; i++) {
    post.setAttribute("class", `feed-shared-update-v2 video-playing-frame-${i}`);
    mutations.push({
      type: "attributes",
      target: post,
      attributeName: "class",
    });
  }

  handleMutations(mutations);
  processMutationQueue();

  const finalStats = getContentPerformanceStats();
  assert.equal(
    finalStats.videoPauseTraversals,
    traversalsAtInit,
    "500 class mutations must cause ZERO additional full-container video traversals"
  );
  assert.equal(finalStats.classificationDispatches, 0, "Zero classification requests on video mutations");
  assert.equal(post.classList.contains("feedrule-hidden"), true, "Post remains continuously hidden");
  assert.equal(post.getAttribute("data-feedrule-hidden"), "true");
});

test("4. 500 new Load More posts -> exactly 500 unique queued identities", () => {
  resetContentState();
  resetPerformanceStats();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const addedNodes = [];

  for (let i = 0; i < 500; i++) {
    const post = buildSyntheticPost(`urn:li:activity:scale${i}`, `Author ${i}`, `author-${i}`, `Load more content ${i}`);
    feedRoot.appendChild(post);
    addedNodes.push(post);
  }

  handleMutations([
    {
      type: "childList",
      target: feedRoot,
      addedNodes,
    },
  ]);

  processMutationQueue();

  const pending = getPendingPosts();
  assert.equal(pending.length, 500, "Must queue exactly 500 unique posts");

  // Re-firing the exact same mutations must NOT produce duplicate classifications
  handleMutations([
    {
      type: "childList",
      target: feedRoot,
      addedNodes,
    },
  ]);

  processMutationQueue();
  assert.equal(getPendingPosts().length, 500, "Length must strictly remain 500 (0 duplicates)");
});

test("5. 500 A -> B DOM recycling operations -> exactly 500 identity transitions detected", () => {
  resetContentState();
  resetPerformanceStats();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const containers = [];

  for (let i = 0; i < 500; i++) {
    const postA = buildSyntheticPost(`urn:li:activity:origA_${i}`, `Author A ${i}`, `author-a-${i}`, `Original Post A ${i}`);
    feedRoot.appendChild(postA);
    containers.push(postA);
  }

  scan(feedRoot);
  assert.equal(getPendingPosts().length, 500);

  for (let i = 0; i < 500; i++) {
    applyDecision(containers[i], { id: `urn:li:activity:origA_${i}`, hide: true, reason: "Filter A", topics: [] });
    assert.equal(containers[i].classList.contains("feedrule-hidden"), true);
  }

  // Now LinkedIn recycles all 500 containers to Post B
  const recycleMutations = [];
  for (let i = 0; i < 500; i++) {
    containers[i].setAttribute("data-urn", `urn:li:activity:recycledB_${i}`);
    const nameSpan = containers[i].querySelector(".update-components-actor__name");
    if (nameSpan) nameSpan.innerText = `Author B ${i}`;
    recycleMutations.push({
      type: "attributes",
      target: containers[i],
      attributeName: "data-urn",
    });
  }

  handleMutations(recycleMutations);
  processMutationQueue();

  const pending = getPendingPosts();
  assert.equal(pending.length, 1000, "500 Post A + 500 Post B = 1000 total queued");
  assert.equal(containers[0].classList.contains("feedrule-hidden"), false, "Recycled container must clear old hidden state");
});

test("6. Feed root replacement in SPA -> exactly one active observer at all times", () => {
  resetContentState();
  resetPerformanceStats();

  const feedRoot1 = createMockNode("main", { class: "scaffold-layout__main" });
  const feedRoot2 = createMockNode("div", { class: "scaffold-finite-scroll" });

  // Attach to feedRoot1
  attachFeedObserver(feedRoot1);
  let stats = getContentPerformanceStats();
  assert.equal(stats.currentObserverAttached, 1, "Exactly 1 observer attached");
  assert.equal(stats.observerAttachCount, 1);

  // Attach again to same feedRoot1 -> idempotent, does not duplicate
  attachFeedObserver(feedRoot1);
  stats = getContentPerformanceStats();
  assert.equal(stats.currentObserverAttached, 1, "Still exactly 1 observer attached");
  assert.equal(stats.observerAttachCount, 1);

  // SPA navigation replaces feedRoot1 with feedRoot2
  attachFeedObserver(feedRoot2);
  stats = getContentPerformanceStats();
  assert.equal(stats.currentObserverAttached, 1, "Exactly 1 observer attached after root replacement");
  assert.equal(stats.observerAttachCount, 2);
  assert.equal(stats.observerDisconnectCount, 1);
  assert.equal(stats.feedRootChanges, 1);

  disconnectFeedObserver();
  stats = getContentPerformanceStats();
  assert.equal(stats.currentObserverAttached, 0, "0 observers attached after disconnect");
});

test("7. Hidden post receives new video subtree -> newly inserted video is paused without scanning", () => {
  resetContentState();
  resetPerformanceStats();

  const post = buildSyntheticPost("urn:li:activity:dynvideo", "Media Network", "media-net", "Streaming finance review");
  scan(post);
  applyDecision(post, { id: "urn:li:activity:dynvideo", hide: true, reason: "Finance spam", topics: ["finance"] });

  // Dynamically insert a new video element into the hidden post
  const newVideo = createMockNode("video", { class: "vjs-tech dynamic-player" });
  post.appendChild(newVideo);

  handleMutations([
    {
      type: "childList",
      target: post,
      addedNodes: [newVideo],
    },
  ]);

  processMutationQueue();

  assert.equal(newVideo.paused, true, "Dynamically mounted video must be paused");
  assert.equal(getPendingPosts().length, 1, "Zero additional scans or classifications");
  assert.equal(post.classList.contains("feedrule-hidden"), true);
});

test("8. Hidden post receives repeated class mutations -> no duplicate classification requests", () => {
  resetContentState();
  resetPerformanceStats();

  const post = buildSyntheticPost("urn:li:activity:repclass", "Author Rep", "auth-rep", "Content for repeat class test");
  scan(post);
  applyDecision(post, { id: "urn:li:activity:repclass", hide: true, reason: "Spam", topics: [] });

  for (let i = 0; i < 50; i++) {
    post.setAttribute("class", `feed-shared-update-v2 tick-${i}`);
    handleMutations([{ type: "attributes", target: post, attributeName: "class" }]);
  }

  processMutationQueue();
  assert.equal(getPendingPosts().length, 1, "Pending posts must remain strictly 1");
});

test("9. Show Anyway + video mutations -> remains visible and never re-hidden", () => {
  resetContentState();
  resetPerformanceStats();

  const post = buildSyntheticPost("urn:li:activity:showanyway", "Host", "host", "Conference keynote");
  scan(post);
  applyDecision(post, { id: "urn:li:activity:showanyway", hide: true, reason: "Keynote", topics: [] });

  // Click Show anyway
  const showBtn = post.querySelector(".feedrule-show-btn");
  assert.ok(showBtn);
  // Trigger user reveal logic
  getUserRevealedPostIds().add("urn:li:activity:showanyway");
  post.dataset.feedruleUserRevealed = "1";
  post.classList.remove("feedrule-hidden");

  // Video mutations occur
  for (let i = 0; i < 20; i++) {
    post.setAttribute("class", `feed-shared-update-v2 video-playing-${i}`);
    handleMutations([{ type: "attributes", target: post, attributeName: "class" }]);
  }

  processMutationQueue();
  assert.equal(post.classList.contains("feedrule-hidden"), false, "Must remain visible");
});

test("10. Stale API response after container recycling -> never touches newly bound post", () => {
  resetContentState();
  resetPerformanceStats();

  const container = buildSyntheticPost("urn:li:activity:staleA", "Author A", "auth-a", "Post A content");
  scan(container);

  // Recycled to Post B before Post A response arrives
  container.setAttribute("data-urn", "urn:li:activity:staleB");
  scan(container);

  // Post A stale response arrives
  applyDecision(container, { id: "urn:li:activity:staleA", hide: true, reason: "Old filter", topics: [] });

  // Container is currently Post B, so Post A decision must NOT be applied to this container!
  assert.equal(container.classList.contains("feedrule-hidden"), false, "Stale response must not hide recycled container");
});

test("11. Memory lifecycle & DOM detachment test -> ensures 0 retained in-flight references", () => {
  resetContentState();
  resetPerformanceStats();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const createdPosts = [];

  for (let i = 0; i < 100; i++) {
    const post = buildSyntheticPost(`urn:li:activity:mem_${i}`, `Author ${i}`, `author-${i}`, `Memory test ${i}`);
    feedRoot.appendChild(post);
    createdPosts.push(post);
  }

  scan(feedRoot);
  assert.equal(getPendingPosts().length, 100);

  // Simulate completion of all 100 posts
  for (let i = 0; i < 100; i++) {
    applyDecision(createdPosts[i], { id: `urn:li:activity:mem_${i}`, hide: false });
  }

  // Detach all 100 DOM nodes from the tree (simulate virtualization/scrolling away)
  for (const post of createdPosts) {
    post.remove();
  }

  assert.equal(getInFlightElementCount(), 0, "elementById must have 0 entries when idle");
  const stats = getContentPerformanceStats();
  assert.equal(stats.inFlightCount, 0, "inFlightPostIds must be 0");
});
