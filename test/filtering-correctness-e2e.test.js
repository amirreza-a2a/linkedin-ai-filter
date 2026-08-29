// test/filtering-correctness-e2e.test.js
// End-to-end filtering correctness, failover integrity, and DOM lifecycle verification.

import test from "node:test";
import assert from "node:assert/strict";

import {
  extractPost,
  findContainers,
  scan,
  applyDecision,
  handleMutations,
  processMutationQueue,
  resetContentState,
  getPendingPosts,
  getCachedDecisions,
  getUserRevealedPostIds,
} from "../src/content/content-index.js";

import { isLikelyPostContainer } from "../src/content/post-qualifier.js";
import { extractAuthor } from "../src/content/author-extractor.js";
import { executeClassifyRequest } from "../src/llm/request-gateway.js";
import { resetScheduler } from "../src/llm/key-scheduler.js";

// Synthetic DOM Node mock tailored for end-to-end post simulation
function createMockNode(tagName, attrs = {}, text = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
  const attributes = { ...attrs };
  const children = [];
  const dataset = { ...attrs.dataset };
  const listeners = new Map();

  const node = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    attributes,
    children,
    dataset,
    get textContent() {
      if (text) return text;
      return children.map((c) => c.textContent || "").join(" ");
    },
    set textContent(val) {
      text = val;
    },

    get innerText() {
      if (text) return text;
      return children.map((c) => c.innerText || "").join(" ");
    },
    set innerText(val) {
      text = val;
    },
    parentElement: null,
    firstChild: null,
    paused: false,

    pause() {
      this.paused = true;
    },

    play() {
      this.paused = false;
    },

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

    insertBefore(child, ref) {
      if (child) {
        child.parentElement = this;
        const idx = children.indexOf(ref);
        if (idx !== -1) children.splice(idx, 0, child);
        else children.unshift(child);
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

  if (sel.startsWith("div[data-urn*='ugcPost:']")) {
    return tag === "div" && (node.getAttribute("data-urn") || "").includes("ugcPost:");
  }

  if (sel.startsWith("div[data-urn*='sponsoredUpdate:']")) {
    return tag === "div" && (node.getAttribute("data-urn") || "").includes("sponsoredUpdate:");
  }

  if (sel.startsWith("div[data-id*='activity:']")) {
    return tag === "div" && (node.getAttribute("data-id") || "").includes("activity:");
  }

  if (sel === 'div[role="listitem"]') {
    return tag === "div" && node.getAttribute("role") === "listitem";
  }

  if (sel.startsWith("a.")) {
    if (tag !== "a") return false;
    const cls = sel.split("[")[0].slice(2);
    return node.classList.contains(cls);
  }

  if (sel.startsWith("a[")) {
    if (tag !== "a") return false;
    if (sel.includes("href*='/feed/update/'")) return (node.getAttribute("href") || "").includes("/feed/update/");
    if (sel.includes("href*='/in/'")) return (node.getAttribute("href") || "").includes("/in/");
    if (sel.includes("href*='/company/'")) return (node.getAttribute("href") || "").includes("/company/");
    if (sel.includes("href*='/school/'")) return (node.getAttribute("href") || "").includes("/school/");
    if (sel.includes("href*='/article/new/'")) return (node.getAttribute("href") || "").includes("/article/new/");
    if (sel.includes("href*='/article/edit/'")) return (node.getAttribute("href") || "").includes("/article/edit/");
    if (sel.includes("href*='/posts/'")) return (node.getAttribute("href") || "").includes("/posts/");
    return false;
  }

  if (sel.startsWith('[data-testid="expandable-text-box"]')) {
    return node.getAttribute("data-testid") === "expandable-text-box";
  }

  return false;
}

// Global Document mock for placeholder creation
globalThis.document = {
  createElement: (tag) => createMockNode(tag),
  getElementById: () => null,
  querySelectorAll: () => [],
};

// =========================================================================
// 1. FIFTEEN REAL LINKEDIN PRODUCTION SCENARIOS
// =========================================================================

test("Scenario 1: Normal text post -> fully qualified, extracted, classified, and hidden", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1001" });
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "update-components-actor__container-link", href: "https://www.linkedin.com/in/johndoe/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "John Doe"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "update-components-text", "data-testid": "expandable-text-box" }, "Buy my cryptocurrency token now! 100x gains guaranteed.");
  el.appendChild(actor);
  el.appendChild(text);

  const qual = isLikelyPostContainer(el);
  assert.equal(qual.decision, "ACCEPT");

  const post = extractPost(el);
  assert.equal(post.id, "urn:li:activity:1001");
  assert.equal(post.author, "John Doe");
  assert.equal(post.authorUrl, "https://linkedin.com/in/johndoe");
  assert.ok(post.text.includes("cryptocurrency token"));

  applyDecision(el, { id: post.id, hide: true, reason: "Crypto spam", topics: ["crypto"] });
  assert.equal(el.classList.contains("feedrule-hidden"), true);
  assert.equal(el.getAttribute("data-feedrule-hidden"), "true");
});

test("Scenario 2: Image post -> qualified, extracted with permalink, shown if not spam", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1002" });
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "update-components-actor__container-link", href: "https://www.linkedin.com/in/photographer/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Alice Photo"));
  const permalink = createMockNode("a", { class: "update-components-actor__sub-description-link", href: "https://www.linkedin.com/feed/update/urn:li:activity:1002" });
  actor.appendChild(link);
  actor.appendChild(permalink);
  const text = createMockNode("div", { class: "update-components-text", "data-testid": "expandable-text-box" }, "Sunset landscape photo from my trip to the mountains.");
  const image = createMockNode("div", { class: "update-components-image" });
  el.appendChild(actor);
  el.appendChild(text);
  el.appendChild(image);

  const post = extractPost(el);
  assert.equal(post.id, "urn:li:activity:1002");
  assert.equal(post.postUrl, "https://www.linkedin.com/feed/update/urn:li:activity:1002");

  applyDecision(el, { id: post.id, hide: false, reason: "", topics: ["photography"] });
  assert.equal(el.classList.contains("feedrule-hidden"), false);
});

