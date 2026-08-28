import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanAuthorName,
  isValidAuthorUrl,
  extractAuthor,
} from "../src/content/author-extractor.js";
import { extractPost } from "../src/content/content-index.js";
import { sanitizeUrl } from "../src/storage/saved-posts-store.js";

// Minimal DOM mock helper for Node test environment
function createMockElement(tag, attrs = {}, children = [], textContent = "") {
  const classListSet = new Set((attrs.class || "").split(/\s+/).filter(Boolean));

  const el = {
    tagName: tag.toUpperCase(),
    attributes: { ...attrs },
    children: [...children],
    textContent: textContent,
    innerText: textContent,
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
        if (matchesSingleSelector(current, selector)) return current;
        current = current.parentElement;
      }
      return null;
    },
    querySelector(selector) {
      const all = this.querySelectorAll(selector);
      return all.length > 0 ? all[0] : null;
    },
    querySelectorAll(selector) {
      const subSelectors = selector.split(",").map((s) => s.trim());
      const results = [];
      function traverse(node) {
        if (!node || !node.children) return;
        for (const child of node.children) {
          for (const sub of subSelectors) {
            if (matchesSingleSelector(child, sub)) {
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

  // Set parent pointers
  for (const c of children) {
    if (c && typeof c === "object") {
      c.parentElement = el;
    }
  }

  return el;
}

function matchesSingleSelector(el, sel) {
  if (!el || !el.tagName) return false;
  if (sel.startsWith(".")) {
    const className = sel.slice(1);
    const classes = (el.attributes.class || "").split(/\s+/);
    return classes.includes(className);
  }
  if (sel.startsWith("a[")) {
    if (el.tagName !== "A") return false;
    if (sel.includes("href*='/in/'")) return (el.attributes.href || "").includes("/in/");
    if (sel.includes("href*='/company/'")) return (el.attributes.href || "").includes("/company/");
    if (sel.includes("href*='/school/'")) return (el.attributes.href || "").includes("/school/");
    if (sel.includes("href*='/showcase/'")) return (el.attributes.href || "").includes("/showcase/");
    if (sel.includes("href*='/feed/update/'")) return (el.attributes.href || "").includes("/feed/update/");
    if (sel.includes("href*='/posts/'")) return (el.attributes.href || "").includes("/posts/");
  }
  if (sel === "a[href]") {
    return el.tagName === "A" && Boolean(el.attributes.href);
  }
  if (sel === "img[alt]") {
    return el.tagName === "IMG" && Boolean(el.attributes.alt);
  }
  if (sel.includes("span[dir='ltr']")) {
    return el.tagName === "SPAN" && el.attributes.dir === "ltr";
  }
  if (sel.includes("[data-testid=\"expandable-text-box\"]") || sel.includes("[data-testid='expandable-text-box']")) {
    return el.attributes["data-testid"] === "expandable-text-box";
  }
  if (sel.includes("[data-testid='actor-container']")) {
    return el.attributes["data-testid"] === "actor-container";
  }
  if (sel.includes("[aria-label*='post by ']") || sel.includes("[aria-label*='Post by ']")) {
    const aria = (el.attributes["aria-label"] || "").toLowerCase();
    return aria.includes("post by ");
  }
  return false;
}

test("cleanAuthorName - removes connection degree badges and whitespace noise", () => {
  assert.equal(cleanAuthorName("Alice Engineer • 1st"), "Alice Engineer");
  assert.equal(cleanAuthorName("Bob Builder · 2nd"), "Bob Builder");
  assert.equal(cleanAuthorName("Charlie C. • 3rd+"), "Charlie C.");
  assert.equal(cleanAuthorName("Diana Prince • Following"), "Diana Prince");
  assert.equal(cleanAuthorName("Bruce Wayne • You"), "Bruce Wayne");
  assert.equal(cleanAuthorName("  Evan Wright   "), "Evan Wright");
  assert.equal(cleanAuthorName("View Frank's profile\nFrank Castle"), "Frank Castle");
  assert.equal(cleanAuthorName("View Grace Hopper's profile"), "Grace Hopper");
});

test("isValidAuthorUrl - validates author identity paths and rejects invalid endpoints", () => {
  assert.ok(isValidAuthorUrl("https://www.linkedin.com/in/alice"));
  assert.ok(isValidAuthorUrl("https://linkedin.com/company/acme-corp"));
  assert.ok(isValidAuthorUrl("https://linkedin.com/school/mit"));
  assert.ok(isValidAuthorUrl("https://linkedin.com/showcase/google-cloud"));

  // Reject non-profile destinations
  assert.ok(!isValidAuthorUrl("https://linkedin.com/feed/update/urn:li:activity:123"));
  assert.ok(!isValidAuthorUrl("https://linkedin.com/posts/alice_test-123"));
  assert.ok(!isValidAuthorUrl("https://linkedin.com/jobs/view/456"));
  assert.ok(!isValidAuthorUrl("https://google.com"));
});

test("Ranked Pipeline: Excludes liker header and selects real author (Mohammad Abedini vs Armin Daraei)", () => {
  // 1. Social activity header: Mohammad Abedini likes this
  const likerSpan = createMockElement("SPAN", {}, [], "Mohammad Abedini");
  const likerAnchor = createMockElement(
    "A",
    { class: "app-aware-link", href: "https://www.linkedin.com/in/mohammad-abedini-979986b2/" },
    [likerSpan],
    "Mohammad Abedini"
  );
  const socialTextSpan = createMockElement("SPAN", {}, [], "likes this");
  const headerWrapper = createMockElement("DIV", { class: "update-components-header__text-wrapper" }, [likerAnchor, socialTextSpan], "Mohammad Abedini likes this");
  const socialHeader = createMockElement("DIV", { class: "update-components-header" }, [headerWrapper]);

  // 2. Real post author: Armin Daraei
  const authorNameDir = createMockElement("SPAN", { dir: "ltr" }, [], "Armin Daraei");
  const authorNameSpan = createMockElement("SPAN", { class: "update-components-actor__name" }, [authorNameDir], "Armin Daraei");
  const authorMeta = createMockElement("DIV", { class: "update-components-actor__meta" }, [authorNameSpan]);
  const authorAnchor = createMockElement(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/in/armin-daraei-12345/",
      "aria-label": "Armin Daraei",
    },
    [authorMeta],
    "Armin Daraei"
  );
  const actorContainer = createMockElement(
    "DIV",
    {
      class: "update-components-actor",
      "aria-label": "Feed post by Armin Daraei",
    },
    [authorAnchor]
  );

  // 3. Post body
  const bodyText = createMockElement("DIV", { class: "update-components-text" }, [], "Excited to share our new research in AI agent architectures!");

  // Main container
  const postContainer = createMockElement("DIV", { class: "feed-shared-update-v2" }, [socialHeader, actorContainer, bodyText]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Armin Daraei");
  assert.equal(result.authorUrl, "https://linkedin.com/in/armin-daraei-12345");
});

test("Ranked Pipeline: Excludes commenter profiles inside comments section", () => {
  // Post author: Alice
  const authorAnchor = createMockElement(
    "A",
    { class: "update-components-actor__image", href: "https://www.linkedin.com/in/alice" },
    [],
    "Alice Engineer"
  );
  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [authorAnchor]);

  // Commenter: Bob
  const commenterAnchor = createMockElement(
    "A",
    { class: "comments-post-meta__name-link", href: "https://www.linkedin.com/in/bob" },
    [],
    "Bob Commenter"
  );
  const commentItem = createMockElement("DIV", { class: "comments-comment-item" }, [commenterAnchor]);
  const commentsSection = createMockElement("DIV", { class: "comments-comments-list" }, [commentItem]);

  const postContainer = createMockElement("DIV", {}, [actorContainer, commentsSection]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Alice Engineer");
  assert.equal(result.authorUrl, "https://linkedin.com/in/alice");
});

test("Case A: Personal profile anchor with badge and accessible text", () => {
  const badgeSpan = createMockElement("SPAN", {}, [], "• 1st");
  const anchor = createMockElement(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/in/alice?trk=feed-actor",
      "aria-label": "Alice Engineer",
    },
    [badgeSpan],
    "Alice Engineer • 1st"
  );

  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [anchor]);
  const postContainer = createMockElement("DIV", { class: "feed-shared-update-v2" }, [actorContainer]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Alice Engineer");
  assert.equal(result.authorUrl, "https://linkedin.com/in/alice");
});

test("Case B: Company page profile anchor", () => {
  const anchor = createMockElement(
    "A",
    {
      class: "app-aware-link feed-shared-actor__container-link",
      href: "https://www.linkedin.com/company/acme-corp/",
      "aria-label": "Acme Corp",
    },
    [],
    "Acme Corp"
  );

  const actorContainer = createMockElement("DIV", { class: "feed-shared-actor" }, [anchor]);
  const postContainer = createMockElement("DIV", {}, [actorContainer]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Acme Corp");
  assert.equal(result.authorUrl, "https://linkedin.com/company/acme-corp");
});

test("Case C: School page profile anchor", () => {
  const anchor = createMockElement(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/school/mit",
      "aria-label": "MIT",
    },
    [],
    "MIT"
  );

  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [anchor]);
  const postContainer = createMockElement("DIV", {}, [actorContainer]);
  const result = extractAuthor(postContainer);

  assert.equal(result.author, "MIT");
  assert.equal(result.authorUrl, "https://linkedin.com/school/mit");
});

test("Case D: Showcase page profile anchor", () => {
  const anchor = createMockElement(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/showcase/google-cloud",
      "aria-label": "Google Cloud",
    },
    [],
    "Google Cloud"
  );

  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [anchor]);
  const postContainer = createMockElement("DIV", {}, [actorContainer]);
  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Google Cloud");
  assert.equal(result.authorUrl, "https://linkedin.com/showcase/google-cloud");
});

