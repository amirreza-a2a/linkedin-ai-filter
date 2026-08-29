import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyPostContainer,
  ACCEPT_THRESHOLD,
  AMBIGUOUS_THRESHOLD,
} from "../src/content/post-qualifier.js";
import { extractPost, findContainers } from "../src/content/content-index.js";

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
  if (sel.includes("article/new") || sel.includes("article/edit")) {
    return (node.attributes.href || "").includes("/article/new/") || (node.attributes.href || "").includes("/article/edit/");
  }
  if (sel.includes("sharebox") || sel.includes("draft-text")) {
    return (node.attributes.id || "").includes("sharebox") || 
           (node.attributes.id || "").includes("draft-text") || 
           (node.attributes.componentkey || "").includes("sharebox") || 
           (node.attributes.componentkey || "").includes("draft-text");
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
  if (sel.includes("[data-urn*='activity:']")) {
    return (node.attributes["data-urn"] || "").includes("activity:");
  }
  if (sel.includes("[data-urn*='ugcPost:']")) {
    return (node.attributes["data-urn"] || "").includes("ugcPost:");
  }
  if (sel.includes("[data-urn*='sponsoredUpdate:']")) {
    return (node.attributes["data-urn"] || "").includes("sponsoredUpdate:");
  }
  if (sel === "h2" && node.tagName === "H2") return true;
  if (sel === "h3" && node.tagName === "H3") return true;
  if (sel === 'div[role="listitem"]' && node.tagName === "DIV" && node.attributes.role === "listitem") return true;
  return false;
}

// =========================================================================
// 1. FALSE-POSITIVE REJECTIONS (Hard Negative Protections)
// =========================================================================

test("False-Positive Protection: 'Recommended for you' / PYMK Card -> REJECTED", () => {
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
  assert.equal(res.decision, "REJECT");
  assert.equal(res.reason, "recommendation-card");
});

test("Test A: Modern LinkedIn Composer ('Start a post / Video / Photo / Write article') -> REJECTED (reason: composer)", () => {
  const profileLink = el("A", { href: "https://www.linkedin.com/in/me/", id: "shareboxProfilePictureComponentRef" }, [], "");
  const draftButton = el("DIV", { role: "button", "aria-label": "Start a post", id: "draft-text-replaceable-component" }, [], "Start a post");
  const videoBtn = el("DIV", { role: "button" }, [], "Video");
  const photoBtn = el("DIV", { role: "button" }, [], "Photo");
  const articleLink = el("A", { href: "/article/new/" }, [], "Write article");

  const modernComposer = el(
    "DIV",
    {
      "data-lazy-mount-id": "1j48jds",
      style: "display: contents;",
    },
    [profileLink, draftButton, videoBtn, photoBtn, articleLink],
    "Start a post\n\nVideo\n\nPhoto\n\nWrite article"
  );

  const res = isLikelyPostContainer(modernComposer);
  assert.equal(res.qualified, false);
  assert.equal(res.decision, "REJECT");
  assert.equal(res.reason, "composer");
  assert.equal(res.score, 0);
});

test("Test B: Real normal post with genuine author and commentary -> ACCEPTED", () => {
  const authorLink = el("A", { href: "https://www.linkedin.com/in/sarah-dev" }, [], "Sarah Dev");
  const text = el("DIV", { class: "update-components-text" }, [], "Excited to announce our open source AI compiler release today!");
  const normalPost = el(
    "DIV",
    {
      "data-lazy-mount-id": "norm_post_1",
      class: "feed-shared-update-v2",
    },
    [authorLink, text]
  );

  const res = isLikelyPostContainer(normalPost);
  assert.equal(res.qualified, true);
  assert.equal(res.decision, "ACCEPT");
});

