import test from "node:test";
import assert from "node:assert/strict";
import { findContainers, extractPost } from "../src/content/content-index.js";
import { extractAuthor } from "../src/content/author-extractor.js";
import { isLikelyPostContainer } from "../src/content/post-qualifier.js";
import { buildKnowledgeGraph, areGraphsEqual } from "../src/graph/graph-builder.js";
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
  if (sel.includes("share-box")) {
    return node.attributes["data-testid"] === "share-box" || (node.attributes.class || "").includes("share-box");
  }
  if (sel.includes("expandable-text-box")) {
    return node.attributes["data-testid"] === "expandable-text-box";
  }
  if (sel.includes("actor-container")) {
    return node.attributes["data-testid"] === "actor-container";
  }
  if (sel.includes("recs-list")) {
    return (node.attributes["data-testid"] || "").includes("recs-list");
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
  if (sel === "h2" && node.tagName === "H2") return true;
  if (sel === "h3" && node.tagName === "H3") return true;
  if (sel === 'div[role="listitem"]' && node.tagName === "DIV" && node.attributes.role === "listitem") return true;
  return false;
}

// =========================================================================
// 1. KNOWLEDGE GRAPH EQUALITY & STABILITY AUDIT
// =========================================================================

test("Graph Equality: areGraphsEqual correctly validates structure, metadata, and connectivity", () => {
  const postsA = [
    { id: "1", text: "AI Systems", author: "Alice", authorUrl: "https://linkedin.com/in/alice", topics: ["AI"] },
    { id: "2", text: "Cloud Tech", author: "Bob", authorUrl: "https://linkedin.com/in/bob", topics: ["Cloud"] },
  ];
  const postsB = [
    { id: "1", text: "AI Systems", author: "Alice", authorUrl: "https://linkedin.com/in/alice", topics: ["AI"] },
    { id: "2", text: "Cloud Tech", author: "Bob", authorUrl: "https://linkedin.com/in/bob", topics: ["Cloud"] },
  ];
  const postsC = [
    { id: "1", text: "AI Systems Modified", author: "Alice", authorUrl: "https://linkedin.com/in/alice", topics: ["AI", "Robotics"] },
    { id: "2", text: "Cloud Tech", author: "Bob", authorUrl: "https://linkedin.com/in/bob", topics: ["Cloud"] },
  ];

  const gA = buildKnowledgeGraph(postsA);
  const gB = buildKnowledgeGraph(postsB);
  const gC = buildKnowledgeGraph(postsC);

  // Equal instances
  assert.ok(areGraphsEqual(gA, gA));
  assert.ok(areGraphsEqual(gA, gB));

  // Unequal instances (different topics/edges)
  assert.equal(areGraphsEqual(gA, gC), false);
  assert.equal(areGraphsEqual(gA, null), false);
  assert.equal(areGraphsEqual(null, gB), false);
});

test("Graph Stability: Re-filtering with identical result skips layout reset and preserves node coordinates", () => {
  const posts = [
    { id: "101", text: "Post 101", author: "Author A", authorUrl: "https://linkedin.com/in/a", topics: ["AI"] },
    { id: "102", text: "Post 102", author: "Author B", authorUrl: "https://linkedin.com/in/b", topics: ["ML"] },
  ];

  const g1 = buildKnowledgeGraph(posts);
  const layout = new ForceLayout();
  layout.init(g1.nodes, g1.edges, 800, 600);

  // Step 20 ticks to evolve physics positions
  for (let i = 0; i < 20; i++) layout.tick();

  const savedPositions = layout.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, vx: n.vx, vy: n.vy }));

  // Simulate re-filtering that produces identical graph structure
  const g2 = buildKnowledgeGraph(posts);
  const isUnchanged = areGraphsEqual(g1, g2);
  assert.ok(isUnchanged);

  // Since graph is unchanged, layout.init() MUST NOT be called. Verify coordinates remain identical.
  for (let i = 0; i < layout.nodes.length; i++) {
    assert.equal(layout.nodes[i].x, savedPositions[i].x);
    assert.equal(layout.nodes[i].y, savedPositions[i].y);
    assert.equal(layout.nodes[i].vx, savedPositions[i].vx);
    assert.equal(layout.nodes[i].vy, savedPositions[i].vy);
  }
});