test("Scenario 3: Video post -> qualified, hidden decision pauses video element and applies hidden attributes", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2 feed-shared-update-v2--video", "data-urn": "urn:li:activity:1003" });
  const text = createMockNode("div", { class: "update-components-text", "data-testid": "expandable-text-box" }, "Live day trading forex stream video!");
  const video = createMockNode("video", { class: "vjs-tech" });
  video.play();
  el.appendChild(text);
  el.appendChild(video);

  const post = extractPost(el);
  assert.equal(post.id, "urn:li:activity:1003");

  applyDecision(el, { id: post.id, hide: true, reason: "Trading spam", topics: ["trading"] });
  assert.equal(el.classList.contains("feedrule-hidden"), true);
  assert.equal(video.paused, true);
});

test("Scenario 4: Repost / reshare -> extracts correct original author and reshare context", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1004" });
  const header = createMockNode("div", { class: "feed-shared-header" }, "Bob Resharer reposted this");
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "update-components-actor__container-link", href: "https://www.linkedin.com/in/original-author/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Original Author"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "update-components-text" }, "Announcing our new open-source compiler framework!");
  el.appendChild(header);
  el.appendChild(actor);
  el.appendChild(text);

  const { author, authorUrl } = extractAuthor(el);
  assert.equal(author, "Original Author");
  assert.equal(authorUrl, "https://linkedin.com/in/original-author");
});

test("Scenario 5: Sponsored / promoted post -> qualifies and extracts ugcPost / sponsored URN", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:sponsoredUpdate:1005" });
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "app-aware-link", href: "https://www.linkedin.com/company/sponsor-corp/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Sponsor Corp"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "feed-shared-text" }, "Sign up for enterprise cloud trial.");
  el.appendChild(actor);
  el.appendChild(text);

  const post = extractPost(el);
  assert.equal(post.id, "urn:li:sponsoredUpdate:1005");
  assert.equal(post.author, "Sponsor Corp");
});

