// src/content/author-extractor.js
// Ranked candidate-selection author identity extractor for LinkedIn posts.
// Supports personal (/in/), company (/company/), school (/school/), and showcase (/showcase/) profiles.

import { sanitizeUrl } from "../storage/saved-posts-store.js";

const VALID_AUTHOR_PATH_REGEX = /\/(in|company|school|showcase)\/[a-zA-Z0-9_\-%]+/i;
const INVALID_AUTHOR_PATH_REGEX = /\/(feed\/update|posts|messaging|jobs|notifications)\b/i;

const SOCIAL_CONTEXT_PATTERNS = [
  /\blikes\s+this\b/i,
  /\bliked\s+this\b/i,
  /\bcommented\s+on\s+this\b/i,
  /\breposted\s+this\b/i,
  /\bshared\s+this\b/i,
  /\bfollows\s+this\b/i,
  /\bpromoted\b/i,
  /\bsuggested\b/i,
];

const DISQUALIFIED_CONTAINER_SELECTORS = [
  ".update-components-header",
  ".feed-shared-header",
  ".feed-shared-update-v2__header",
  ".update-components-social-activity",
  "[data-testid*='social-activity']",
  ".comments-comments-list",
  ".comments-comment-item",
  ".comments-post-meta",
  ".feed-shared-social-actions",
  ".feed-shared-social-action-bar",
  ".social-details-reactors-facepile",
  ".artdeco-button",
];

/**
 * Verifies that a URL points to a legitimate LinkedIn actor identity destination.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isValidAuthorUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  if (INVALID_AUTHOR_PATH_REGEX.test(url)) return false;
  return VALID_AUTHOR_PATH_REGEX.test(url);
}

/**
 * Conservatively sanitizes an extracted author name by removing known LinkedIn UI badges and noise.
 * Never applies broad NLP heuristics that could alter legitimate names or titles.
 *
 * @param {string} rawName
 * @returns {string}
 */