test("Test C: Real video post -> ACCEPTED as genuine post", () => {
  const authorLink = el("A", { href: "https://www.linkedin.com/company/robotics-co" }, [], "Robotics Co");
  const text = el("DIV", { class: "update-components-text" }, [], "Autonomous quadrupeds navigating rugged mountain terrain.");
  const video = el("VIDEO", { src: "https://example.com/stream.mp4" });
  const videoPost = el(
    "DIV",
    {
      "data-lazy-mount-id": "video_post_1",
      class: "feed-shared-update-v2 feed-shared-update-v2--video",
    },
    [authorLink, text, video]
  );

  const res = isLikelyPostContainer(videoPost);
  assert.equal(res.qualified, true);
  assert.equal(res.decision, "ACCEPT");
});

test("Test D: Real image post -> ACCEPTED as genuine post", () => {
  const authorLink = el("A", { href: "https://www.linkedin.com/in/alex-design" }, [], "Alex Design");
  const text = el("DIV", { class: "update-components-text" }, [], "New UI mockup system design exploration.");
  const img = el("IMG", { class: "update-components-image__image", src: "https://media.licdn.com/dms/image/123.jpg" });
  const imagePost = el(
    "DIV",
    {
      "data-lazy-mount-id": "image_post_1",
      class: "feed-shared-update-v2",
    },
    [authorLink, text, img]
  );

  const res = isLikelyPostContainer(imagePost);
  assert.equal(res.qualified, true);
  assert.equal(res.decision, "ACCEPT");
});

test("Test E: 'Start a post' mentioned inside legitimate post content -> MUST NOT be rejected", () => {
  const authorLink = el("A", { href: "https://www.linkedin.com/in/creator-coach" }, [], "Creator Coach");
  const postBody = el(
    "DIV",
    { class: "update-components-text" },
    [],
    "When you click 'Start a post' on LinkedIn, focus on writing a clear hook in the first 2 lines. Include a photo or video to increase engagement."
  );
  const legitimatePost = el(
    "DIV",
    {
      "data-lazy-mount-id": "legit_post_about_posting",
      class: "feed-shared-update-v2",
    },
    [authorLink, postBody],
    "When you click 'Start a post' on LinkedIn, focus on writing a clear hook in the first 2 lines. Include a photo or video to increase engagement."
  );

  const res = isLikelyPostContainer(legitimatePost);
  assert.equal(res.qualified, true, "Post discussing 'Start a post' in body must remain qualified");
  assert.notEqual(res.reason, "composer", "Legitimate post must not be rejected as composer");
});

test("Test F: Localized/modified composer text -> still REJECTED when structural markers identify composer", () => {
  const articleBtn = el("A", { href: "https://www.linkedin.com/article/new/" }, [], "Créer un article");
  const localizedComposer = el(
    "DIV",
    {
      "data-lazy-mount-id": "loc_composer",
      class: "share-box-feed-entry",
    },
    [articleBtn]
  );

  const res = isLikelyPostContainer(localizedComposer);
  assert.equal(res.qualified, false);
  assert.equal(res.decision, "REJECT");
  assert.equal(res.reason, "composer");
});

test("False-Positive Protection: Comments-Only Container -> REJECTED", () => {
  const comment1 = el("DIV", { class: "comments-comment-item" }, [
    el("A", { href: "https://www.linkedin.com/in/commenter" }, [], "Commenter"),
  ]);
  const commentsList = el("DIV", { class: "comments-comments-list" }, [comment1]);

  const res = isLikelyPostContainer(commentsList);
  assert.equal(res.qualified, false);
  assert.equal(res.decision, "REJECT");
  assert.equal(res.reason, "comments-container");
});

test("False-Positive Protection: Bare <div role='listitem'> lacking post identity -> REJECTED", () => {
  const spacer = el("DIV", { class: "spacer" }, [], "Generic ad snippet");
  const bareListItem = el("DIV", { role: "listitem" }, [spacer]);

  const res = isLikelyPostContainer(bareListItem);
  assert.equal(res.qualified, false);
  assert.equal(res.decision, "REJECT");
  assert.equal(res.reason, "insufficient-signals");
});

// =========================================================================
// 2. FALSE-NEGATIVE PROTECTIONS (Legitimate Post Variants)
// =========================================================================

test("False-Negative Protection: Normal text post -> ACCEPTED", () => {
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
  assert.equal(res.decision, "ACCEPT");
  assert.ok(res.score >= ACCEPT_THRESHOLD);
});

