// src/content/author-extractor.js
// Deterministic, coupled author identity extractor for LinkedIn posts.
// Supports personal (/in/), company (/company/), school (/school/), and showcase (/showcase/) profiles.

const VALID_AUTHOR_PATH_REGEX = /\/(in|company|school|showcase)\/[a-zA-Z0-9_\-%]+/i;
const INVALID_AUTHOR_PATH_REGEX = /\/(feed\/update|posts|messaging|jobs|notifications)\b/i;

/**
 * Normalizes a raw URL via the standard sanitization rules:
 * - Strictly allows http: and https:
 * - Strips query parameters (?trk=...), fragments (#...), www. prefix, and trailing slashes.
 *
 * @param {string} rawUrl
 * @returns {string}
 */
export function defaultSanitizeUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    const host = parsed.host.toLowerCase().replace(/^www\./, "");
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${host}${pathname === "/" ? "" : pathname}`;
  } catch {
    return "";
  }
}

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
  name = name.replace(/\s+(reposted|shared|liked|commented\s+on)\s+this.*$/i, "");
  name = name.replace(/^(Promoted|Suggested\s+for\s+you|Suggested)\b.*/i, "");

  // 5. Clean extra bullet artifacts and whitespace
  name = name.replace(/^[•·\s-]+|[•·\s-]+$/g, "").trim();
  name = name.replace(/\s+/g, " ");

  return name;
}

/**
 * Extracts coupled author name and canonical author profile URL from a post DOM container.
 *
 * @param {Element|Object} el - Post container element
 * @param {Function} [sanitizeUrlFn=defaultSanitizeUrl] - URL sanitization function
 * @returns {{ author: string, authorUrl: string }}
 */
export function extractAuthor(el, sanitizeUrlFn = defaultSanitizeUrl) {
  if (!el || typeof el.querySelector !== "function") {
    return { author: "", authorUrl: "" };
  }

  // 1. Scope query to the primary actor region if present (excluding social context headers)
  const ACTOR_CONTAINER_SELECTORS = [
    ".update-components-actor",
    ".feed-shared-actor",
    "[data-testid='actor-container']",
    ".feed-shared-actor__container-link",
  ];

  let actorScope = null;
  for (const sel of ACTOR_CONTAINER_SELECTORS) {
    const found = el.querySelector(sel);
    if (found) {
      actorScope = found;
      break;
    }
  }

  const searchRoot = actorScope || el;

  // 2. Locate the primary identity anchor <a>
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

  let profileAnchor = null;
  for (const sel of PROFILE_LINK_SELECTORS) {
    const anchors = Array.from(searchRoot.querySelectorAll(sel));
    for (const a of anchors) {
      // Exclude social header links (e.g. "Jane Doe reposted this" in .update-components-header)
      if (a.closest?.(".update-components-header") || a.closest?.(".feed-shared-header")) {
        continue;
      }
      const rawHref = a.getAttribute("href") || a.href || "";
      if (isValidAuthorUrl(rawHref)) {
        profileAnchor = a;
        break;
      }
    }
    if (profileAnchor) break;
  }

  let rawAuthor = "";
  let authorUrl = "";

  if (profileAnchor) {
    const rawHref = profileAnchor.getAttribute("href") || profileAnchor.href || "";
    const sanitized = sanitizeUrlFn(rawHref);
    if (isValidAuthorUrl(sanitized)) {
      authorUrl = sanitized;
    }

    // Coupled Name Extraction Priority:
    // Priority 1: aria-label on the anchor
    const ariaLabel = profileAnchor.getAttribute("aria-label");
    if (ariaLabel && cleanAuthorName(ariaLabel)) {
      rawAuthor = ariaLabel;
    }

    // Priority 2: explicit author-name semantic element within anchor or actor scope
    if (!rawAuthor) {
      const nameEl =
        profileAnchor.querySelector(".update-components-actor__name") ||
        profileAnchor.querySelector(".feed-shared-actor__name") ||
        profileAnchor.querySelector("span[dir='ltr']") ||
        searchRoot.querySelector(".update-components-actor__name") ||
        searchRoot.querySelector(".feed-shared-actor__name") ||
        searchRoot.querySelector("span[dir='ltr']");
      if (nameEl?.innerText?.trim()) {
        rawAuthor = nameEl.innerText.trim();
      } else if (nameEl?.textContent?.trim()) {
        rawAuthor = nameEl.textContent.trim();
      }
    }

    // Priority 3: textContent of the anchor
    if (!rawAuthor && profileAnchor.textContent?.trim()) {
      rawAuthor = profileAnchor.textContent.trim();
    }

    // Priority 4: image alt text
    if (!rawAuthor) {
      const img = profileAnchor.querySelector("img[alt]");
      if (img?.getAttribute("alt")?.trim()) {
        rawAuthor = img.getAttribute("alt").trim();
      }
    }
  }

  // 3. Fallback: Semantic Name Element without Link
  if (!rawAuthor) {
    const nameEl =
      searchRoot.querySelector(".update-components-actor__name") ||
      searchRoot.querySelector(".feed-shared-actor__name") ||
      searchRoot.querySelector("span.update-components-actor__title span[dir='ltr']");
    if (nameEl) {
      if (!nameEl.closest?.(".update-components-header") && !nameEl.closest?.(".feed-shared-header")) {
        rawAuthor = (nameEl.innerText || nameEl.textContent || "").trim();
      }
    }
  }

  const cleanName = cleanAuthorName(rawAuthor);

  // Strict Author Absence Semantics: return empty strings if no trustworthy identity
  return {
    author: cleanName,
    authorUrl: authorUrl,
  };
}
