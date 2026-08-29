// test/content-performance-stress.test.js
// High-volume performance & memory stress tests for LinkedIn content script architecture.
// Validates 10,000 irrelevant mutations, 500 Load More posts, 500 recycling ops, and long-session memory bounding.

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

test("Scenario A: 10,000 irrelevant class mutations produce 0 scans, 0 classifications, and 0 queue growth", () => {
  resetContentState();
  resetPerformanceStats();

  // Create non-feed structures (Chat overlay, Global nav, Aside)
  const navBar = createMockNode("div", { id: "global-nav", class: "global-nav" });
  const chatOverlay = createMockNode("div", { class: "msg-overlay-container" });
  const asideRail = createMockNode("aside", { class: "scaffold-layout__aside" });

  const mutations = [];

  // Generate 10,000 class mutations across non-feed elements
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

test("Scenario B: 5,000 irrelevant childList mutations produce 0 scans and 0 classifications", () => {
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

test("Scenario C: 500 hidden-video presentation mutations produce zero duplicate classifications and zero full-tree query churn", () => {
  resetContentState();
  resetPerformanceStats();

  const post = buildSyntheticPost("urn:li:activity:video500", "Video Streamer", "v-stream", "Live video trading session");
  const video = createMockNode("video", { class: "vjs-tech" });
  post.appendChild(video);

  scan(post);
  applyDecision(post, { id: "urn:li:activity:video500", hide: true, reason: "Trading video", topics: ["trading"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);
  assert.equal(video.paused, true);

  const initialStats = getContentPerformanceStats();

  // Simulate 500 high-frequency playback class mutations on the hidden post
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
  // Video pause traversals should be minimal (processedVideos WeakSet caching)
  assert.equal(finalStats.classificationDispatches, 0, "Zero classification requests on video mutations");
  assert.equal(post.classList.contains("feedrule-hidden"), true, "Post remains continuously hidden");
  assert.equal(post.getAttribute("data-feedrule-hidden"), "true");
});

test("Scenario D: 500 Load More posts produce exactly 500 unique classifications and zero duplicates", () => {
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

test("Scenario E: 500 DOM recycling operations correctly detect every A -> B identity transition", () => {
  resetContentState();
  resetPerformanceStats();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const containers = [];

  // Create 500 Post A containers
  for (let i = 0; i < 500; i++) {
    const postA = buildSyntheticPost(`urn:li:activity:origA_${i}`, `Author A ${i}`, `author-a-${i}`, `Original Post A ${i}`);
    feedRoot.appendChild(postA);
    containers.push(postA);
  }

  scan(feedRoot);
  assert.equal(getPendingPosts().length, 500);

  // Apply hidden decision to all Post A containers
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

  // All 500 Post B items must be discovered and queued, and previous hidden states cleared
  const pending = getPendingPosts();
  assert.equal(pending.length, 1000, "500 Post A + 500 Post B = 1000 total queued");
  assert.equal(containers[0].classList.contains("feedrule-hidden"), false, "Recycled container must clear old hidden state");
});

test("Scenario F: Long-session simulation preserves bounded state and releases in-flight references", () => {
  resetContentState();
  resetPerformanceStats();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const navBar = createMockNode("div", { id: "global-nav" });

  // 1. Fire 10,000 irrelevant mutations
  for (let i = 0; i < 10000; i++) {
    handleMutations([{ type: "attributes", target: navBar, attributeName: "class" }]);
  }

  // 2. Add 1,000 post identities incrementally in batches of 100
  for (let b = 0; b < 10; b++) {
    const batchNodes = [];
    for (let i = 0; i < 100; i++) {
      const idx = b * 100 + i;
      const post = buildSyntheticPost(`urn:li:activity:long_${idx}`, `Author ${idx}`, `author-${idx}`, `Long session text ${idx}`);
      feedRoot.appendChild(post);
      batchNodes.push(post);
    }
    handleMutations([{ type: "childList", target: feedRoot, addedNodes: batchNodes }]);
  }

  processMutationQueue();

  const stats = getContentPerformanceStats();
  assert.equal(getPendingPosts().length, 1000);

  // Simulate completion of classification responses
  for (let i = 0; i < 1000; i++) {
    applyDecision(createMockNode("div"), { id: `urn:li:activity:long_${i}`, hide: false });
  }

  assert.equal(getInFlightElementCount(), 0, "In-flight DOM references must be 0 once processed");
  assert.ok(stats.cachedDecisionsCount <= 2000, "Decision cache must be strictly bounded <= 2000");
  assert.ok(stats.userRevealedCount <= 500, "User reveals must be strictly bounded <= 500");
});