test("False-Negative Protection: Repost / Reshare -> ACCEPTED", () => {
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
  assert.equal(res.decision, "ACCEPT");
});

test("False-Negative Protection: Sponsored / Promoted Post -> ACCEPTED", () => {
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
  assert.equal(res.decision, "ACCEPT");
});

test("False-Negative Protection: Post with NO visible permalink -> ACCEPTED via URN and Text", () => {
  const text = el("DIV", { class: "update-components-text" }, [], "Real-time edge compute systems in industrial IoT.");
  const postWithoutPermalink = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:7000111222",
    },
    [text]
  );

  const res = isLikelyPostContainer(postWithoutPermalink);
  assert.equal(res.qualified, true);
  assert.equal(res.decision, "ACCEPT");
  assert.ok(res.score >= ACCEPT_THRESHOLD);
});

test("False-Negative Protection: Post with NO directly visible activity URN attribute -> ACCEPTED via structure", () => {
  const actor = el("DIV", { class: "update-components-actor" }, [
    el("A", { class: "app-aware-link", href: "https://www.linkedin.com/in/carol" }, [], "Carol"),
  ]);
  const text = el("DIV", { class: "update-components-text" }, [], "Building responsive canvas layouts with HTML5.");
  const postWithoutUrn = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
    },
    [actor, text]
  );

  const res = isLikelyPostContainer(postWithoutUrn);
  assert.equal(res.qualified, true);
  assert.equal(res.decision, "ACCEPT");
  assert.ok(res.score >= ACCEPT_THRESHOLD);
});

test("False-Negative Protection: Post with alternate text class (.feed-shared-inline-show-more-text) -> ACCEPTED", () => {
  const actor = el("DIV", { class: "update-components-actor" }, [
    el("A", { class: "app-aware-link", href: "https://www.linkedin.com/in/dave" }, [], "Dave"),
  ]);
  const text = el("SPAN", { class: "feed-shared-inline-show-more-text" }, [], "Exploring vector embeddings in embedded devices.");
  const post = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:888999111",
    },
    [actor, text]
  );

  const res = isLikelyPostContainer(post);
  assert.equal(res.qualified, true);
  assert.equal(res.decision, "ACCEPT");
});

test("False-Negative Protection: Ambiguous candidate with partial signals -> AMBIGUOUS and successfully extracted", () => {
  // A customized A/B test wrapper with only an author link and post text (Score: Text 25 + AuthorLink 15 = 40)
  const authorLink = el("A", { class: "app-aware-link", href: "https://www.linkedin.com/in/ellen" }, [], "Ellen Ripley");
  const text = el("DIV", { "data-testid": "expandable-text-box" }, [], "Deep space telecommunications protocols.");
  const ambiguousContainer = el("DIV", { role: "listitem" }, [authorLink, text]);

  const res = isLikelyPostContainer(ambiguousContainer);
  assert.equal(res.qualified, true);
  assert.ok(res.decision === "ACCEPT" || res.decision === "AMBIGUOUS");

  // Verify extractPost successfully extracts valid post from this candidate
  const extracted = extractPost(ambiguousContainer);
  assert.ok(extracted);
  assert.equal(extracted.author, "Ellen Ripley");
  assert.equal(extracted.authorUrl, "https://linkedin.com/in/ellen");
  assert.match(extracted.text, /telecommunications/);
});

// =========================================================================
// 3. AUDIT FINDCONTAINERS DEDUPLICATION
// =========================================================================

test("findContainers Deduplication: Prefers inner canonical .feed-shared-update-v2 over outer [role='listitem']", () => {
  const innerPost = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:999000111",
    },
    [],
    "Post text"
  );
  const outerListItem = el("DIV", { role: "listitem" }, [innerPost]);
  const mainFeed = el("DIV", { "data-testid": "mainFeed" }, [outerListItem]);

  const containers = findContainers(mainFeed);

  // The inner update container should be selected, avoiding redundant processing of the outer listitem
  assert.equal(containers.length, 1);
  assert.equal(containers[0], innerPost);
});