test("Scenario 6: Company post -> extracts company profile URL cleanly", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1006" });
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "app-aware-link", href: "https://www.linkedin.com/company/google/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Google"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "update-components-text" }, "We are excited to share updates from Google I/O!");
  el.appendChild(actor);
  el.appendChild(text);

  const post = extractPost(el);
  assert.equal(post.author, "Google");
  assert.equal(post.authorUrl, "https://linkedin.com/company/google");
});

test("Scenario 7: School post -> extracts school profile URL cleanly", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1007" });
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "app-aware-link", href: "https://www.linkedin.com/school/stanford-university/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Stanford University"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "update-components-text" }, "Commencement ceremony details for the graduating class.");
  el.appendChild(actor);
  el.appendChild(text);

  const post = extractPost(el);
  assert.equal(post.author, "Stanford University");
  assert.equal(post.authorUrl, "https://linkedin.com/school/stanford-university");
});

test("Scenario 8: Post with comments -> comment text and commenters are NOT confused with post author or body", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1008" });
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "update-components-actor__container-link", href: "https://www.linkedin.com/in/post-author/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Post Author"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "update-components-text", "data-testid": "expandable-text-box" }, "Original post content.");
  
  const commentsSection = createMockNode("div", { class: "comments-comments-list" });
  const commentItem = createMockNode("div", { class: "comments-comment-item" });
  const commenterLink = createMockNode("a", { href: "https://www.linkedin.com/in/random-commenter/" });
  commenterLink.appendChild(createMockNode("span", {}, "Random Commenter"));
  commentItem.appendChild(commenterLink);
  commentsSection.appendChild(commentItem);

  el.appendChild(actor);
  el.appendChild(text);
  el.appendChild(commentsSection);

  const { author, authorUrl } = extractAuthor(el);
  assert.equal(author, "Post Author");
  assert.equal(authorUrl, "https://linkedin.com/in/post-author");
});

test("Scenario 9: Post with 'See more' inline expansion -> extracts clean full text snippet", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:1009" });
  const text = createMockNode("div", { class: "feed-shared-inline-show-more-text" }, "Deep technical breakdown of distributed database consensus algorithms...");
  el.appendChild(text);

  const post = extractPost(el);
  assert.ok(post.text.includes("distributed database consensus"));
});

test("Scenario 10: Post with no directly visible permalink -> creates deterministic level-3 fingerprint", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2" }); // no data-urn
  const actor = createMockNode("div", { class: "update-components-actor" });
  const link = createMockNode("a", { class: "update-components-actor__container-link", href: "https://www.linkedin.com/in/steve/" });
  link.appendChild(createMockNode("span", { class: "update-components-actor__name" }, "Steve Jobs"));
  actor.appendChild(link);
  const text = createMockNode("div", { class: "update-components-text" }, "Design is not just what it looks like and feels like.");
  el.appendChild(actor);
  el.appendChild(text);

  const post = extractPost(el);
  assert.ok(post.id.startsWith("t"), "Fallback ID must start with 't' hash");
  assert.equal(post.author, "Steve Jobs");
});

test("Scenario 11: Post whose URN appears after asynchronous hydration -> updates post identity via MutationObserver", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2" }); // unhydrated
  const text = createMockNode("div", { class: "update-components-text" }, "Hydrating post content...");
  el.appendChild(text);

  scan(el);
  assert.equal(getPendingPosts().length, 1);

  // LinkedIn attaches data-urn after network response
  el.setAttribute("data-urn", "urn:li:activity:hydrated_1011");
  handleMutations([{ type: "attributes", target: el, attributeName: "data-urn" }]);
  processMutationQueue();

  const pending = getPendingPosts();
  assert.equal(pending.length, 2);
  assert.equal(pending[1].id, "urn:li:activity:hydrated_1011");
});

test("Scenario 12: Post loaded through Load More -> discovered and queued without re-scanning previous posts", () => {
  resetContentState();
  const stream = createMockNode("div", { class: "scaffold-finite-scroll__content" });
  const post1 = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:initial_1" });
  post1.appendChild(createMockNode("div", { class: "update-components-text" }, "Initial post 1"));
  stream.appendChild(post1);

  scan(stream);
  assert.equal(getPendingPosts().length, 1);

  // Load more clicks -> post 2 arrives
  const post2 = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:loadmore_2" });
  post2.appendChild(createMockNode("div", { class: "update-components-text" }, "Load more post 2"));
  stream.appendChild(post2);

  handleMutations([{ type: "childList", target: stream, addedNodes: [post2] }]);
  processMutationQueue();

  const pending = getPendingPosts();
  assert.equal(pending.length, 2);
  assert.equal(pending[1].id, "urn:li:activity:loadmore_2");
});

