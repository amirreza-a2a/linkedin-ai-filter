// test/load-more-rescanning.test.js
// Regression and contract tests for LinkedIn "Load More" / infinite scroll re-scanning and DOM container reuse.

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
} from "../src/content/content-index.js";

// Synthetic DOM Node mock tailored for content script testing
function createMockNode(tagName, attrs = {}, text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const attributes = { ...attrs };
  const children = [];
  const dataset = { ...attrs.dataset };

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

    addEventListener(event, fn) {},
    removeEventListener(event, fn) {},

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
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement: (tag) => createMockNode(tag),
  };
}

test("Load More Scenario 1: Newly inserted post DOM nodes are discovered and queued exactly once", () => {
  resetContentState();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const post1 = buildSyntheticPost("urn:li:activity:1001", "Alice Vance", "alice-vance", "First initial post in the feed");
  feedRoot.appendChild(post1);

  // 1. Initial scan
  scan(feedRoot);
  let pending = getPendingPosts();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, "urn:li:activity:1001");

  // Apply decision for post 1
  applyDecision(post1, { id: "urn:li:activity:1001", hide: false, reason: "", topics: [] });

  // 2. Simulate LinkedIn "Load More" inserting a second post
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

test("Load More Scenario 2: Reused / Mutated DOM container replaces post identity and is re-classified", () => {
  resetContentState();

  const feedRoot = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  // Container originally holds Post A
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

test("Load More Scenario 3: Deep child insertion inside existing container resolves enclosing container", () => {
  resetContentState();

  const container = buildSyntheticPost("urn:li:activity:3001", "Eve Polastri", "eve-polastri", "Post text");
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
  assert.equal(pending[0].id, "urn:li:activity:3001");
});

test("Load More Scenario 4: Re-rendering already-classified post re-applies decision from cache with 0 network calls", () => {
  resetContentState();

  // 1. Initial post classified as hidden
  const post1 = buildSyntheticPost("urn:li:activity:4001", "Frank Castle", "frank-castle", "Targeted crypto scam post");
  scan(post1);

  applyDecision(post1, { id: "urn:li:activity:4001", hide: true, reason: "Crypto spam", topics: ["crypto"] });
  assert.equal(post1.classList.contains("feedrule-hidden"), true);

  // 2. LinkedIn DOM re-renders the same post into a brand new DOM container (e.g. after tab switch / scroll)
  const post1ReRender = buildSyntheticPost("urn:li:activity:4001", "Frank Castle", "frank-castle", "Targeted crypto scam post");
  assert.equal(post1ReRender.classList.contains("feedrule-hidden"), false);

  // 3. Scan re-rendered node
  scan(post1ReRender);

  // Must immediately apply cached decision (hidden) without adding to pending queue!
  assert.equal(post1ReRender.classList.contains("feedrule-hidden"), true);
  const pending = getPendingPosts();
  // Pending posts length should still be 1 (only the first initial occurrence)
  assert.equal(pending.length, 1);
});
