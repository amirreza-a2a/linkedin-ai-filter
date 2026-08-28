import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAuthor,
  extractExplicitAuthorMetadata,
} from "../src/content/author-extractor.js";
import { extractPost } from "../src/content/content-index.js";

// DOM mock builder for deterministic Node testing
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
  if (sel === "a[href]") {
    return node.tagName === "A" && Boolean(node.attributes.href);
  }
  if (sel === "img[alt]") {
    return node.tagName === "IMG" && Boolean(node.attributes.alt);
  }
  if (sel.includes("span[dir='ltr']")) {
    return node.tagName === "SPAN" && node.attributes.dir === "ltr";
  }
  if (sel.includes("[data-testid=\"expandable-text-box\"]") || sel.includes("[data-testid='expandable-text-box']")) {
    return node.attributes["data-testid"] === "expandable-text-box";
  }
  if (sel.includes("[data-testid='actor-container']")) {
    return node.attributes["data-testid"] === "actor-container";
  }
  if (sel.includes("[aria-label*='post by ']") || sel.includes("[aria-label*='Post by ']")) {
    const aria = (node.attributes["aria-label"] || "").toLowerCase();
    return aria.includes("post by ");
  }
  return false;
}

/**
 * Immutable Golden LinkedIn DOM Fixture
 * Matches the exact structure and ordering of real LinkedIn feed posts:
 * 1. Liker header (Mohammad Abedini, /in/mohammadabedini/, likes this) appearing BEFORE the real author
 * 2. Control menu (aria-label="Open control menu for post by Armin Daraei" & aria-label="Hide post by Armin Daraei")
 * 3. Real author actor (Armin Daraei, /in/armindaraei/, "Armin Daraei • 1st", "AI & Systems Engineer")
 * 4. Follow button (aria-label="Follow Armin Daraei")
 * 5. Post text content
 * 6. Social actions and comments list
 */
function createGoldenLinkedInPostFixture() {
  // 1. Social Activity Liker Header (Mohammad Abedini likes this)
  const likerNameSpan = el("SPAN", { dir: "ltr" }, [], "Mohammad Abedini");
  const likerContainerSpan = el("SPAN", { class: "update-components-header__text" }, [likerNameSpan], "Mohammad Abedini");
  const likerAnchor = el(
    "A",
    {
      class: "app-aware-link update-components-header__image",
      href: "https://www.linkedin.com/in/mohammadabedini/",
    },
    [likerContainerSpan],
    "Mohammad Abedini"
  );
  const likesThisSpan = el("SPAN", { class: "update-components-header__text-view" }, [], "likes this");
  const headerWrapper = el(
    "DIV",
    { class: "update-components-header__text-wrapper" },
    [likerAnchor, likesThisSpan],
    "Mohammad Abedini likes this"
  );
  const socialHeader = el("DIV", { class: "update-components-header" }, [headerWrapper]);

  // 2. Control Menu with Explicit Post Author Signals
  const controlMenuBtn1 = el("BUTTON", {
    class: "artdeco-button",
    "aria-label": "Open control menu for post by Armin Daraei",
  });
  const controlMenuBtn2 = el("BUTTON", {
    class: "artdeco-button",
    "aria-label": "Hide post by Armin Daraei",
  });
  const controlMenu = el("DIV", { class: "feed-shared-control-menu" }, [controlMenuBtn1, controlMenuBtn2]);

  // 3. Primary Post Author Actor (Armin Daraei)
  const authorImg = el("IMG", { alt: "Armin Daraei" });
  const authorImgWrapper = el("DIV", { class: "ivm-image-view-model" }, [authorImg]);
  const authorAvatarAnchor = el(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/in/armindaraei/",
      "aria-label": "Armin Daraei",
    },
    [authorImgWrapper],
    "Armin Daraei"
  );

  const authorNameDir = el("SPAN", { dir: "ltr" }, [], "Armin Daraei");
  const authorNameSpan = el("SPAN", { class: "update-components-actor__name hoverable-link-text" }, [authorNameDir], "Armin Daraei");
  const degreeSpan = el("SPAN", { class: "visually-hidden" }, [], " • 1st");
  const degreeWrapper = el("SPAN", { class: "update-components-actor__supplementary-actor-info" }, [degreeSpan], " • 1st");
  const authorNameLink = el(
    "A",
    {
      class: "app-aware-link update-components-actor__container-link",
      href: "https://www.linkedin.com/in/armindaraei/",
    },
    [authorNameSpan, degreeWrapper],
    "Armin Daraei • 1st"
  );

  const descriptionSpan = el("SPAN", { class: "update-components-actor__description" }, [], "AI & Systems Engineer");
  const timestampLink = el(
    "A",
    {
      class: "app-aware-link update-components-actor__sub-description-link",
      href: "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678",
    },
    [],
    "2h • Edited"
  );
  const subDesc = el("DIV", { class: "update-components-actor__sub-description" }, [timestampLink], "2h • Edited");

  const actorMeta = el(
    "DIV",
    { class: "update-components-actor__meta" },
    [authorNameLink, descriptionSpan, subDesc]
  );

  const actorContainerInner = el(
    "DIV",
    { class: "update-components-actor__container" },
    [authorAvatarAnchor, actorMeta]
  );

  const followBtn = el("BUTTON", { class: "artdeco-button", "aria-label": "Follow Armin Daraei" }, [], "+ Follow");
  const followWrapper = el("DIV", { class: "feed-shared-follow-button" }, [followBtn]);

  const actorContainer = el(
    "DIV",
    { class: "update-components-actor display-flex" },
    [actorContainerInner, followWrapper]
  );

  // 4. Post Text Content
  const textDir = el("SPAN", { dir: "ltr" }, [], "Deep learning architectures, ranked candidate pipelines, and local LLM agents in production.");
  const textWrapper = el("SPAN", { class: "break-words" }, [textDir], "Deep learning architectures, ranked candidate pipelines, and local LLM agents in production.");
  const postContent = el("DIV", { class: "update-components-text" }, [textWrapper], "Deep learning architectures, ranked candidate pipelines, and local LLM agents in production.");

  // 5. Secondary Social Actions and Comments List
  const likeBtn = el("BUTTON", { class: "artdeco-button", "aria-label": "React Like" }, [], "Like");
  const socialActions = el("DIV", { class: "feed-shared-social-actions" }, [likeBtn]);

  const commenterAnchor = el("A", { class: "app-aware-link", href: "https://www.linkedin.com/in/commenter-jane/" }, [], "Jane Commenter");
  const commentItem = el("DIV", { class: "comments-comment-item" }, [commenterAnchor]);
  const commentsList = el("DIV", { class: "comments-comments-list" }, [commentItem]);

  // Root Post Container
  const postContainer = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "data-urn": "urn:li:activity:7123456789012345678",
    },
    [socialHeader, controlMenu, actorContainer, postContent, socialActions, commentsList]
  );

  return postContainer;
}