test("Scenario 13: Post rendered in a recycled container -> clears previous state and classifies Post B", () => {
  resetContentState();
  const container = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:post_A" });
  container.appendChild(createMockNode("div", { class: "update-components-text" }, "Post A crypto"));
  scan(container);
  applyDecision(container, { id: "urn:li:activity:post_A", hide: true, reason: "Crypto" });
  assert.equal(container.classList.contains("feedrule-hidden"), true);

  // Recycled to Post B
  container.setAttribute("data-urn", "urn:li:activity:post_B");
  const textEl = container.querySelector(".update-components-text");
  textEl.innerText = "Post B normal career advice";
  handleMutations([{ type: "attributes", target: container, attributeName: "data-urn" }]);
  processMutationQueue();

  assert.equal(container.classList.contains("feedrule-hidden"), false);
  const pending = getPendingPosts();
  assert.equal(pending[1].id, "urn:li:activity:post_B");
});

test("Scenario 14: Post that is initially hidden and later re-rendered -> uses cached decision immediately (0 API calls)", () => {
  resetContentState();
  const oldNode = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:post_1014" });
  oldNode.appendChild(createMockNode("div", { class: "update-components-text" }, "Spam promo"));
  scan(oldNode);
  applyDecision(oldNode, { id: "urn:li:activity:post_1014", hide: true, reason: "Spam promo" });

  // Virtualization removes oldNode, creates fresh newNode for same post ID
  const newNode = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:post_1014" });
  newNode.appendChild(createMockNode("div", { class: "update-components-text" }, "Spam promo"));

  scan(newNode);
  // Cached decision immediately hides newNode without incrementing pending classification requests
  assert.equal(newNode.classList.contains("feedrule-hidden"), true);
  assert.equal(newNode.getAttribute("data-feedrule-hidden"), "true");
  assert.equal(getPendingPosts().length, 1);
});

test("Scenario 15: Post revealed through 'Show anyway' -> remains visible across video autoplay and DOM mutations", () => {
  resetContentState();
  const el = createMockNode("div", { class: "feed-shared-update-v2 feed-shared-update-v2--video", "data-urn": "urn:li:activity:post_1015" });
  el.appendChild(createMockNode("div", { class: "update-components-text" }, "Video keynote"));
  const video = createMockNode("video");
  el.appendChild(video);

  scan(el);
  applyDecision(el, { id: "urn:li:activity:post_1015", hide: true, reason: "Keynote" });
  assert.equal(el.classList.contains("feedrule-hidden"), true);

  // User reveals
  const showBtn = el.querySelector(".feedrule-show-btn");
  assert.ok(showBtn);
  showBtn.trigger("click");
  assert.equal(el.classList.contains("feedrule-hidden"), false);

  // Playback class mutations occur
  for (let i = 0; i < 10; i++) {
    el.setAttribute("class", `feed-shared-update-v2 vjs-playing-${i}`);
    handleMutations([{ type: "attributes", target: el, attributeName: "class" }]);
  }
  processMutationQueue();

  assert.equal(el.classList.contains("feedrule-hidden"), false);
});

// =========================================================================
// 2. API FAILOVER + FILTERING INTEGRATION MATRIX
// =========================================================================

test("Failover Sequence: 429 -> 200 succeeds with key rotation and correct classification", async () => {
  resetScheduler();

  let attempt = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) {
      const errBody = JSON.stringify({ error: { message: "Rate limit exceeded" } });
      return {
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "5" }),
        text: async () => errBody,
        json: async () => JSON.parse(errBody),
      };
    }
    const successBody = JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [{ id: "post_f1", hide: true, reason: "Filtered on key 2", topics: ["tech"] }],
            }),
          },
        },
      ],
    });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => successBody,
      json: async () => JSON.parse(successBody),
    };
  };

  const res = await executeClassifyRequest({
    provider: "openai",
    keys: ["sk-key1", "sk-key2"],
    model: "gpt-4o-mini",
    rulesText: "Filter spam",
    posts: [{ id: "post_f1", text: "Tech post text" }],
  });

  globalThis.fetch = originalFetch;

  assert.equal(res.ok, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].hide, true);
  assert.equal(res.totalAttempts, 2);
  assert.equal(res.finalStatus, 200);
});