export function cleanAuthorName(rawName) {
  if (typeof rawName !== "string" || !rawName.trim()) return "";

  // 1. If multiline, filter out lines that are purely "View ... profile" accessibility text
  const lines = rawName
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^View\s+.+?['’]s\s+(profile|page|company\s+page)$/i.test(l));

  let name = lines.length > 0 ? lines[0] : rawName.trim();

  // 2. Remove accessibility prefixes if inline: "View Alice's profile" -> "Alice"
  name = name.replace(/^View\s+(.+?)['’]s\s+(profile|page|company\s+page).*$/i, "$1");

  // 3. Remove connection badges and indicators (• 1st, • 2nd, • 3rd+, • Following, • You)
  name = name.replace(/\s*[•·]\s*(1st|2nd|3rd\+?|Following|You|Premium)\b.*/i, "");

  // 4. Remove social context phrases (reposted this, liked this, Promoted, Suggested)
  name = name.replace(/\s+(reposted|shared|liked|commented\s+on|likes|follows)\s+this.*$/i, "");
  name = name.replace(/^(Promoted|Suggested\s+for\s+you|Suggested)\b.*/i, "");

  // 5. Clean extra bullet artifacts and whitespace
  name = name.replace(/^[•·\s-]+|[•·\s-]+$/g, "").trim();
  name = name.replace(/\s+/g, " ");

  return name;
}

/**
 * Checks if an element is part of a secondary or social-context region (liker, resharer header, comments, etc.).
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isDisqualifiedElement(el) {
  if (!el) return true;

  // 1. Check parent hierarchy for disqualified container classes
  for (const sel of DISQUALIFIED_CONTAINER_SELECTORS) {
    if (el.closest?.(sel)) return true;
  }

  // 2. Check surrounding text for social context indicators ("likes this", "commented on this")
  const parentText = (el.parentElement?.textContent || "").toLowerCase();
  for (const pattern of SOCIAL_CONTEXT_PATTERNS) {
    if (pattern.test(parentText)) return true;
  }

  return false;
}

/**
 * Extracts explicit post author metadata from container accessibility labels if present.
 * Covers:
 * - aria-label="Open control menu for post by Armin Daraei"
 * - aria-label="Hide post by Armin Daraei"
 * - aria-label="Feed post by Armin Daraei"
 * - aria-label="Post by Armin Daraei"
 * - aria-label="Update by Armin Daraei"
 *
 * @param {Element} root
 * @returns {string} Clean author name from metadata or ""
 */
export function extractExplicitAuthorMetadata(root) {
  if (!root || typeof root.getAttribute !== "function") return "";

  const ariaLabels = [];
  const rootAria = root.getAttribute("aria-label");
  if (rootAria) ariaLabels.push(rootAria);

  if (typeof root.querySelectorAll === "function") {
    const labelled = root.querySelectorAll("[aria-label*='post by '], [aria-label*='Post by '], [aria-label*='update by '], [aria-label*='Update by ']");
    for (const l of labelled) {
      const a = l.getAttribute("aria-label");
      if (a) ariaLabels.push(a);
    }
  }

  for (const label of ariaLabels) {
    const match = label.match(/\b(?:post|update)\s+by\s+([^,.;\n]+)/i);
    if (match && match[1]) {
      const clean = cleanAuthorName(match[1]);
      if (clean) return clean;
    }
  }

  return "";
}

/**
 * Extracts coupled author name and canonical author profile URL from a post DOM container
 * using a ranked candidate-selection pipeline.
 *
 * @param {Element|Object} el - Post container element
 * @param {Function} [sanitizeUrlFn=sanitizeUrl] - Canonical URL sanitization function
 * @returns {{ author: string, authorUrl: string }}
 */
export function extractAuthor(el, sanitizeUrlFn = sanitizeUrl) {
  if (!el || typeof el.querySelector !== "function") {
    return { author: "", authorUrl: "" };
  }

  // 1. Extract explicit metadata signal if present (e.g. control menu / post label)
  const explicitAuthorName = extractExplicitAuthorMetadata(el);

  // 2. Locate and rank all candidate profile anchors in the post
  const PROFILE_LINK_SELECTORS = [
    "a.update-components-actor__image[href]",
    "a.feed-shared-actor__container-link[href]",
    "a.update-components-actor__container-link[href]",
    "a.app-aware-link[href*='/in/']",
    "a.app-aware-link[href*='/company/']",
    "a.app-aware-link[href*='/school/']",
    "a.app-aware-link[href*='/showcase/']",
    "a[href*='/in/']",
    "a[href*='/company/']",
    "a[href*='/school/']",
    "a[href*='/showcase/']",
  ];

  const candidateAnchors = [];
  const seenUrls = new Set();

  for (const sel of PROFILE_LINK_SELECTORS) {
    const matches = Array.from(el.querySelectorAll(sel));
    for (const a of matches) {
      const rawHref = a.getAttribute("href") || a.href || "";
      if (!isValidAuthorUrl(rawHref)) continue;

      const sanitizedHref = sanitizeUrlFn(rawHref);
      if (!isValidAuthorUrl(sanitizedHref)) continue;

      if (seenUrls.has(sanitizedHref)) continue;
      seenUrls.add(sanitizedHref);

      // Check disqualification (social headers, comments, etc.)
      if (isDisqualifiedElement(a)) continue;

      // Score this candidate
      let score = 10; // Base score for valid profile link outside disqualified containers

      const inActorContainer = Boolean(
        a.closest?.(".update-components-actor") ||
        a.closest?.(".feed-shared-actor") ||
        a.closest?.("[data-testid='actor-container']")
      );
      if (inActorContainer) score += 100;

      const inActorMeta = Boolean(
        a.closest?.(".update-components-actor__meta") ||
        a.closest?.(".update-components-actor__title") ||
        a.closest?.(".feed-shared-actor__title") ||
        a.closest?.(".update-components-actor__container")
      );
      if (inActorMeta) score += 50;

      if (
        a.classList?.contains?.("update-components-actor__image") ||
        a.classList?.contains?.("feed-shared-actor__container-link") ||
        a.classList?.contains?.("update-components-actor__container-link")
      ) {
        score += 40;
      }

      // Check for explicit name match
      const ariaLabel = a.getAttribute("aria-label") || "";
      const text = a.textContent || "";
      const cleanAria = cleanAuthorName(ariaLabel);
      const cleanText = cleanAuthorName(text);

      if (explicitAuthorName) {
        if (
          cleanAria.toLowerCase() === explicitAuthorName.toLowerCase() ||
          cleanText.toLowerCase() === explicitAuthorName.toLowerCase() ||
          sanitizedHref.toLowerCase().includes(explicitAuthorName.toLowerCase().replace(/\s+/g, ""))
        ) {
          score += 200;
        }
      }

      if (cleanAria || cleanText) score += 20;

      candidateAnchors.push({
        anchor: a,
        authorUrl: sanitizedHref,
        score,
        inActorContainer,
      });
    }
  }

  // Sort candidates by score descending
  candidateAnchors.sort((a, b) => b.score - a.score);

  if (candidateAnchors.length > 0 && candidateAnchors[0].score > 0) {
    const winner = candidateAnchors[0];
    const anchor = winner.anchor;
    const authorUrl = winner.authorUrl;

    // Resolve name from winning identity subtree
    let rawAuthor = "";

    // Priority 1: Exact explicit metadata if present and matches scope
    if (explicitAuthorName && winner.score >= 100) {
      rawAuthor = explicitAuthorName;
    }

    // Priority 2: aria-label on anchor
    if (!rawAuthor) {
      const ariaLabel = anchor.getAttribute("aria-label");
      if (ariaLabel && cleanAuthorName(ariaLabel)) {
        rawAuthor = ariaLabel;
      }
    }

    // Priority 3: semantic name element within the winner's actor scope
    if (!rawAuthor) {
      const scope = anchor.closest?.(".update-components-actor, .feed-shared-actor") || anchor;
      const nameEl =
        scope.querySelector(".update-components-actor__name") ||
        scope.querySelector(".feed-shared-actor__name") ||
        scope.querySelector("span[dir='ltr']");
      if (nameEl?.innerText?.trim()) {
        rawAuthor = nameEl.innerText.trim();
      } else if (nameEl?.textContent?.trim()) {
        rawAuthor = nameEl.textContent.trim();
      }
    }

    // Priority 4: text content of the anchor
    if (!rawAuthor && anchor.textContent?.trim()) {
      rawAuthor = anchor.textContent.trim();
    }

    // Priority 5: image alt
    if (!rawAuthor) {
      const img = anchor.querySelector("img[alt]");
      if (img?.getAttribute("alt")?.trim()) {
        rawAuthor = img.getAttribute("alt").trim();
      }
    }

    const author = cleanAuthorName(rawAuthor);
    return { author, authorUrl };
  }

  // 3. Fallback: Semantic Name Element without Link (outside social context)
  const nameEl =
    el.querySelector(".update-components-actor__name") ||
    el.querySelector(".feed-shared-actor__name") ||
    el.querySelector("span.update-components-actor__title span[dir='ltr']");

  if (nameEl && !isDisqualifiedElement(nameEl)) {
    const rawAuthor = (nameEl.innerText || nameEl.textContent || "").trim();
    const cleanName = cleanAuthorName(rawAuthor);
    return {
      author: cleanName,
      authorUrl: "",
    };
  }

  // If explicit metadata was on the container but no links found
  if (explicitAuthorName) {
    return {
      author: explicitAuthorName,
      authorUrl: "",
    };
  }

  return { author: "", authorUrl: "" };
}