test("Case E: Name only available without profile URL", () => {
  const nameSpan = createMockElement("SPAN", { class: "update-components-actor__name" }, [], "Bob Builder");
  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [nameSpan]);
  const postContainer = createMockElement("DIV", {}, [actorContainer]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Bob Builder");
  assert.equal(result.authorUrl, "");
});

test("Case F: No reliable author element in DOM", () => {
  const spacer = createMockElement("DIV", { class: "spacer" }, [], "Advertisement");
  const postContainer = createMockElement("DIV", {}, [spacer]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "");
  assert.equal(result.authorUrl, "");
});

test("Case G: Body text mentions must NOT be mistaken for author", () => {
  const bodyText = createMockElement("DIV", { class: "expandable-text-box" }, [], "Thanks to @Elon Musk for the ideas.");
  const postContainer = createMockElement("DIV", {}, [bodyText]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "");
  assert.equal(result.authorUrl, "");
});

test("Case H: Repost header contamination is excluded", () => {
  const reshareHeader = createMockElement("DIV", { class: "update-components-header" }, [], "Jane Doe reposted this");

  const originalAnchor = createMockElement(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/in/alice",
      "aria-label": "Alice Engineer",
    },
    [],
    "Alice Engineer"
  );
  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [originalAnchor]);

  const postContainer = createMockElement("DIV", {}, [reshareHeader, actorContainer]);

  const result = extractAuthor(postContainer);

  assert.equal(result.author, "Alice Engineer");
  assert.equal(result.authorUrl, "https://linkedin.com/in/alice");
});