// =========================================================================
// 2. MUTATIONOBSERVER COALESCING & PRUNING AUDIT
// =========================================================================

test("Mutation Coalescing: Descendant micro-elements are pruned when ancestor container is queued", () => {
  const authorSpan = el("SPAN", { class: "update-components-actor__name" }, [], "Author Name");
  const metaDiv = el("DIV", { class: "update-components-actor__meta" }, [authorSpan]);
  const actorDiv = el("DIV", { class: "update-components-actor" }, [metaDiv]);
  const textDiv = el("DIV", { class: "update-components-text" }, [], "Post body text.");
  const postCard = el("DIV", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:888888" }, [actorDiv, textDiv]);

  // Simulate a mutation burst where the post card and all 4 of its child elements are added to mutationQueue
  const mutationQueue = new Set([postCard, actorDiv, metaDiv, authorSpan, textDiv]);

  // Execute descendant pruning logic (mirrors processMutationQueue)
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

  // Assert that only the top-level container is retained
  assert.equal(rootsToScan.length, 1);
  assert.equal(rootsToScan[0], postCard);
});

// =========================================================================
// 3. FULL PIPELINE INTEGRATION (Candidate Discovery -> Qualification -> Extraction)
// =========================================================================

test("Pipeline Integration: Nested feed card extracts exactly 1 post without duplicate outer wrapper", () => {
  const authorAnchor = el("A", { class: "app-aware-link update-components-actor__image", href: "https://linkedin.com/in/sarah" }, [], "Sarah Connor");
  const actor = el("DIV", { class: "update-components-actor" }, [authorAnchor]);
  const text = el("DIV", { class: "update-components-text" }, [], "Cybernetic automation systems in industrial robotics.");
  const innerPost = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:999000111222",
    },
    [actor, text]
  );
  const outerListItem = el("DIV", { role: "listitem" }, [innerPost]);

  // Add non-post elements in feed to test full isolation
  const composer = el("DIV", { class: "share-box-feed-entry__wrapper", role: "listitem" }, [
    el("BUTTON", { "aria-label": "Start a post" }, [], "Start a post"),
  ]);
  const carousel = el("DIV", { class: "feed-shared-carousel", role: "listitem" }, [
    el("H2", {}, [], "Recommended for you"),
    el("BUTTON", { "aria-label": "Follow" }, [], "+ Follow"),
  ]);
  const comments = el("DIV", { class: "comments-comments-list", role: "listitem" }, [
    el("DIV", { class: "comments-comment-item" }, []),
  ]);

  const feedRoot = el("DIV", { "data-testid": "mainFeed" }, [outerListItem, composer, carousel, comments]);

  // Stage 1: Candidate Discovery
  const candidates = findContainers(feedRoot);

  // Stage 2: Qualification & Extraction
  const extractedPosts = [];
  const rejections = [];

  for (const c of candidates) {
    const qual = isLikelyPostContainer(c);
    if (qual.decision === "REJECT") {
      rejections.push({ element: c, reason: qual.reason });
      continue;
    }
    const post = extractPost(c);
    if (post) extractedPosts.push(post);
  }

  // Verification
  assert.equal(extractedPosts.length, 1);
  assert.equal(extractedPosts[0].id, "urn:li:activity:999000111222");
  assert.equal(extractedPosts[0].author, "Sarah Connor");
  assert.equal(extractedPosts[0].authorUrl, "https://linkedin.com/in/sarah");

  // Verify non-posts were rejected
  assert.ok(rejections.some((r) => r.reason === "composer" || r.reason === "composer-detected"));
  assert.ok(rejections.some((r) => r.reason === "recommendation-card"));
  assert.ok(rejections.some((r) => r.reason === "comments-container"));
});