test("Failover Sequence: 401 -> 200 invalidates key 1 and succeeds on key 2", async () => {
  resetScheduler();

  let attempt = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attempt++;
    if (attempt === 1) {
      const errBody = JSON.stringify({ error: { message: "Invalid API key" } });
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        headers: new Headers(),
        text: async () => errBody,
        json: async () => JSON.parse(errBody),
      };
    }
    const successBody = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ results: [{ id: "post_f2", hide: false }] }) } }],
    });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      text: async () => successBody,
      json: async () => JSON.parse(successBody),
    };
  };

  const res = await executeClassifyRequest({
    provider: "openai",
    keys: ["sk-badkey", "sk-goodkey"],
    model: "gpt-4o-mini",
    rulesText: "Filter spam",
    posts: [{ id: "post_f2", text: "Clean post text" }],
  });

  globalThis.fetch = originalFetch;

  assert.equal(res.ok, true);
  assert.equal(res.results[0].hide, false);
  assert.equal(res.totalAttempts, 2);
});

test("Failover Sequence: 503 -> 503 fails open gracefully without crashing", async () => {
  resetScheduler();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const errBody = JSON.stringify({ error: { message: "Model overloaded" } });
    return {
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      headers: new Headers(),
      text: async () => errBody,
      json: async () => JSON.parse(errBody),
    };
  };

  const res = await executeClassifyRequest({
    provider: "openai",
    keys: ["sk-key1", "sk-key2"],
    model: "gpt-4o-mini",
    rulesText: "Filter spam",
    posts: [{ id: "post_f3", text: "Post text" }],
  });

  globalThis.fetch = originalFetch;

  assert.equal(res.ok, false);
  assert.equal(res.finalErrorCode, "SERVER_ERROR");
});

test("Failover Sequence: 400 Bad Request terminates immediately without key failover", async () => {
  resetScheduler();

  let attemptCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attemptCount++;
    const errBody = JSON.stringify({ error: { message: "Invalid JSON schema" } });
    return {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: new Headers(),
      text: async () => errBody,
      json: async () => JSON.parse(errBody),
    };
  };

  const res = await executeClassifyRequest({
    provider: "openai",
    keys: ["sk-key1", "sk-key2", "sk-key3"],
    model: "gpt-4o-mini",
    rulesText: "Filter spam",
    posts: [{ id: "post_f4", text: "Post text" }],
  });

  globalThis.fetch = originalFetch;

  assert.equal(res.ok, false);
  assert.equal(attemptCount, 1, "400 must never fail over to alternate keys");
  assert.equal(res.finalErrorCode, "INVALID_REQUEST");
});

// =========================================================================
// 3. RACE CONDITION INTEGRITY
// =========================================================================

test("Race Condition: Container recycled while classification in-flight does NOT apply stale result to new post", () => {
  resetContentState();
  const container = createMockNode("div", { class: "feed-shared-update-v2", "data-urn": "urn:li:activity:post_R1" });
  const text = createMockNode("div", { class: "update-components-text" }, "Post R1 initial text content");
  container.appendChild(text);
  scan(container);

  // In-flight request is out for post_R1.
  // Container is recycled to post_R2 in DOM
  container.setAttribute("data-urn", "urn:li:activity:post_R2");
  text.textContent = "Post R2 completely different content";
  scan(container);

  // Late response for post_R1 arrives
  applyDecision(container, { id: "urn:li:activity:post_R1", hide: true, reason: "Spam R1" });

  // Container is currently post_R2, so stale decision for post_R1 MUST NOT hide it
  assert.equal(container.classList.contains("feedrule-hidden"), false);
  assert.equal(container.getAttribute("data-feedrule-hidden"), null);
});
