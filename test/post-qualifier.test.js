import test from "node:test";
import assert from "node:assert/strict";
import { isLikelyPostContainer } from "../src/content/post-qualifier.js";

// Minimal DOM mock helper
function el(tag, attrs = {}, children = [], text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));

  const node = {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    children: [...children],
    textContent: text,
    innerText: text,
    parentElement: null,
    classList: {
      contains(cls) {
        return classListSet.has(cls);
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
  if (sel.startsWith("a[")) {
    if (node.tagName !== "A") return false;
    if (sel.includes("href*='/in/'")) return (node.attributes.href || "").includes("/in/");
    if (sel.includes("href*='/company/'")) return (node.attributes.href || "").includes("/company/");
    if (sel.includes("href*='/school/'")) return (node.attributes.href || "").includes("/school/");
    if (sel.includes("href*='/showcase/'")) return (node.attributes.href || "").includes("/showcase/");
    if (sel.includes("href*='/feed/update/'")) return (node.attributes.href || "").includes("/feed/update/");
    if (sel.includes("href*='/posts/'")) return (node.attributes.href || "").includes("/posts/");
  }
  if (sel.startsWith("button[")) {
    if (node.tagName !== "BUTTON") return false;
    if (sel.includes("aria-label*='Start a post'")) return (node.attributes["aria-label"] || "").includes("Start a post");
    if (sel.includes("aria-label*='Create a post'")) return (node.attributes["aria-label"] || "").includes("Create a post");
    if (sel.includes("aria-label*='Follow'")) return (node.attributes["aria-label"] || "").includes("Follow");
  }
  if (sel === "a[href]") {
    return node.tagName === "A" && Boolean(node.attributes.href);
  }
  if (sel.includes("[data-testid='share-box']")) {
    return node.attributes["data-testid"] === "share-box";
  }
  if (sel.includes("[data-testid='expandable-text-box']")) {
    return node.attributes["data-testid"] === "expandable-text-box";
  }
  if (sel.includes("[data-testid='actor-container']")) {
    return node.attributes["data-testid"] === "actor-container";
  }
  if (sel.includes("[data-testid*='recs-list']")) {
    return (node.attributes["data-testid"] || "").includes("recs-list");
  }
  if (sel.includes("[data-urn*='activity:']")) {
    return (node.attributes["data-urn"] || "").includes("activity:");
  }
  if (sel.includes("[data-urn*='ugcPost:']")) {
    return (node.attributes["data-urn"] || "").includes("ugcPost:");
  }
  if (sel === "h2" && node.tagName === "H2") return true;
  if (sel === "h3" && node.tagName === "H3") return true;
  return false;
}

test("Post Qualifier: Real Post -> ACCEPTED", () => {
  const actor = el("DIV", { class: "update-components-actor" }, [
    el("A", { class: "app-aware-link", href: "https://www.linkedin.com/in/alice" }, [], "Alice"),
  ]);
  const text = el("DIV", { class: "update-components-text" }, [], "Great breakthroughs in autonomous agents.");
  const post = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:7123456789012345678",
    },
    [actor, text]
  );

  const res = isLikelyPostContainer(post);
  assert.equal(res.qualified, true);
  assert.equal(res.reason, "activity-urn-and-content");
});

test("Post Qualifier: Repost / Reshare -> ACCEPTED", () => {
  const actor = el("DIV", { class: "update-components-actor" }, [
    el("A", { class: "app-aware-link", href: "https://www.linkedin.com/in/bob" }, [], "Bob"),
  ]);
  const text = el("DIV", { class: "feed-shared-update-v2__description" }, [], "Check out this insightful perspective on LLMs.");
  const repost = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:7999888777666555444",
    },
    [actor, text]
  );

  const res = isLikelyPostContainer(repost);
  assert.equal(res.qualified, true);
  assert.equal(res.reason, "activity-urn-and-content");
});

test("Post Qualifier: Sponsored / Promoted Post -> ACCEPTED", () => {
  const sponsorActor = el("DIV", { class: "feed-shared-actor" }, [
    el("A", { class: "app-aware-link", href: "https://www.linkedin.com/company/tech-corp" }, [], "Tech Corp"),
  ]);
  const sponsorText = el("DIV", { class: "update-components-text" }, [], "Accelerate your AI workloads with enterprise infrastructure.");
  const sponsoredPost = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:sponsoredUpdate:1122334455",
    },
    [sponsorActor, sponsorText]
  );

  const res = isLikelyPostContainer(sponsoredPost);
  assert.equal(res.qualified, true);
  assert.equal(res.reason, "activity-urn-and-content");
});

test("Post Qualifier: 'Recommended for you' / PYMK Card -> REJECTED", () => {
  const header = el("H2", {}, [], "Recommended for you");
  const card1 = el("DIV", { class: "feed-shared-actor-recommendation" }, [
    el("A", { href: "https://www.linkedin.com/in/rec-1" }, [], "Person 1"),
    el("BUTTON", { "aria-label": "Follow Person 1" }, [], "+ Follow"),
  ]);
  const card2 = el("DIV", { class: "feed-shared-actor-recommendation" }, [
    el("A", { href: "https://www.linkedin.com/in/rec-2" }, [], "Person 2"),
    el("BUTTON", { "aria-label": "Follow Person 2" }, [], "+ Follow"),
  ]);
  const card3 = el("DIV", { class: "feed-shared-actor-recommendation" }, [
    el("A", { href: "https://www.linkedin.com/in/rec-3" }, [], "Person 3"),
    el("BUTTON", { "aria-label": "Follow Person 3" }, [], "+ Follow"),
  ]);

  const recsCarousel = el(
    "DIV",
    {
      class: "feed-shared-carousel",
      role: "listitem",
    },
    [header, card1, card2, card3]
  );

  const res = isLikelyPostContainer(recsCarousel);
  assert.equal(res.qualified, false);
  assert.equal(res.reason, "recommendation-card");
});

test("Post Qualifier: 'Start a post' Composer -> REJECTED", () => {
  const composerBtn = el("BUTTON", { "aria-label": "Start a post, try writing with AI" }, [], "Start a post");
  const composerBox = el(
    "DIV",
    {
      class: "share-box-feed-entry__wrapper",
      role: "listitem",
    },
    [composerBtn]
  );

  const res = isLikelyPostContainer(composerBox);
  assert.equal(res.qualified, false);
  assert.equal(res.reason, "composer-detected");
});

test("Post Qualifier: Comments-Only Container -> REJECTED", () => {
  const comment1 = el("DIV", { class: "comments-comment-item" }, [
    el("A", { href: "https://www.linkedin.com/in/commenter" }, [], "Commenter"),
  ]);
  const commentsList = el("DIV", { class: "comments-comments-list" }, [comment1]);

  const res = isLikelyPostContainer(commentsList);
  assert.equal(res.qualified, false);
  assert.equal(res.reason, "comments-container");
});

test("Post Qualifier: Bare <div role='listitem'> lacking post identity -> REJECTED", () => {
  const spacer = el("DIV", { class: "spacer" }, [], "Some widget content");
  const bareListItem = el("DIV", { role: "listitem" }, [spacer]);

  const res = isLikelyPostContainer(bareListItem);
  assert.equal(res.qualified, false);
  assert.equal(res.reason, "no-credible-post-identity");
});
