// test/video-visibility.test.js
// Regression tests for video autoplay immunity, flicker-loop defense, and persistent hidden state.

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
  pauseVideosInContainer,
} from "../src/content/content-index.js";

// Synthetic DOM Node mock tailored for video and content script testing
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

    removeAttribute(name) {
      delete attributes[name];
      if (name === "class") {
        classListSet.clear();
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

  if (sel === "video") {
    return tag === "video";
  }

  return false;
}

function buildSyntheticVideoPost(urnId, authorName, authorHandle, postText) {
  const container = createMockNode("div", {
    class: "feed-shared-update-v2 feed-shared-update-v2--video",
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

  const mediaContainer = createMockNode("div", { class: "feed-shared-linkedin-video" });
  const videoEl = createMockNode("video", { class: "vjs-tech" });
  mediaContainer.appendChild(videoEl);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(mediaContainer);

  return container;
}

// Global Document mock for placeholder creation in applyDecision
globalThis.document = {
  createElement: (tag) => createMockNode(tag),
  getElementById: () => null,
  querySelectorAll: () => [],
};

test("1. Autoplay mutation: LinkedIn modifying classes during playback does not unhide hidden post", () => {
  resetContentState();

  const post = buildSyntheticVideoPost("urn:li:activity:video101", "Crypto Marketer", "crypto-mkt", "Join our token sale live stream video!");
  scan(post);

  // Apply hidden decision
  applyDecision(post, { id: "urn:li:activity:video101", hide: true, reason: "Crypto video spam", topics: ["crypto"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);
  assert.equal(post.getAttribute("data-feedrule-hidden"), "true");

  // Video inside should be paused
  const video = post.querySelector("video");
  assert.equal(video.paused, true);

  // Simulate LinkedIn replacing the container class name during video autoplay (stripping extension classes)
  post.setAttribute("class", "feed-shared-update-v2 feed-shared-update-v2--video feed-shared-update-v2--video-playing vjs-playing");

  // Observer receives the class mutation
  handleMutations([
    {
      type: "attributes",
      target: post,
      attributeName: "class",
    },
  ]);

  // FeedRule synchronously restores feedrule-hidden and preserves data-feedrule-hidden
  assert.equal(post.classList.contains("feedrule-hidden"), true);
  assert.equal(post.getAttribute("data-feedrule-hidden"), "true");
  assert.equal(video.paused, true);

  // Process mutation queue: no extra scans or duplicate classifications
  processMutationQueue();
  assert.equal(getPendingPosts().length, 1);
});

test("2. Video subtree replacement: Adding new video player nodes into hidden post pauses video and stays hidden", () => {
  resetContentState();

  const post = buildSyntheticVideoPost("urn:li:activity:video102", "Spam Broadcaster", "spam-bc", "High frequency trading live video");
  scan(post);

  applyDecision(post, { id: "urn:li:activity:video102", hide: true, reason: "Trading spam", topics: ["trading"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);

  // Simulate LinkedIn replacing the video subtree dynamically
  const newMediaContainer = createMockNode("div", { class: "feed-shared-linkedin-video feed-shared-linkedin-video--hydrated" });
  const newVideoEl = createMockNode("video", { class: "vjs-tech new-player" });
  newVideoEl.play(); // player starts in playing state
  newMediaContainer.appendChild(newVideoEl);
  post.appendChild(newMediaContainer);

  handleMutations([
    {
      type: "childList",
      target: post,
      addedNodes: [newMediaContainer],
    },
  ]);

  // Hidden state and data-feedrule-hidden must remain authoritative, and video must be paused
  assert.equal(post.classList.contains("feedrule-hidden"), true);
  assert.equal(post.getAttribute("data-feedrule-hidden"), "true");
  assert.equal(newVideoEl.paused, true);

  processMutationQueue();
  assert.equal(getPendingPosts().length, 1);
});

test("3. Entire post DOM replacement: Replaced DOM node for same post ID re-applies cached decision immediately", () => {
  resetContentState();

  const oldNode = buildSyntheticVideoPost("urn:li:activity:video103", "AI Influencer", "ai-inf", "Clickbait video recap");
  scan(oldNode);
  applyDecision(oldNode, { id: "urn:li:activity:video103", hide: true, reason: "Clickbait", topics: ["clickbait"] });

  // Simulate LinkedIn replacing the entire post DOM container (virtualization / re-render)
  const newNode = buildSyntheticVideoPost("urn:li:activity:video103", "AI Influencer", "ai-inf", "Clickbait video recap");
  
  handleMutations([
    {
      type: "childList",
      target: createMockNode("div"),
      addedNodes: [newNode],
    },
  ]);

  processMutationQueue();

  // Cached decision is immediately applied to newNode with zero duplicate network requests
  assert.equal(newNode.classList.contains("feedrule-hidden"), true);
  assert.equal(newNode.getAttribute("data-feedrule-hidden"), "true");
  assert.equal(newNode.querySelector("video").paused, true);
  assert.equal(getPendingPosts().length, 1);
});

test("4. Repeated video playback mutations do not create duplicate classification requests", () => {
  resetContentState();

  const post = buildSyntheticVideoPost("urn:li:activity:video104", "Web3 Dev", "web3-dev", "NFT minting live tutorial");
  scan(post);
  applyDecision(post, { id: "urn:li:activity:video104", hide: true, reason: "Web3", topics: ["web3"] });

  // Simulate 20 rapid video playback state mutations (time updates, buffer updates, class toggles)
  for (let i = 0; i < 20; i++) {
    post.setAttribute("class", `feed-shared-update-v2 video-frame-${i}`);
    handleMutations([
      {
        type: "attributes",
        target: post,
        attributeName: "class",
      },
    ]);
  }

  processMutationQueue();

  // Post must remain hidden and have exactly 1 pending classification from initial scan
  assert.equal(post.classList.contains("feedrule-hidden"), true);
  assert.equal(post.getAttribute("data-feedrule-hidden"), "true");
  assert.equal(getPendingPosts().length, 1);
});

test("5. DOM recycling during video playback: Recycled container clears Post A state and evaluates Post B", () => {
  resetContentState();

  const container = buildSyntheticVideoPost("urn:li:activity:video105", "Post A Author", "author-a", "Post A video text");
  scan(container);
  applyDecision(container, { id: "urn:li:activity:video105", hide: true, reason: "Post A filter", topics: ["filter"] });
  assert.equal(container.classList.contains("feedrule-hidden"), true);

  // Recycled to Post B (a clean non-filtered post)
  container.setAttribute("data-urn", "urn:li:activity:video106");
  const authorLink = container.querySelector("a[href*='/in/']");
  if (authorLink) authorLink.setAttribute("href", "https://www.linkedin.com/in/author-b/");
  const nameSpan = container.querySelector(".update-components-actor__name");
  if (nameSpan) nameSpan.innerText = "Post B Author";
  const desc = container.querySelector(".update-components-text");
  if (desc) desc.innerText = "Clean career update post with video";

  handleMutations([
    {
      type: "attributes",
      target: container,
      attributeName: "data-urn",
    },
  ]);

  processMutationQueue();

  // Previous hidden state should be cleared for Post B
  assert.equal(container.classList.contains("feedrule-hidden"), false);
  assert.equal(container.getAttribute("data-feedrule-hidden"), null);
  
  // Post B is discovered and queued
  const pending = getPendingPosts();
  assert.equal(pending.length, 2);
  assert.equal(pending[1].id, "urn:li:activity:video106");
});

test("6. Show anyway survives subsequent video playback mutations", () => {
  resetContentState();

  const post = buildSyntheticVideoPost("urn:li:activity:video107", "Conference Host", "conf-host", "Tech conference keynote stream");
  scan(post);
  applyDecision(post, { id: "urn:li:activity:video107", hide: true, reason: "Stream", topics: ["stream"] });
  assert.equal(post.classList.contains("feedrule-hidden"), true);

  // User clicks "Show anyway"
  const showBtn = post.querySelector(".feedrule-show-btn");
  assert.ok(showBtn);
  showBtn.trigger("click");

  assert.equal(post.classList.contains("feedrule-hidden"), false);
  assert.equal(post.getAttribute("data-feedrule-hidden"), null);
  assert.equal(getUserRevealedPostIds().has("urn:li:activity:video107"), true);

  // Video starts playing and mutates class / children
  post.setAttribute("class", "feed-shared-update-v2 video-playing-active");
  const bufferDiv = createMockNode("div", { class: "vjs-buffer" });
  post.appendChild(bufferDiv);

  handleMutations([
    {
      type: "attributes",
      target: post,
      attributeName: "class",
    },
    {
      type: "childList",
      target: post,
      addedNodes: [bufferDiv],
    },
  ]);

  processMutationQueue();

  // Must remain visible; user reveal is preserved
  assert.equal(post.classList.contains("feedrule-hidden"), false);
  assert.equal(post.getAttribute("data-feedrule-hidden"), null);
});

test("7. pauseVideosInContainer safely pauses active videos without throwing on malformed elements", () => {
  const container = createMockNode("div");
  const video1 = createMockNode("video");
  const video2 = createMockNode("video");
  video1.play();
  video2.play();

  container.appendChild(video1);
  container.appendChild(video2);

  pauseVideosInContainer(container);
  assert.equal(video1.paused, true);
  assert.equal(video2.paused, true);

  // Safe against null/undefined
  pauseVideosInContainer(null);
  pauseVideosInContainer({});
});
