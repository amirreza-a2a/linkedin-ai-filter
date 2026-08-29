// test/pipeline-audit-regressions.test.js
// Dedicated regression test suite for pipeline scope resolution, flush lifecycle, and debug isolation.

import test from "node:test";
import assert from "node:assert/strict";

import {
  isRelevantFeedScope,
  scan,
  flush,
  getPendingPosts,
  resetContentState,
  extractPost,
  findContainers,
  findFeedRoot,
} from "../src/content/content-index.js";

import { isDebugEnabled } from "../src/utils/logger.js";

// Synthetic DOM Node mock tailored for hierarchy and selector matching
function createNode(tagName, attrs = {}, parent = null) {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const attributes = { ...attrs };
  const children = [];

  const node = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes,
    children,
    parentElement: parent,
    textContent: attrs.text || "",
    innerText: attrs.text || "",

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

    appendChild(child) {
      if (child) {
        child.parentElement = this;
        children.push(child);
      }
      return child;
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
      if (!selector) return false;
      const subSelectors = selector.split(",").map((s) => s.trim());
      for (let sel of subSelectors) {
        let match = true;
        let s = sel;

        // Tag name check
        const tagMatch = s.match(/^([a-zA-Z0-9]+)/);
        if (tagMatch) {
          if (this.tagName !== tagMatch[1].toUpperCase()) {
            continue;
          }
          s = s.slice(tagMatch[1].length);
        }

        // Classes check
        const classes = s.match(/\.([a-zA-Z0-9_-]+)/g) || [];
        for (const cls of classes) {
          if (!classListSet.has(cls.slice(1))) {
            match = false;
            break;
          }
        }
        if (!match) continue;

        // IDs check
        const ids = s.match(/#([a-zA-Z0-9_-]+)/g) || [];
        for (const id of ids) {
          if (attributes.id !== id.slice(1)) {
            match = false;
            break;
          }
        }
        if (!match) continue;

        // Attributes check
        const attrMatches = s.match(/\[([a-zA-Z0-9_-]+)([\*~^$|]?=)?(['"]?)([^\]'"]*)\3\]/g) || [];
        for (const attrStr of attrMatches) {
          const m = attrStr.match(/\[([a-zA-Z0-9_-]+)(?:([\*~^$|]?=)(['"]?)([^\]'"]*)\3)?\]/);
          if (m) {
            const attrName = m[1];
            const op = m[2];
            const val = m[4];
            const actualVal = attributes[attrName];
            if (actualVal === undefined || actualVal === null) {
              match = false;
              break;
            }
            if (op === "=" && actualVal !== val) { match = false; break; }
            if (op === "*=" && !actualVal.includes(val)) { match = false; break; }
          }
        }

        if (match) return true;
      }
      return false;
    },

    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },

    querySelectorAll(selector) {
      const results = [];
      function traverse(n) {
        if (!n || !n.children) return;
        for (const child of n.children) {
          if (child.matches(selector)) results.push(child);
          traverse(child);
        }
      }
      traverse(this);
      return results;
    },
  };

  if (parent) {
    parent.appendChild(node);
  }

  return node;
}

// ---------------------------------------------------------------------------
// 1. SCOPE REGRESSION TESTS
// ---------------------------------------------------------------------------

test("Scope Regression: Post headers inside feed must NEVER be rejected", () => {
  const feedRoot = createNode("main", { class: "scaffold-layout__main" });
  const post = createNode("div", { class: "feed-shared-update-v2" }, feedRoot);

  const sharedHeader = createNode("header", { class: "feed-shared-header" }, post);
  const updateHeader = createNode("header", { class: "update-components-header" }, post);
  const actorHeader = createNode("div", { class: "update-components-actor" }, post);

  assert.equal(isRelevantFeedScope(sharedHeader), true, "feed-shared-header must be accepted");
  assert.equal(isRelevantFeedScope(updateHeader), true, "update-components-header must be accepted");
  assert.equal(isRelevantFeedScope(actorHeader), true, "update-components-actor must be accepted");
});

test("Scope Regression: Global non-feed chrome regions must be strictly rejected", () => {
  const body = createNode("body");
  const nav = createNode("header", { class: "global-nav", id: "global-nav" }, body);
  const navInput = createNode("input", { id: "search" }, nav);

  const aside = createNode("aside", { class: "scaffold-layout__aside" }, body);
  const asideWidget = createNode("div", { class: "news-module" }, aside);

  const footer = createNode("footer", { class: "global-footer" }, body);
  const footerLink = createNode("a", { href: "/help" }, footer);

  const chat = createNode("div", { class: "msg-overlay-container" }, body);
  const chatBubble = createNode("div", { class: "msg-overlay-list-bubble" }, chat);

  assert.equal(isRelevantFeedScope(navInput), false, "global-nav header must be rejected");
  assert.equal(isRelevantFeedScope(asideWidget), false, "sidebar aside must be rejected");
  assert.equal(isRelevantFeedScope(footerLink), false, "global footer must be rejected");
  assert.equal(isRelevantFeedScope(chatBubble), false, "messaging overlay must be rejected");
});

// ---------------------------------------------------------------------------
// 2. FLUSH SEMANTICS & TIMER LIFECYCLE TESTS
// ---------------------------------------------------------------------------

test("Flush Lifecycle: scan() automatically arms flush timer and drains pending posts", async () => {
  resetContentState();

  const container = createNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:timer_1" });
  createNode("div", { class: "update-components-text", text: "Software engineering career post." }, container);

  scan(container);
  assert.equal(getPendingPosts().length, 1, "post must be added to pending");

  // Explicit flush drains pending immediately
  flush();
  assert.equal(getPendingPosts().length, 0, "flush must drain pending posts array");
});

test("Flush Lifecycle: Multiple scan() calls share debounce window without accumulating duplicate timers", async () => {
  resetContentState();

  const container1 = createNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:timer_2" });
  createNode("div", { class: "update-components-text", text: "First post." }, container1);

  const container2 = createNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:timer_3" });
  createNode("div", { class: "update-components-text", text: "Second post." }, container2);

  scan(container1);
  scan(container2);

  assert.equal(getPendingPosts().length, 2, "both posts queued in pending");
  flush();
  assert.equal(getPendingPosts().length, 0, "flush drains all coalesced pending posts");
});

// ---------------------------------------------------------------------------
// 3. DEBUG ISOLATION & GATING REGRESSION TESTS
// ---------------------------------------------------------------------------

test("Debug Gating: isDebugEnabled() returns false by default for clean production", () => {
  // Ensure global flags are clean
  delete globalThis.__FEEDRULE_DEBUG__;
  delete process.env.FEEDRULE_DEBUG;

  assert.equal(isDebugEnabled(), false, "isDebugEnabled must return false by default");
});

// ---------------------------------------------------------------------------
// 4. REAL DOM STRUCTURE FIXTURE TEST
// ---------------------------------------------------------------------------

test("DOM Contract: matches actual LinkedIn feed hierarchy", () => {
  const main = createNode("main", { class: "scaffold-layout__main", id: "main" });
  const stream = createNode("div", { class: "scaffold-finite-scroll__content" }, main);
  const post = createNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:real_dom_1" }, stream);
  
  const actor = createNode("div", { class: "update-components-actor" }, post);
  const link = createNode("a", { class: "app-aware-link", href: "https://www.linkedin.com/in/octocat/" }, actor);
  createNode("span", { class: "update-components-actor__name", text: "The Octocat" }, link);

  createNode("div", { class: "update-components-text", text: "Excited to share our open source release!" }, post);

  const doc = {
    querySelector: (sel) => {
      if (sel === "main.scaffold-layout__main") return main;
      return null;
    }
  };

  const root = findFeedRoot(doc);
  assert.equal(root, main);

  const containers = findContainers(root);
  assert.equal(containers.length, 1);

  const extracted = extractPost(containers[0]);
  assert.equal(extracted.id, "urn:li:activity:real_dom_1");
  assert.equal(extracted.author, "The Octocat");
  assert.ok(extracted.text.includes("open source release"));
});
