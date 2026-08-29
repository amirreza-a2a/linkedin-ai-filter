// test/load-more-rescanning.test.js
// Hardened regression and contract tests for LinkedIn "Load More" / infinite scroll re-scanning,
// DOM container reuse, self-mutation loop defense, memory lifecycle bounding, and race conditions.

import test from "node:test";
import assert from "node:assert/strict";
import {
  scan,
  findContainers,
  extractPost,
  applyDecision,
  handleMutations,
  processMutationQueue,
  resetContentState,
  getPendingPosts,
  getCachedDecisions,
  getInFlightPostIds,
  getUserRevealedPostIds,
  getInFlightElementCount,
  cacheDecision,
} from "../src/content/content-index.js";

// Synthetic DOM Node mock tailored for content script testing
function createMockNode(tagName, attrs = {}, text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const attributes = { ...attrs };
  const children = [];
  const dataset = { ...attrs.dataset };
  const listeners = new Map();

  const node = {
    tagName: tagName.toUpperCase(),
    nodeType: 1, // Node.ELEMENT_NODE
    attributes,
    children,
    dataset,
    textContent: text,
    innerText: text,
    parentElement: null,
    firstChild: null,

    get className() {
      return this.getAttribute("class") || "";
    },
    set className(val) {
      this.setAttribute("class", val || "");
    },

    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
    },

    removeEventListener(event, fn) {
      if (listeners.has(event)) {
        const list = listeners.get(event);
        const idx = list.indexOf(fn);
        if (idx !== -1) list.splice(idx, 1);
      }
    },

    trigger(event) {
      const list = listeners.get(event) || [];
      for (const fn of list) fn();
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

    appendChild(child) {
      if (child) {
        child.parentElement = this;
        children.push(child);
        if (!this.firstChild) this.firstChild = child;
      }
      return child;
    },

    insertBefore(child, ref) {
      if (child) {
        child.parentElement = this;
        const idx = children.indexOf(ref);
        if (idx !== -1) {
          children.splice(idx, 0, child);
        } else {
          children.unshift(child);
        }
        this.firstChild = children[0] || null;
      }
      return child;
    },

    prepend(child) {
      if (child) {
        child.parentElement = this;
        children.unshift(child);
        this.firstChild = children[0];
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

  if (sel.startsWith("div.")) {
    if (tag !== "div") return false;
    const cls = sel.slice(4);
    return node.classList.contains(cls);
  }

  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    return node.classList.contains(cls);
  }

  if (sel.startsWith("div[data-urn*='activity:']")) {
    return tag === "div" && (node.getAttribute("data-urn") || "").includes("activity:");
  }

  if (sel.startsWith("div[data-urn*='ugcPost:']")) {
    return tag === "div" && (node.getAttribute("data-urn") || "").includes("ugcPost:");
  }

  if (sel.startsWith("div[data-id*='activity:']")) {
    return tag === "div" && (node.getAttribute("data-id") || "").includes("activity:");
  }

  if (sel === 'div[role="listitem"]') {
    return tag === "div" && node.getAttribute("role") === "listitem";
  }

  if (sel.startsWith("a.")) {
    if (tag !== "a") return false;
    const clsPart = sel.split("[")[0].slice(2);
    return node.classList.contains(clsPart);
  }

  if (sel.startsWith("a[")) {
    if (tag !== "a") return false;
    if (sel.includes("href*='/feed/update/'")) return (node.getAttribute("href") || "").includes("/feed/update/");
    if (sel.includes("href*='/in/'")) return (node.getAttribute("href") || "").includes("/in/");
    return true;
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

// Global Document mock for placeholder creation in applyDecision
const originalDoc = globalThis.document;
globalThis.document = {
  createElement: (tag) => createMockNode(tag),
  getElementById: () => null,
  querySelectorAll: () => [],
};

test("1. Load More: Newly inserted post DOM nodes are discovered and queued exactly once", () => {
  resetContentState();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const post1 = buildSyntheticPost("urn:li:activity:1001", "Alice Vance", "alice-vance", "First initial post in the feed");
  feedRoot.appendChild(post1);

  // Initial scan
  scan(feedRoot);
  let pending = getPendingPosts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "urn:li:activity:1001");

  // Apply decision for post 1
  applyDecision(post1, { id: "urn:li:activity:1001", hide: false, reason: "", topics: [] });

  // Simulate LinkedIn "Load More" inserting a second post
  const post2 = buildSyntheticPost("urn:li:activity:1002", "Bob Smith", "bob-smith", "Second post loaded via Load More button");
  feedRoot.appendChild(post2);

  // Mutation observer handles the addition
  handleMutations([
    {
      type: "childList",
      target: feedRoot,
      addedNodes: [post2],
    },
  ]);

  processMutationQueue();

  pending = getPendingPosts();
  // Must have added post 2, and must NOT have re-added post 1
  assert.equal(pending.length, 2);
  assert.equal(pending[1].id, "urn:li:activity:1002");
});

test("2. Container Reuse: Recycled DOM container replaces post identity and is re-classified", () => {
  resetContentState();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const container = buildSyntheticPost("urn:li:activity:2001", "Carol Danvers", "carol-danvers", "Original Post A in recycled container");
  feedRoot.appendChild(container);

  scan(feedRoot);
  let pending = getPendingPosts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "urn:li:activity:2001");

  // Post A is hidden by filter
  applyDecision(container, { id: "urn:li:activity:2001", hide: true, reason: "Filtered keyword", topics: ["spam"] });
  assert.equal(container.classList.contains("feedrule-hidden"), true);

  // Now LinkedIn recycles the SAME container node for Post B on Load More
  container.setAttribute("data-urn", "urn:li:activity:2002");
  const authorLink = container.querySelector("a[href*='/in/']");
  if (authorLink) authorLink.setAttribute("href", "https://www.linkedin.com/in/david-hassel/");
  const nameSpan = container.querySelector(".update-components-actor__name");
  if (nameSpan) nameSpan.innerText = "David Hassel";
  const permalink = container.querySelector("a[href*='/feed/update/']");
  if (permalink) permalink.setAttribute("href", "https://www.linkedin.com/feed/update/urn:li:activity:2002/");
  const textBox = container.querySelector(".update-components-text");
  if (textBox) textBox.innerText = "New Post B content loaded into recycled container";

  // Trigger mutation
  handleMutations([
    {
      type: "attributes",
      target: container,
      attributeName: "data-urn",
    },
  ]);

  processMutationQueue();

  pending = getPendingPosts();
  // Must discover Post B (urn:li:activity:2002)
  assert.equal(pending.length, 2);
  assert.equal(pending[1].id, "urn:li:activity:2002");
  assert.equal(pending[1].author, "David Hassel");

  // Previous hidden state should have been cleared for the new post
  assert.equal(container.classList.contains("feedrule-hidden"), false);
});

test("3. Self-Mutation Defense: Extension-owned placeholder and class mutations do not trigger re-scan loops", () => {
  resetContentState();

  const post = buildSyntheticPost("urn:li:activity:3001", "Ellen Ripley", "ellen-ripley", "Alien lifeform alert");
  scan(post);

  // Apply hidden decision (adds .feedrule-hidden and prepends .feedrule-placeholder)
  applyDecision(post, { id: "urn:li:activity:3001", hide: true, reason: "Xenomorph", topics: ["safety"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);

  const placeholder = post.querySelector(".feedrule-placeholder");
  assert.ok(placeholder, "Placeholder should exist");

  // FeedRule's own DOM mutations arrive at handleMutations
  handleMutations([
    {
      type: "childList",
      target: post,
      addedNodes: [placeholder],
    },
    {
      type: "attributes",
      target: post,
      attributeName: "class",
    },
  ]);

  // Process mutation queue: should be ignored by self-mutation defense
  processMutationQueue();

  // Pending queue should remain unchanged (no duplicate classification attempts)
  const pending = getPendingPosts();
  assert.equal(pending.length, 1);
});

test("4. User Override ('Show anyway'): clicking reveal is respected across re-scans and prevents re-hide loops", () => {
  resetContentState();

  const post = buildSyntheticPost("urn:li:activity:4001", "Garth Brooks", "garth-brooks", "Country music concert tour");
  scan(post);

  applyDecision(post, { id: "urn:li:activity:4001", hide: true, reason: "Music", topics: ["music"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);

  // User clicks "Show anyway" button
  const showBtn = post.querySelector(".feedrule-show-btn");
  assert.ok(showBtn);
  showBtn.trigger("click");

  // Should now be unhidden
  assert.equal(post.classList.contains("feedrule-hidden"), false);
  assert.equal(getUserRevealedPostIds().has("urn:li:activity:4001"), true);

  // Now a re-scan or mutation arrives on this element
  scan(post);

  // Must remain unhidden; must not be re-hidden by cached decision
  assert.equal(post.classList.contains("feedrule-hidden"), false);
});

test("5. Race Condition Protection: Delayed API response for Post A does not hide recycled Post B container", () => {
  resetContentState();

  const container = buildSyntheticPost("urn:li:activity:5001", "Hank Pym", "hank-pym", "Ant-Man technology");
  scan(container);

  // Post A is queued in-flight
  assert.equal(getPendingPosts().length, 1);

  // Now LinkedIn recycles the container for Post B before Post A returns
  container.setAttribute("data-urn", "urn:li:activity:5002");
  scan(container);

  // Delayed response for Post A (hide = true) arrives
  applyDecision(container, { id: "urn:li:activity:5001", hide: true, reason: "Quantum", topics: ["quantum"] });

  // Container is currently holding Post B, so Post A's delayed decision must NOT hide this container!
  assert.equal(container.classList.contains("feedrule-hidden"), false);
});

test("6. Memory Lifecycle: Bounded LRU cache caps decision storage at MAX_CACHED_DECISIONS", () => {
  resetContentState();

  // Insert 2050 decisions into cache
  for (let i = 0; i < 2050; i++) {
    cacheDecision(`urn:li:activity:${i}`, { id: `urn:li:activity:${i}`, hide: false });
  }

  const cached = getCachedDecisions();
  // Must be strictly bounded to 2000
  assert.equal(cached.size, 2000);
  // Oldest items (0-49) must have been evicted
  assert.equal(cached.has("urn:li:activity:0"), false);
  assert.equal(cached.has("urn:li:activity:49"), false);
  // Newest items (50-2049) must remain
  assert.equal(cached.has("urn:li:activity:50"), true);
  assert.equal(cached.has("urn:li:activity:2049"), true);
});

test("7. Deep child hydration inside existing post container discovers enclosing post", () => {
  resetContentState();

  const container = buildSyntheticPost("urn:li:activity:7001", "Iris West", "iris-west", "Central city news");
  const newInnerEl = createMockNode("span", { class: "feed-shared-inline-show-more-text" }, "Hydrated extra text");
  container.appendChild(newInnerEl);

  handleMutations([
    {
      type: "childList",
      target: container,
      addedNodes: [newInnerEl],
    },
  ]);

  processMutationQueue();

  const pending = getPendingPosts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "urn:li:activity:7001");
});

test("8. Load More scale: N newly loaded distinct post identities produce exactly N classifications", () => {
  resetContentState();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const addedNodes = [];

  // Simulate Load More producing 50 distinct posts
  for (let i = 0; i < 50; i++) {
    const post = buildSyntheticPost(`urn:li:activity:80${i}`, `Author ${i}`, `author-${i}`, `Content ${i}`);
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
  // Exactly 50 pending posts
  assert.equal(pending.length, 50);

  // Triggering the same mutations again should not produce duplicate dispatches
  handleMutations([
    {
      type: "childList",
      target: feedRoot,
      addedNodes,
    },
  ]);

  processMutationQueue();

  // Length must remain 50
  assert.equal(getPendingPosts().length, 50);
});