test("Case I: Canonical URL equivalence through sanitizer single source of truth", () => {
  const u1 = sanitizeUrl("https://www.linkedin.com/in/alice/");
  const u2 = sanitizeUrl("https://linkedin.com/in/alice?trk=profile-view");
  const u3 = sanitizeUrl("https://www.linkedin.com/in/alice#details");

  assert.equal(u1, "https://linkedin.com/in/alice");
  assert.equal(u2, "https://linkedin.com/in/alice");
  assert.equal(u3, "https://linkedin.com/in/alice");
});

test("Production Integration: extractPost() uses extractAuthor() and canonical sanitizeUrl()", () => {
  const anchor = createMockElement(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/in/carol-danvers?trk=feed",
      "aria-label": "Carol Danvers",
    },
    [],
    "Carol Danvers"
  );
  const actorContainer = createMockElement("DIV", { class: "update-components-actor" }, [anchor]);

  const textEl = createMockElement("DIV", { "data-testid": "expandable-text-box" }, [], "Exploring quantum entanglement in aerospace computing.");

  const permalinkAnchor = createMockElement(
    "A",
    {
      class: "app-aware-link",
      href: "https://www.linkedin.com/feed/update/urn:li:activity:7999888777?trk=feed",
    },
    [],
    "1h"
  );

  const postContainer = createMockElement(
    "DIV",
    { "data-urn": "urn:li:activity:7999888777" },
    [actorContainer, textEl, permalinkAnchor]
  );

  const extracted = extractPost(postContainer);

  assert.ok(extracted);
  assert.equal(extracted.id, "urn:li:activity:7999888777");
  assert.equal(extracted.author, "Carol Danvers");
  assert.equal(extracted.authorUrl, "https://linkedin.com/in/carol-danvers");
  assert.equal(extracted.postUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7999888777");
  assert.equal(extracted.text, "Exploring quantum entanglement in aerospace computing.");
});