test("Golden DOM Regression: Extracts Armin Daraei and NEVER Mohammad Abedini", () => {
  const goldenPost = createGoldenLinkedInPostFixture();

  const explicitMetadata = extractExplicitAuthorMetadata(goldenPost);
  assert.equal(explicitMetadata, "Armin Daraei");

  const result = extractAuthor(goldenPost);

  assert.equal(result.author, "Armin Daraei");
  assert.equal(result.authorUrl, "https://linkedin.com/in/armindaraei");

  // Strict Negative Invariants
  assert.notEqual(result.author, "Mohammad Abedini");
  assert.notEqual(result.authorUrl, "https://linkedin.com/in/mohammadabedini");
  assert.notEqual(result.author, "Jane Commenter");
  assert.notEqual(result.authorUrl, "https://linkedin.com/in/commenter-jane");
});

test("Golden DOM Regression: Production extractPost() extracts verified post data with genuine author", () => {
  const goldenPost = createGoldenLinkedInPostFixture();

  const extracted = extractPost(goldenPost);

  assert.ok(extracted);
  assert.equal(extracted.id, "urn:li:activity:7123456789012345678");
  assert.equal(extracted.author, "Armin Daraei");
  assert.equal(extracted.authorUrl, "https://linkedin.com/in/armindaraei");
  assert.equal(extracted.postUrl, "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678");
  assert.match(extracted.text, /Deep learning architectures/);

  // Strict Negative Invariants
  assert.notEqual(extracted.author, "Mohammad Abedini");
  assert.notEqual(extracted.authorUrl, "https://linkedin.com/in/mohammadabedini");
});

test("Golden DOM Signals: Validates exact aria-label control menu patterns", () => {
  const btn1 = el("BUTTON", { "aria-label": "Open control menu for post by Armin Daraei" });
  const btn2 = el("BUTTON", { "aria-label": "Hide post by Armin Daraei" });
  const container = el("DIV", {}, [btn1, btn2]);

  assert.equal(extractExplicitAuthorMetadata(container), "Armin Daraei");
});

test("Negative Invariant: Explicit metadata of Person A cannot be paired with profile URL of Person B", () => {
  // Scenario: Container has metadata "post by Armin Daraei", but the only candidate anchor in the DOM is Alice
  const aliceAnchor = el(
    "A",
    {
      class: "app-aware-link update-components-actor__image",
      href: "https://www.linkedin.com/in/alice-smith",
      "aria-label": "Alice Smith",
    },
    [],
    "Alice Smith"
  );
  const actorContainer = el("DIV", { class: "update-components-actor" }, [aliceAnchor]);

  // Container has explicit label for Armin Daraei
  const postContainer = el(
    "DIV",
    {
      class: "feed-shared-update-v2",
      "aria-label": "Feed post by Armin Daraei",
    },
    [actorContainer]
  );

  const result = extractAuthor(postContainer);

  // CORE INVARIANT: author and authorUrl must originate from the SAME candidate subtree.
  // The system must NEVER return { author: "Armin Daraei", authorUrl: "https://linkedin.com/in/alice-smith" }.
  assert.equal(result.author, "Alice Smith");
  assert.equal(result.authorUrl, "https://linkedin.com/in/alice-smith");
  assert.notEqual(result.author, "Armin Daraei");
});
