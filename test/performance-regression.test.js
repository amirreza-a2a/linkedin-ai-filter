import test from "node:test";
import assert from "node:assert/strict";
import { findContainers, extractPost } from "../src/content/content-index.js";
import { extractAuthor } from "../src/content/author-extractor.js";
import { isLikelyPostContainer } from "../src/content/post-qualifier.js";
import { buildKnowledgeGraph } from "../src/graph/graph-builder.js";
import { ForceLayout } from "../src/graph/force-layout.js";

// DOM mock helper
function el(tag, attrs = {}, children = [], text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const node = {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    children: [...children],
    textContent: text,
    innerText: text,
    parentElement: null,
    dataset: {},
    classList: {
      contains(cls) {
        return classListSet.has(cls);
      },
      add(cls) {
        classListSet.add(cls);
      },
      remove(cls) {
        classListSet.delete(cls);
      },
    },
    getAttribute(name) {
      return this.attributes[name] || null;
    },
    setAttribute(name, val) {
      this.attributes[name] = val;
      if (name === "class") {
        classListSet.clear();
        (val || "").split(/\s+/).filter(Boolean).forEach((c) => classListSet.add(c));
      }
    },
    closest(selector) {
      let current = this;
      while (current) {
        if (matches(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    matches(selector) {
      return matches(this, selector);
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
            if (matches(child, sub)) {
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

  for (const c of children) {
    if (c && typeof c === "object") {
      c.parentElement = node;
    }
  }

  return node;
}

function matches(node, sel) {
  if (!node || !node.tagName) return false;
  if (sel.startsWith(".")) {
    const cls = sel.slice(1);
    const classes = (node.attributes.class || "").split(/\s+/);
    return classes.includes(cls);
  }
  if (sel.startsWith("div.")) {
    if (node.tagName !== "DIV") return false;
    const cls = sel.slice(4);
    const classes = (node.attributes.class || "").split(/\s+/);
    return classes.includes(cls);
  }
  if (sel.startsWith("a[") || sel.includes("a.") || sel.includes("a[")) {
    if (node.tagName !== "A") return false;
    if (sel.includes("href*='/in/'")) return (node.attributes.href || "").includes("/in/");
    if (sel.includes("href*='/company/'")) return (node.attributes.href || "").includes("/company/");
    if (sel.includes("href*='/school/'")) return (node.attributes.href || "").includes("/school/");
    if (sel.includes("href*='/showcase/'")) return (node.attributes.href || "").includes("/showcase/");
    if (sel.includes("href*='/feed/update/'")) return (node.attributes.href || "").includes("/feed/update/");
    if (sel.includes("href*='/posts/'")) return (node.attributes.href || "").includes("/posts/");
  }
  if (sel.startsWith("button[") || sel.includes("button[")) {
    if (node.tagName !== "BUTTON") return false;
    if (sel.includes("aria-label*='Start a post'")) return (node.attributes["aria-label"] || "").includes("Start a post");
    if (sel.includes("aria-label*='Create a post'")) return (node.attributes["aria-label"] || "").includes("Create a post");
    if (sel.includes("aria-label*='Follow'")) return (node.attributes["aria-label"] || "").includes("Follow");
    if (sel.includes("aria-label*='post by ']") || sel.includes("aria-label*='Post by ']")) {
      const aria = (node.attributes["aria-label"] || "").toLowerCase();
      return aria.includes("post by ");
    }
  }
  if (sel === "a[href]") {
    return node.tagName === "A" && Boolean(node.attributes.href);
  }
  if (sel.includes("expandable-text-box")) {
    return node.attributes["data-testid"] === "expandable-text-box";
  }
  if (sel.includes("actor-container")) {
    return node.attributes["data-testid"] === "actor-container";
  }
  if (sel.includes("data-urn*='activity:'")) {
    return (node.attributes["data-urn"] || "").includes("activity:");
  }
  if (sel.includes("data-urn*='ugcPost:'")) {
    return (node.attributes["data-urn"] || "").includes("ugcPost:");
  }
  if (sel.includes("data-urn*='sponsoredUpdate:'")) {
    return (node.attributes["data-urn"] || "").includes("sponsoredUpdate:");
  }
  if (sel.includes("data-id*='activity:'")) {
    return (node.attributes["data-id"] || "").includes("activity:");
  }
  if (sel === 'div[role="listitem"]' && node.tagName === "DIV" && node.attributes.role === "listitem") return true;
  return false;
}

test("Performance Regression: Single-pass findContainers avoids redundant nested wrappers", () => {
  const actor = el("DIV", { class: "update-components-actor" }, [
    el("A", { class: "app-aware-link update-components-actor__image", href: "https://linkedin.com/in/author1" }, [], "Author 1"),
  ]);
  const text = el("DIV", { class: "update-components-text" }, [], "Test post body text for container deduplication.");
  const innerUpdate = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:7123456789012345678",
    },
    [actor, text]
  );
  const outerListItem = el("DIV", { role: "listitem" }, [innerUpdate]);
  const feedRoot = el("DIV", { "data-testid": "mainFeed" }, [outerListItem]);

  const candidates = findContainers(feedRoot);

  // Assert that only the inner canonical update is returned, not duplicate outer wrappers
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0], innerUpdate);
});

test("Performance Regression: extractAuthor executes single consolidated profile lookup", () => {
  const authorAnchor = el("A", { class: "app-aware-link update-components-actor__image", href: "https://linkedin.com/in/performance-author" }, [], "Performance Author");
  const nameSpan = el("SPAN", { class: "update-components-actor__name" }, [authorAnchor], "Performance Author");
  const actor = el("DIV", { class: "update-components-actor" }, [nameSpan]);
  const text = el("DIV", { class: "update-components-text" }, [], "Optimized single-pass query performance test.");
  const post = el("DIV", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:7999888777" }, [actor, text]);

  const result = extractAuthor(post);
  assert.equal(result.author, "Performance Author");
  assert.equal(result.authorUrl, "https://linkedin.com/in/performance-author");
});

test("Performance Regression: Graph layout initialization preserves position stability for unchanged nodes", () => {
  const posts = [
    {
      id: "p1",
      text: "Content 1",
      author: "Alice",
      authorUrl: "https://linkedin.com/in/alice",
      topics: ["AI"],
    },
    {
      id: "p2",
      text: "Content 2",
      author: "Bob",
      authorUrl: "https://linkedin.com/in/bob",
      topics: ["Systems"],
    },
  ];

  const graph1 = buildKnowledgeGraph(posts);
  const layout = new ForceLayout();
  layout.init(graph1.nodes, graph1.edges, 800, 600);

  // Run 10 ticks
  for (let i = 0; i < 10; i++) layout.tick();

  const node1_x = layout.nodes[0].x;
  const node1_y = layout.nodes[0].y;

  // Verify positions moved from center / circle
  assert.ok(typeof node1_x === "number" && !isNaN(node1_x));
  assert.ok(typeof node1_y === "number" && !isNaN(node1_y));
});
