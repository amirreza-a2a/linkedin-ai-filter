// src/content/content-bundle.js
// AUTO-GENERATED BUNDLE FOR CHROME MV3 CONTENT SCRIPT EXECUTION
// Do not edit directly; modify source files in src/content/ and run `node scripts/bundle-content.js`.

(() => {
  "use strict";

  // --- 1. Logger Subsystem ---
  // src/utils/logger.js
  // Centralized diagnostic logger with runtime debug gating.
  
  const isDebugEnabled = () => {
    if (typeof window !== "undefined" && Boolean(window.__FEEDRULE_DEBUG__)) return true;
    if (typeof globalThis !== "undefined" && Boolean(globalThis.__FEEDRULE_DEBUG__)) return true;
    if (typeof process !== "undefined" && Boolean(process.env?.FEEDRULE_DEBUG)) return true;
    return false;
  };
  
  const logger = {
    debug: (tag, ...args) => {
      if (isDebugEnabled()) {
        console.log(`[FeedRule][${tag}]`, ...args);
      }
    },
    info: (tag, ...args) => {
      if (isDebugEnabled()) {
        console.info(`[FeedRule][${tag}]`, ...args);
      }
    },
    warn: (tag, ...args) => {
      console.warn(`[FeedRule][${tag}]`, ...args);
    },
    error: (tag, ...args) => {
      console.error(`[FeedRule][${tag}]`, ...args);
    },
  };

  // --- 2. URL Sanitization Helper ---
  function sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const trimmed = rawUrl.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      // Strip query parameters and hash fragments
      parsed.search = "";
      parsed.hash = "";
      // Normalize hostname (lowercase and remove www. prefix)
      parsed.hostname = parsed.hostname.toLowerCase();
      if (parsed.hostname.startsWith("www.")) {
        parsed.hostname = parsed.hostname.slice(4);
      }
      // Normalize trailing slash on path (e.g. /in/alice/ -> /in/alice)
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString();
    } catch {
      return "";
    }
  }

  // --- 3. Post Container Qualifier ---
  // src/content/post-qualifier.js
  // Conservative Two-Stage Post Container Qualification Layer for LinkedIn DOM.
  // Balances strict negative protection (composers, carousels, comments)
  // with weighted positive evidence and an AMBIGUOUS path to prevent false negatives.
  
  const DISQUALIFIED_COMPOSER_SELECTORS = [
    "[data-testid='share-box']",
    ".share-box-feed-entry__wrapper",
    ".share-box-feed-entry",
    ".feed-shared-creator-v2",
    "button[aria-label*='Start a post']",
    "button[aria-label*='Create a post']",
    ".share-creation-state",
    ".share-box__input",
  ];
  
  const DISQUALIFIED_RECS_SELECTORS = [
    ".feed-shared-recon-entity",
    ".feed-shared-pymk-list",
    ".feed-shared-carousel",
    ".feed-shared-actor-recommendation",
    "[data-testid*='recs-list']",
  ];
  
  const ACCEPT_THRESHOLD = 40;
  const AMBIGUOUS_THRESHOLD = 15;
  
  /**
   * Evaluates candidate container and returns deterministic qualification decision:
   * - "ACCEPT": Strong evidence of genuine post
   * - "AMBIGUOUS": Partial signals; delegated to extractPost() to inspect text/ID
   * - "REJECT": Obvious non-post UI or insufficient evidence
   *
   * @param {Element|Object} el
   * @returns {{
   *   qualified: boolean,
   *   decision: "ACCEPT" | "AMBIGUOUS" | "REJECT",
   *   score: number,
   *   signals: Record<string, boolean>,
   *   reason: string
   * }}
   */
  function isLikelyPostContainer(el) {
    if (!el || typeof el.querySelector !== "function") {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: {},
        reason: "invalid-element",
      };
    }
  
    // =========================================================================
    // STAGE 1: HARD NEGATIVE REJECTIONS (Obvious Non-Post UI Components)
    // =========================================================================
  
    // 1. "Start a post" / Composer UI
    for (const sel of DISQUALIFIED_COMPOSER_SELECTORS) {
      if (el.matches?.(sel) || el.classList?.contains?.(sel.replace(/^\./, "")) || el.querySelector?.(sel)) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { composer: true },
          reason: "composer-detected",
        };
      }
    }
  
    // 2. "Recommended for you" / Follow recommendation carousels / PYMK lists
    for (const sel of DISQUALIFIED_RECS_SELECTORS) {
      if (el.matches?.(sel) || el.classList?.contains?.(sel.replace(/^\./, "")) || el.querySelector?.(sel)) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { recommendation: true },
          reason: "recommendation-card",
        };
      }
    }
  
    // Multiple entity cards / follow buttons with no genuine post text
    const followButtons = el.querySelectorAll?.("button[aria-label*='Follow'], .feed-shared-actor-recommendation button");
    const profileLinks = el.querySelectorAll?.("a[href*='/in/'], a[href*='/company/']");
    if (followButtons?.length >= 3 && profileLinks?.length >= 3) {
      const hasPostText = Boolean(
        el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text")
      );
      if (!hasPostText) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { recommendation: true },
          reason: "recommendation-card",
        };
      }
    }
  
    // Check recommendation headers (e.g. "Recommended for you", "People you may know")
    const headerText = (
      el.querySelector?.(".feed-shared-header, h2, h3, .update-components-header")?.textContent || ""
    ).toLowerCase();
    if (
      headerText.includes("recommended for you") ||
      headerText.includes("people you may know") ||
      headerText.includes("suggested for you") ||
      headerText.includes("recommended pages")
    ) {
      const hasPostText = Boolean(
        el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text")
      );
      if (!hasPostText) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { recommendation: true },
          reason: "recommendation-card",
        };
      }
    }
  
    // 3. Comments-only container
    if (
      el.classList?.contains?.("comments-comments-list") ||
      el.classList?.contains?.("comments-comment-item") ||
      (el.querySelector?.(".comments-comment-item") && !el.querySelector?.(".update-components-actor, .feed-shared-actor, [data-urn*='activity:']"))
    ) {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: { comments: true },
        reason: "comments-container",
      };
    }
  
    // 4. Social-action-only containers
    if (
      el.classList?.contains?.("feed-shared-social-actions") ||
      el.classList?.contains?.("feed-shared-social-action-bar")
    ) {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: { socialActionsOnly: true },
        reason: "social-action-only",
      };
    }
  
    // =========================================================================
    // STAGE 2: WEIGHTED POSITIVE EVIDENCE SCORING
    // =========================================================================
  
    const urn =
      el.getAttribute?.("data-urn") ||
      el.getAttribute?.("data-id") ||
      el.querySelector?.("[data-urn*='activity:'], [data-urn*='ugcPost:'], [data-urn*='sponsoredUpdate:']")?.getAttribute?.("data-urn") ||
      "";
  
    const hasValidPostUrn = /^urn:li:(?:activity|ugcPost|sponsoredUpdate):\d+$/i.test(urn);
  
    const hasPostPermalink = Boolean(
      el.querySelector?.(
        "a[href*='/feed/update/urn:li:activity:'], a[href*='/feed/update/urn:li:ugcPost:'], a[href*='/posts/'], a.update-components-actor__sub-description-link[href*='/feed/update/']"
      )
    );
  
    const hasUpdateClass =
      el.classList?.contains?.("feed-shared-update-v2") ||
      Boolean(el.querySelector?.(".feed-shared-update-v2")) ||
      Boolean(el.getAttribute?.("data-testid")?.includes("feed-update"));
  
    const hasActorStructure = Boolean(
      el.querySelector?.(".update-components-actor, .feed-shared-actor, [data-testid='actor-container'], .feed-shared-actor__container-link")
    );
  
    const hasPostTextStructure = Boolean(
      el.querySelector?.(
        ".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text, .feed-shared-inline-show-more-text"
      )
    );
  
    const hasTimestamp = Boolean(
      el.querySelector?.(".update-components-actor__sub-description, .feed-shared-actor__sub-description, time, a[href*='/feed/update/']")
    );
  
    const hasControlMenu = Boolean(
      el.querySelector?.(".feed-shared-control-menu, button[aria-label*='post by '], button[aria-label*='Post by '], button[aria-label*='update by ']")
    );
  
    const hasAuthorLink = Boolean(
      el.querySelector?.("a[href*='/in/'], a[href*='/company/'], a[href*='/school/'], a[href*='/showcase/']")
    );
  
    const hasSocialActions = Boolean(
      el.querySelector?.(".feed-shared-social-actions, .feed-shared-social-action-bar, button[aria-label*='React Like'], button[aria-label*='Comment']")
    );
  
    // Compute weighted score
    let score = 0;
    if (hasValidPostUrn) score += 40;
    if (hasPostPermalink) score += 35;
    if (hasUpdateClass) score += 25;
    if (hasActorStructure) score += 25;
    if (hasPostTextStructure) score += 25;
    if (hasTimestamp) score += 20;
    if (hasControlMenu) score += 20;
    if (hasAuthorLink) score += 15;
    if (hasSocialActions) score += 10;
  
    const signals = {
      urn: hasValidPostUrn,
      permalink: hasPostPermalink,
      updateClass: hasUpdateClass,
      actor: hasActorStructure,
      text: hasPostTextStructure,
      timestamp: hasTimestamp,
      controlMenu: hasControlMenu,
      authorLink: hasAuthorLink,
      socialActions: hasSocialActions,
    };
  
    // =========================================================================
    // STAGE 3: CLASSIFICATION DECISION
    // =========================================================================
  
    if (score >= ACCEPT_THRESHOLD) {
      return {
        qualified: true,
        decision: "ACCEPT",
        score,
        signals,
        reason: hasValidPostUrn ? "activity-urn-and-content" : "strong-post-structure",
      };
    }
  
    if (score >= AMBIGUOUS_THRESHOLD) {
      return {
        qualified: true,
        decision: "AMBIGUOUS",
        score,
        signals,
        reason: "partial-signals-delegated-to-extractPost",
      };
    }
  
    return {
      qualified: false,
      decision: "REJECT",
      score,
      signals,
      reason: "insufficient-signals",
    };
  }

  // --- 4. Author Extractor ---
  // src/content/author-extractor.js
  // Ranked candidate-selection author identity extractor for LinkedIn posts.
  // Supports personal (/in/), company (/company/), school (/school/), and showcase (/showcase/) profiles.
  //
  // CORE INVARIANT:
  // `author` and `authorUrl` must ALWAYS originate from the exact same winning identity candidate / subtree.
  // Explicit metadata or headers from one actor MUST NEVER be paired with a profile URL of another actor.
  
  
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
  
  const COMBINED_PROFILE_LINK_SELECTOR = [
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
  ].join(", ");
  
  /**
   * Verifies that a URL points to a legitimate LinkedIn actor identity destination.
   *
   * @param {string} url
   * @returns {boolean}
   */
  function isValidAuthorUrl(url) {
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
  function cleanAuthorName(rawName) {
    if (typeof rawName !== "string" || !rawName.trim()) return "";
  
    // 1. If multiline, filter out lines that are purely "View ... profile" accessibility text
    const lines = rawName
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^View\s+.+?['’]s\s+(profile|page|company\s+page)$/i.test(l));
  
    let name = lines.length > 0 ? lines[0] : rawName.trim();
  
    // 2. Remove accessibility prefixes if inline: "View Alice's profile" -> "Alice"
    name = name.replace(/^View\s+(.+?)['’]s\s+(?:profile|page|company\s+page)$/i, "$1");
  
    // 3. Remove connection degree badges ("• 1st", "• 2nd", "• 3rd+", "Following", "You", "Premium")
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
   * Checks whether an element is inside an excluded social-context or comments region.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function isDisqualifiedElement(el) {
    if (!el) return true;
  
    // 1. Explicit disqualification selectors (headers, likers, comments, social actions)
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
   * Checks whether a candidate anchor's subtree matches a target author name.
   * Prevents cross-contamination where explicit post metadata of Actor A is applied to Actor B's URL.
   *
   * @param {Element} anchor
   * @param {string} authorUrl
   * @param {string} explicitName
   * @returns {boolean}
   */
  function doesCandidateMatchExplicitName(anchor, authorUrl, explicitName) {
    if (!explicitName || typeof explicitName !== "string") return false;
    const target = explicitName.trim().toLowerCase();
    if (!target) return false;
  
    const aria = cleanAuthorName(anchor.getAttribute?.("aria-label") || "").toLowerCase();
    if (aria === target) return true;
  
    const text = cleanAuthorName(anchor.textContent || "").toLowerCase();
    if (text === target) return true;
  
    const scope = anchor.closest?.(".update-components-actor, .feed-shared-actor") || anchor;
    const nameEl =
      scope.querySelector?.(".update-components-actor__name") ||
      scope.querySelector?.(".feed-shared-actor__name") ||
      scope.querySelector?.("span[dir='ltr']");
    const scopeName = cleanAuthorName(nameEl?.innerText || nameEl?.textContent || "").toLowerCase();
    if (scopeName === target) return true;
  
    const img = anchor.querySelector?.("img[alt]");
    const alt = cleanAuthorName(img?.getAttribute?.("alt") || "").toLowerCase();
    if (alt === target) return true;
  
    // Check URL slug (e.g. "https://linkedin.com/in/armindaraei" matches "Armin Daraei")
    const targetSlug = target.replace(/[^a-z0-9]/g, "");
    const urlSlug = (authorUrl || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (targetSlug.length >= 4 && urlSlug.includes(targetSlug)) return true;
  
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
  function extractExplicitAuthorMetadata(root) {
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
   * Extracts author identity from a post container using a ranked candidate-selection pipeline.
   *
   * RANKING PRIORITY:
   * 1. Explicit post-author accessibility labels (e.g. "Open control menu for post by <Author>")
   * 2. Anchors inside primary post-header actor containers (.update-components-actor, .feed-shared-actor)
   * 3. Anchors with specific actor markup classes
   * 4. General identity links (/in/, /company/, /school/, /showcase/)
   *
   * STRICT INVARIANT:
   * `author` and `authorUrl` MUST originate from the same winning identity candidate / subtree.
   *
   * @param {Element} el Post container element
   * @param {Function} [sanitizeUrlFn=sanitizeUrl] Canonical URL sanitizer
   * @returns {{ author: string, authorUrl: string }}
   */
  function extractAuthor(el, sanitizeUrlFn = sanitizeUrl) {
    if (!el || typeof el.querySelector !== "function") {
      return { author: "", authorUrl: "" };
    }
  
    // 1. Extract explicit metadata signal if present (e.g. control menu / post label)
    const explicitAuthorName = extractExplicitAuthorMetadata(el);
  
    // 2. Locate and rank all candidate profile anchors in the post in a single query pass
    const candidateAnchors = [];
    const seenUrls = new Set();
  
    const matches = Array.from(el.querySelectorAll(COMBINED_PROFILE_LINK_SELECTOR));
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
  
      if (explicitAuthorName && doesCandidateMatchExplicitName(a, sanitizedHref, explicitAuthorName)) {
        score += 200;
      }
  
      if (cleanAria || cleanText) score += 20;
  
      candidateAnchors.push({
        anchor: a,
        authorUrl: sanitizedHref,
        score,
        inActorContainer,
      });
    }
  
    // Sort candidates by score descending
    candidateAnchors.sort((a, b) => b.score - a.score);
  
    if (candidateAnchors.length > 0 && candidateAnchors[0].score > 0) {
      const winner = candidateAnchors[0];
      const anchor = winner.anchor;
      const authorUrl = winner.authorUrl;
  
      // CORE INVARIANT: author and authorUrl must always originate from the same winning identity subtree.
      let rawAuthor = "";
  
      // If explicit metadata exists and genuinely matches this winning candidate subtree, use explicit name
      if (explicitAuthorName && doesCandidateMatchExplicitName(anchor, authorUrl, explicitAuthorName)) {
        rawAuthor = explicitAuthorName;
      }
  
      // Priority 1: aria-label on anchor
      if (!rawAuthor) {
        const ariaLabel = anchor.getAttribute("aria-label");
        if (ariaLabel && cleanAuthorName(ariaLabel)) {
          rawAuthor = ariaLabel;
        }
      }
  
      // Priority 2: semantic name element within the winner's actor scope
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
  
      // Priority 3: text content of the anchor
      if (!rawAuthor && anchor.textContent?.trim()) {
        rawAuthor = anchor.textContent.trim();
      }
  
      // Priority 4: image alt
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

  // --- 5. Content Script Core Pipeline ---
  // src/content/content-index.js
  // Feed watcher & DOM filter for LinkedIn feed using standard ES modules.
  // Identity-aware incremental reprocessing for initial load, Load More, container reuse, and video autoplay.
  // High-performance architecture: non-feed fast rejection, scoped mutation routing, cached video state, and 0 in-flight memory leaks.
  
  
  
  
  logger.debug("CONTENT", "content script module loaded on", typeof location !== "undefined" ? location.href : "");
  
  const HIDDEN_CLASS = "feedrule-hidden";
  
  const COMBINED_CONTAINER_SELECTOR = [
    "div.feed-shared-update-v2",
    "div[data-urn*='activity:']",
    "div[data-urn*='ugcPost:']",
    "div[data-urn*='sponsoredUpdate:']",
    "div[data-id*='activity:']",
    'div[data-testid="mainFeed"] div[role="listitem"]',
    'div[role="listitem"]',
  ].join(", ");
  
  const NON_FEED_ANCESTOR_SELECTOR = [
    "#global-nav",
    ".global-nav",
    ".msg-overlay-container",
    ".msg-overlay-list-bubble",
    ".scaffold-layout__aside",
    "#artdeco-toasts__wormhole",
    ".feed-follows-module",
    "aside",
    "header",
    "footer",
  ].join(", ");
  
  const TEXT_CANDIDATES = [
    '[data-testid="expandable-text-box"]',
    ".feed-shared-update-v2__description",
    ".update-components-text",
    ".feed-shared-text",
    ".feed-shared-inline-show-more-text",
  ];
  
  const POST_LINK_CANDIDATES = [
    "a.update-components-actor__sub-description-link[href*='/feed/update/']",
    "a.update-components-actor__sub-description-link[href*='/posts/']",
    "a.update-components-actor__sub-description a[href*='/feed/update/']",
    "a.feed-shared-actor__sub-description a[href*='/feed/update/']",
    "a[href*='/feed/update/urn:li:activity:']",
    "a[href*='/feed/update/urn:li:ugcPost:']",
    "a.app-aware-link[href*='/feed/update/']",
    "a.app-aware-link[href*='/posts/']",
  ];
  
  // --- Performance Instrumentation Counters (Dev / Diagnostic) ---------
  const performanceStats = {
    mutationCallbacks: 0,
    childListMutations: 0,
    attributeMutations: 0,
    classMutations: 0,
    identityMutations: 0,
    relevantMutations: 0,
    ignoredMutations: 0,
    feedContainerResolutions: 0,
    postContainerResolutions: 0,
    scanCalls: 0,
    findContainersCalls: 0,
    querySelectorAllCalls: 0,
    videoPauseTraversals: 0,
    videosPaused: 0,
    classificationDispatches: 0,
    mutationQueueMaxSize: 0,
    inFlightElementMaxSize: 0,
    startTime: typeof Date !== "undefined" ? Date.now() : 0,
  };
  
  function resetPerformanceStats() {
    performanceStats.mutationCallbacks = 0;
    performanceStats.childListMutations = 0;
    performanceStats.attributeMutations = 0;
    performanceStats.classMutations = 0;
    performanceStats.identityMutations = 0;
    performanceStats.relevantMutations = 0;
    performanceStats.ignoredMutations = 0;
    performanceStats.feedContainerResolutions = 0;
    performanceStats.postContainerResolutions = 0;
    performanceStats.scanCalls = 0;
    performanceStats.findContainersCalls = 0;
    performanceStats.querySelectorAllCalls = 0;
    performanceStats.videoPauseTraversals = 0;
    performanceStats.videosPaused = 0;
    performanceStats.classificationDispatches = 0;
    performanceStats.mutationQueueMaxSize = 0;
    performanceStats.inFlightElementMaxSize = 0;
    performanceStats.startTime = Date.now();
  }
  
  function getContentPerformanceStats() {
    return {
      ...performanceStats,
      mutationQueueSize: mutationQueue.size,
      cachedDecisionsCount: decisionsById.size,
      userRevealedCount: userRevealedPostIds.size,
      inFlightCount: inFlightPostIds.size,
      inFlightElementCount: elementById.size,
      uptimeMs: Date.now() - performanceStats.startTime,
    };
  }
  
  // Simple non-cryptographic hash (djb2) for fallback fingerprinting
  function hashText(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return "t" + (hash >>> 0).toString(36);
  }
  
  // Track processed / paused video elements to prevent repeat full-subtree traversals
  const processedVideos = new WeakSet();
  
  /**
   * Helper to pause any active video playback within a hidden post container.
   * Uses WeakSet caching to avoid repeated calls on already-paused video elements.
   *
   * @param {Element|Object} container
   */
  function pauseVideosInContainer(container) {
    if (!container || typeof container.querySelectorAll !== "function") return;
    performanceStats.videoPauseTraversals++;
    try {
      const videos = container.querySelectorAll("video");
      performanceStats.querySelectorAllCalls++;
      for (const v of videos) {
        if (v && !processedVideos.has(v)) {
          processedVideos.add(v);
          if (typeof v.pause === "function" && !v.paused) {
            v.pause();
            performanceStats.videosPaused++;
          }
        }
      }
    } catch {}
  }
  
  function pauseSingleVideo(videoNode) {
    if (!videoNode || processedVideos.has(videoNode)) return;
    processedVideos.add(videoNode);
    try {
      if (typeof videoNode.pause === "function" && !videoNode.paused) {
        videoNode.pause();
        performanceStats.videosPaused++;
      }
    } catch {}
  }
  
  /**
   * Evaluates whether a DOM node is within the relevant LinkedIn feed scope.
   * Drops mutations from chat drawer, top navigation, sidebars, and ads in a single check.
   *
   * @param {Element|Object} node
   * @returns {boolean}
   */
  function isRelevantFeedScope(node) {
    if (!node || node.nodeType !== 1) return false;
  
    // Extension-injected UI is never an unclassified post container
    if (
      node.classList?.contains?.("feedrule-placeholder") ||
      node.classList?.contains?.("feedrule-show-btn")
    ) {
      return false;
    }
  
    // Reject non-feed regions (Messaging, Global Nav, Rail, Modals)
    if (node.closest?.(NON_FEED_ANCESTOR_SELECTOR)) {
      return false;
    }
  
    return true;
  }
  
  function isFeedContainerRoot(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(
      node.classList?.contains?.("scaffold-finite-scroll__content") ||
      node.classList?.contains?.("scaffold-finite-scroll") ||
      node.getAttribute?.("data-testid") === "mainFeed" ||
      node.classList?.contains?.("core-rail")
    );
  }
  
  /**
   * Extracts normalized post data from a LinkedIn post container.
   * Uses the dedicated extractAuthor helper as the single source of truth for author identity.
   *
   * @param {Element|Object} el
   * @returns {{ id: string, text: string, author: string, authorUrl: string, postUrl: string, el: Element|Object } | null}
   */
  function extractPost(el) {
    if (!el || typeof el.querySelector !== "function") return null;
  
    let text = "";
    for (const sel of TEXT_CANDIDATES) {
      const textEl = el.querySelector(sel);
      if (textEl?.innerText?.trim()) {
        text = textEl.innerText.trim();
        break;
      }
    }
    if (!text) text = (el.innerText || el.textContent || "").trim();
    text = text.slice(0, 4000);
  
    if (!text || text.length < 5) {
      return null; // ads/empty spacers etc.
    }
  
    // 1. Single Source of Truth: Coupled Author & Author Profile URL Extraction
    const { author, authorUrl } = extractAuthor(el);
  
    // 2. Post Permalink (Direct Header / Timestamp anchor)
    let postUrl = "";
    for (const sel of POST_LINK_CANDIDATES) {
      const linkEl = el.querySelector(sel);
      if (linkEl?.href) {
        postUrl = linkEl.href.split("?")[0];
        break;
      }
    }
  
    // 3. Stable 3-level Post ID Strategy
    // Level 1: Direct activity or UGC URN attribute on container or children
    let id =
      el.getAttribute?.("data-urn") ||
      el.getAttribute?.("data-id") ||
      el.querySelector?.("[data-urn*='activity:']")?.getAttribute?.("data-urn") ||
      el.querySelector?.("[data-urn*='ugcPost:']")?.getAttribute?.("data-urn") ||
      "";
  
    // Level 2: Extract verified URN from permalink if available
    if (!id && postUrl) {
      const urnMatch = postUrl.match(/urn:li:(?:activity|ugcPost):\d+/);
      if (urnMatch) id = urnMatch[0];
    }
  
    // Level 3: Deterministic fallback fingerprint (author + text snippet)
    if (!id) {
      id = hashText(`${author}::${text.slice(0, 500)}`);
    }
  
    // If postUrl was not found from anchors but container has a verified activity/ugcPost URN, construct canonical URL
    if (!postUrl && id && /^urn:li:(?:activity|ugcPost):\d+$/.test(id)) {
      postUrl = `https://www.linkedin.com/feed/update/${id}`;
    }
  
    return { id, text, author, authorUrl, postUrl, el };
  }
  
  /**
   * Finds candidate container elements with deduplication favoring canonical inner update nodes.
   * Optimized with fast-path return when root is already a resolved post container.
   *
   * @param {Element|Object} root
   * @returns {Array<Element|Object>}
   */
  function findContainers(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    performanceStats.findContainersCalls++;
  
    // Fast Path: If root is already a leaf post container, return immediately without subtree query
    if (
      root.classList?.contains?.("feed-shared-update-v2") &&
      root.getAttribute?.("role") !== "listitem"
    ) {
      return [root];
    }
  
    const rawCandidates = [];
    if (root.matches?.(COMBINED_CONTAINER_SELECTOR)) {
      rawCandidates.push(root);
    }
    const found = root.querySelectorAll(COMBINED_CONTAINER_SELECTOR) || [];
    performanceStats.querySelectorAllCalls++;
    for (const node of found) {
      rawCandidates.push(node);
    }
  
    // Deduplicate and filter out redundant outer wrappers when an inner canonical update exists
    const uniqueNodes = new Set();
    const canonicalNodes = [];
  
    for (const node of rawCandidates) {
      if (uniqueNodes.has(node)) continue;
      uniqueNodes.add(node);
  
      // If this is a generic listitem that wraps an inner .feed-shared-update-v2, prefer the inner container
      if (node.getAttribute?.("role") === "listitem" && !node.classList?.contains?.("feed-shared-update-v2")) {
        const innerUpdate = node.querySelector?.(".feed-shared-update-v2, [data-urn*='activity:']");
        if (innerUpdate) {
          if (!uniqueNodes.has(innerUpdate)) {
            uniqueNodes.add(innerUpdate);
            canonicalNodes.push(innerUpdate);
          }
          continue;
        }
      }
  
      canonicalNodes.push(node);
    }
  
    return canonicalNodes;
  }
  
  // --- DOM filtering & Bounded Caches ----------------------------------
  const MAX_CACHED_DECISIONS = 2000;
  const MAX_USER_REVEALED = 500;
  
  const decisionsById = new Map(); // postId -> decision object (bounded LRU)
  const userRevealedPostIds = new Set(); // postId user explicitly revealed via "Show anyway"
  
  function cacheDecision(postId, decision) {
    if (!postId || !decision) return;
    if (decisionsById.size >= MAX_CACHED_DECISIONS) {
      const oldestKey = decisionsById.keys().next().value;
      if (oldestKey) decisionsById.delete(oldestKey);
    }
    decisionsById.set(postId, decision);
  }
  
  function markPostUserRevealed(postId) {
    if (!postId) return;
    if (userRevealedPostIds.size >= MAX_USER_REVEALED) {
      const oldest = userRevealedPostIds.keys().next().value;
      if (oldest) userRevealedPostIds.delete(oldest);
    }
    userRevealedPostIds.add(postId);
  }
  
  function applyDecision(el, decision) {
    if (!el || !decision) return;
  
    cacheDecision(decision.id, decision);
    inFlightPostIds.delete(decision.id);
    elementById.delete(decision.id);
  
    // Stale selection protection: if el is currently bound to a different post, do not touch this element
    const currentPostOnNode = nodeToPostId.get(el);
    if (currentPostOnNode && currentPostOnNode !== decision.id) {
      return;
    }
  
    // If user previously clicked "Show anyway" on this post identity, preserve user reveal
    if (userRevealedPostIds.has(decision.id) || el.dataset?.feedruleUserRevealed === "1") {
      el.classList?.remove?.(HIDDEN_CLASS);
      el.removeAttribute?.("data-feedrule-hidden");
      if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
      return;
    }
  
    if (!decision.hide) {
      el.classList?.remove?.(HIDDEN_CLASS);
      el.removeAttribute?.("data-feedrule-hidden");
      if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
      if (el.dataset?.feedruleWrapped) {
        delete el.dataset.feedruleWrapped;
        const placeholder = el.querySelector?.(".feedrule-placeholder");
        if (placeholder?.remove) placeholder.remove();
      }
      return;
    }
  
    // Authoritative hidden state application
    el.classList?.add?.(HIDDEN_CLASS);
    el.setAttribute?.("data-feedrule-hidden", "true");
    if (el.dataset) el.dataset.feedruleHidden = "true";
  
    // Pause any autoplaying videos inside the hidden post
    pauseVideosInContainer(el);
  
    if (el.dataset?.feedruleWrapped && el.querySelector?.(".feedrule-placeholder")) return;
  
    if (typeof document !== "undefined") {
      if (el.dataset) el.dataset.feedruleWrapped = "1";
      let placeholder = el.querySelector?.(".feedrule-placeholder");
      if (!placeholder) {
        placeholder = document.createElement("div");
        placeholder.className = "feedrule-placeholder";
  
        const label = document.createElement("span");
        label.textContent = decision.reason
          ? `Hidden by your filter: ${decision.reason}`
          : "Hidden by your filter";
  
        const showBtn = document.createElement("button");
        showBtn.type = "button";
        showBtn.className = "feedrule-show-btn";
        showBtn.textContent = "Show anyway";
        if (showBtn.addEventListener) {
          showBtn.addEventListener("click", () => {
            markPostUserRevealed(decision.id);
            if (el.dataset) {
              el.dataset.feedruleUserRevealed = "1";
              delete el.dataset.feedruleHidden;
            }
            el.removeAttribute?.("data-feedrule-hidden");
            el.classList?.remove?.(HIDDEN_CLASS);
          });
        }
  
        placeholder.appendChild(label);
        placeholder.appendChild(showBtn);
        if (el.prepend) {
          el.prepend(placeholder);
        } else if (el.insertBefore && el.firstChild) {
          el.insertBefore(placeholder, el.firstChild);
        } else if (el.appendChild) {
          el.appendChild(placeholder);
        }
      }
    }
  }
  
  // --- Feed watcher & Request Queue --------------------------------------
  const elementById = new Map(); // postId -> Element (in-flight only, bounded to active batch)
  const nodeToPostId = new WeakMap(); // Element -> postId (tracks current post on this DOM node)
  const inFlightPostIds = new Set(); // postId currently queued in pending or batchQueue
  let pending = [];
  let flushTimer = null;
  const DEBOUNCE_MS = 600;
  const BATCH_SIZE = 8;
  
  const batchQueue = [];
  let isProcessingQueue = false;
  
  // Inspection helpers for unit/regression testing
  function getPendingPosts() { return [...pending]; }
  function getCachedDecisions() { return new Map(decisionsById); }
  function getInFlightPostIds() { return new Set(inFlightPostIds); }
  function getUserRevealedPostIds() { return new Set(userRevealedPostIds); }
  function getInFlightElementCount() { return elementById.size; }
  
  function resetContentState() {
    elementById.clear();
    decisionsById.clear();
    userRevealedPostIds.clear();
    inFlightPostIds.clear();
    pending = [];
    batchQueue.length = 0;
    isProcessingQueue = false;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = null;
    mutationQueue.clear();
    resetPerformanceStats();
  }
  
  function sendBatchMessage(batch, callback) {
    if (!batch || batch.length === 0) {
      callback();
      return;
    }
    performanceStats.classificationDispatches++;
    for (const post of batch) elementById.set(post.id, post.el);
  
    if (elementById.size > performanceStats.inFlightElementMaxSize) {
      performanceStats.inFlightElementMaxSize = elementById.size;
    }
  
    try {
      chrome.runtime.sendMessage(
        {
          type: "CLASSIFY_POSTS",
          posts: batch.map((p) => ({
            id: p.id,
            text: p.text,
            author: p.author,
            authorUrl: p.authorUrl,
            postUrl: p.postUrl,
          })),
        },
        (response) => {
          if (chrome.runtime.lastError) {
            logger.warn(
              "CONTENT",
              "background message status:",
              chrome.runtime.lastError.message
            );
            for (const post of batch) {
              inFlightPostIds.delete(post.id);
              elementById.delete(post.id);
            }
            callback();
            return;
          }
          logger.debug("CONTENT", "got response from background:", response);
          const results = response?.results || [];
          for (const decision of results) {
            cacheDecision(decision.id, decision);
            inFlightPostIds.delete(decision.id);
  
            const el = elementById.get(decision.id);
            elementById.delete(decision.id); // Immediate release of DOM reference for garbage collection
  
            // Stale selection protection: verify DOM element has not been recycled for a different post
            if (el && nodeToPostId.get(el) === decision.id) {
              applyDecision(el, decision);
            }
          }
          callback();
        }
      );
    } catch (err) {
      logger.warn("CONTENT", "extension context disconnected:", err);
      for (const post of batch) {
        inFlightPostIds.delete(post.id);
        elementById.delete(post.id);
      }
      callback();
    }
  }
  
  async function processQueue() {
    if (isProcessingQueue || batchQueue.length === 0) return;
    isProcessingQueue = true;
  
    try {
      while (batchQueue.length > 0) {
        const nextBatch = batchQueue.shift();
        await new Promise((resolve) => {
          try {
            sendBatchMessage(nextBatch, resolve);
          } catch (sendErr) {
            logger.error("CONTENT", "sendBatchMessage failed:", sendErr);
            resolve();
          }
        });
      }
    } catch (err) {
      logger.error("CONTENT", "unexpected error in processQueue:", err);
    } finally {
      isProcessingQueue = false;
      if (batchQueue.length > 0) {
        setTimeout(processQueue, 0);
      }
    }
  }
  
  function flush() {
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      batchQueue.push(batch.slice(i, i + BATCH_SIZE));
    }
    processQueue();
  }
  
  /**
   * Scans a DOM root or subtree for candidate posts.
   * Utilizes identity-aware deduplication to support initial load, Load More, and container reuse.
   *
   * @param {Element|Object} root
   */
  function scan(root) {
    performanceStats.scanCalls++;
    const nodes = findContainers(root);
  
    if (isDebugEnabled()) {
      logger.debug(
        "CONTENT",
        `[SCAN] root=${root?.tagName || "UNKNOWN"} containersFound=${nodes.length}`
      );
    }
  
    for (const node of nodes) {
      // Two-Stage Post Qualification Layer
      const qual = isLikelyPostContainer(node);
  
      if (isDebugEnabled()) {
        const sigs = qual.signals || {};
        logger.debug(
          "CONTENT",
          `CANDIDATE\n` +
            `class=${node.getAttribute?.("class") || ""}\n` +
            `urn=${Boolean(sigs.urn)} permalink=${Boolean(sigs.permalink)} actor=${Boolean(sigs.actor)} text=${Boolean(sigs.text)} authorLink=${Boolean(sigs.authorLink)}\n` +
            `score=${qual.score} decision=${qual.decision} reason=${qual.reason}`
        );
      }
  
      if (qual.decision === "REJECT") {
        continue;
      }
  
      // Process ACCEPT and AMBIGUOUS candidates through extractPost
      const post = extractPost(node);
      if (!post) {
        if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
          logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> REJECTED (no valid text or ID extracted)`);
        }
        continue;
      }
  
      if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
        logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> ACCEPTED (${post.id})`);
      }
  
      const prevPostIdOnNode = nodeToPostId.get(node);
  
      // If node was previously used for a different post (DOM reuse), clean up previous state
      if (prevPostIdOnNode && prevPostIdOnNode !== post.id) {
        node.classList?.remove?.(HIDDEN_CLASS);
        node.removeAttribute?.("data-feedrule-hidden");
        if (node.dataset?.feedruleHidden) delete node.dataset.feedruleHidden;
        if (node.dataset?.feedruleWrapped) {
          delete node.dataset.feedruleWrapped;
          const oldPlaceholder = node.querySelector?.(".feedrule-placeholder");
          if (oldPlaceholder?.remove) oldPlaceholder.remove();
        }
        if (node.dataset?.feedruleUserRevealed) {
          delete node.dataset.feedruleUserRevealed;
        }
      }
  
      // Associate current post ID with this DOM node
      nodeToPostId.set(node, post.id);
  
      // 1. Check if we already have a cached classification decision for this post identity
      if (decisionsById.has(post.id)) {
        const cachedDecision = decisionsById.get(post.id);
        if (isDebugEnabled()) {
          logger.debug(
            "CONTENT",
            `[POST] id=${post.id} decision=${cachedDecision.hide ? "HIDE" : "SHOW"} alreadyProcessed=true (cached)`
          );
        }
        applyDecision(node, cachedDecision);
        continue;
      }
  
      // 2. Check if this post is already in-flight (queued in pending or batchQueue)
      if (inFlightPostIds.has(post.id)) {
        if (isDebugEnabled()) {
          logger.debug(
            "CONTENT",
            `[POST] id=${post.id} decision=PENDING alreadyProcessed=true (in-flight)`
          );
        }
        // Update element mapping in case node reference changed
        elementById.set(post.id, node);
        continue;
      }
  
      // 3. Genuinely new post identity: queue for classification
      if (isDebugEnabled()) {
        logger.debug("CONTENT", `[POST] id=${post.id} decision=UNPROCESSED alreadyProcessed=false`);
      }
  
      inFlightPostIds.add(post.id);
      elementById.set(post.id, node);
      pending.push(post);
    }
  }
  
  // --- Coalesced MutationObserver Processing ---------------------------
  let mutationTimer = null;
  const mutationQueue = new Set();
  const MUTATION_BUFFER_MS = 50;
  
  function processMutationQueue() {
    if (mutationQueue.size === 0) return;
  
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
    mutationQueue.clear();
  
    for (const root of rootsToScan) {
      scan(root);
    }
  
    if (pending.length > 0) {
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, DEBOUNCE_MS);
    }
  }
  
  /**
   * Centralized MutationObserver handler.
   * High-performance routed pipeline:
   * 1. Scope filter drops non-feed mutations (chat, nav, sidebars) immediately.
   * 2. Class mutations on hidden posts trigger synchronous presentation enforcement without queueing.
   * 3. Identity mutations (data-urn) trigger post container recycling / re-evaluation.
   * 4. Child additions queue only verified post containers or feed sections.
   *
   * @param {MutationRecord[]} mutations
   */
  function handleMutations(mutations) {
    performanceStats.mutationCallbacks++;
    let sawAdditions = false;
  
    for (const m of mutations || []) {
      const target = m.target;
      if (!target || target.nodeType !== 1) continue;
  
      // Fast Non-Feed Scope Filter (drops chat, nav, notifications in 1 check)
      if (!isRelevantFeedScope(target)) {
        performanceStats.ignoredMutations++;
        continue;
      }
  
      if (m.type === "attributes") {
        performanceStats.attributeMutations++;
        const attrName = m.attributeName;
  
        // Case A: Presentation Attribute (class)
        if (attrName === "class") {
          performanceStats.classMutations++;
          // Resolve enclosing container
          const enclosing = target.closest?.(COMBINED_CONTAINER_SELECTOR) || (target.matches?.(COMBINED_CONTAINER_SELECTOR) ? target : null);
          if (!enclosing) {
            performanceStats.ignoredMutations++;
            continue;
          }
  
          const currentPostId = nodeToPostId.get(enclosing);
          if (currentPostId && decisionsById.has(currentPostId)) {
            const decision = decisionsById.get(currentPostId);
            if (
              decision?.hide &&
              !userRevealedPostIds.has(currentPostId) &&
              enclosing.dataset?.feedruleUserRevealed !== "1"
            ) {
              // Synchronously re-assert hidden state if stripped by LinkedIn video playback
              if (!enclosing.classList?.contains?.(HIDDEN_CLASS)) {
                enclosing.classList?.add?.(HIDDEN_CLASS);
              }
              if (enclosing.getAttribute?.("data-feedrule-hidden") !== "true") {
                enclosing.setAttribute?.("data-feedrule-hidden", "true");
              }
              pauseVideosInContainer(enclosing);
            }
            // Class mutation on an already-classified post never triggers a scan
            performanceStats.ignoredMutations++;
            continue;
          }
  
          // Class mutations on unclassified nodes do not trigger scans
          performanceStats.ignoredMutations++;
          continue;
        }
  
        // Case B: Identity Attributes (data-urn, data-id, data-chameleon-urn)
        if (attrName === "data-urn" || attrName === "data-id" || attrName === "data-chameleon-urn") {
          performanceStats.identityMutations++;
          const enclosing = target.closest?.(COMBINED_CONTAINER_SELECTOR) || target;
          if (enclosing) {
            mutationQueue.add(enclosing);
            sawAdditions = true;
            performanceStats.relevantMutations++;
          }
          continue;
        }
  
        performanceStats.ignoredMutations++;
        continue;
      }
  
      // Case C: ChildList Mutations
      if (m.type === "childList") {
        performanceStats.childListMutations++;
        for (const node of m.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue;
  
          if (!isRelevantFeedScope(node)) {
            performanceStats.ignoredMutations++;
            continue;
          }
  
          // Check if added node is inside an existing post container
          const enclosing = node.closest?.(COMBINED_CONTAINER_SELECTOR);
          if (enclosing) {
            const currentPostId = nodeToPostId.get(enclosing);
            if (currentPostId && decisionsById.has(currentPostId)) {
              const decision = decisionsById.get(currentPostId);
              if (
                decision?.hide &&
                !userRevealedPostIds.has(currentPostId) &&
                enclosing.dataset?.feedruleUserRevealed !== "1"
              ) {
                // Synchronously maintain hidden attributes
                if (!enclosing.classList?.contains?.(HIDDEN_CLASS)) {
                  enclosing.classList?.add?.(HIDDEN_CLASS);
                }
                if (enclosing.getAttribute?.("data-feedrule-hidden") !== "true") {
                  enclosing.setAttribute?.("data-feedrule-hidden", "true");
                }
                // If added node is or contains video, pause directly
                if (node.tagName === "VIDEO") {
                  pauseSingleVideo(node);
                } else {
                  pauseVideosInContainer(node);
                }
                performanceStats.ignoredMutations++;
                continue; // Do NOT queue already-hidden post
              }
            }
            // Unclassified enclosing post container
            mutationQueue.add(enclosing);
            sawAdditions = true;
            performanceStats.relevantMutations++;
            continue;
          }
  
          // Node is NOT inside an existing post container. Is it a post container candidate or feed root?
          if (node.matches?.(COMBINED_CONTAINER_SELECTOR) || isFeedContainerRoot(node)) {
            mutationQueue.add(node);
            sawAdditions = true;
            performanceStats.relevantMutations++;
          } else {
            // Check if it contains candidate post containers
            const hasPosts = node.querySelector?.(COMBINED_CONTAINER_SELECTOR);
            if (hasPosts) {
              mutationQueue.add(node);
              sawAdditions = true;
              performanceStats.relevantMutations++;
            } else {
              performanceStats.ignoredMutations++;
            }
          }
        }
      }
    }
  
    if (mutationQueue.size > performanceStats.mutationQueueMaxSize) {
      performanceStats.mutationQueueMaxSize = mutationQueue.size;
    }
  
    if (sawAdditions) {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(processMutationQueue, MUTATION_BUFFER_MS);
    }
  }
  
  if (typeof document !== "undefined") {
    logger.debug("CONTENT", "running initial scan...");
    scan(document.body);
    logger.debug("CONTENT", `initial scan found ${pending.length} post(s) pending`);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 0);
  
    // Dynamic feed root resolution: attach to feed root if available, otherwise document.body
    const feedRoot =
      document.querySelector("main.scaffold-layout__main") ||
      document.querySelector("div[data-testid='mainFeed']") ||
      document.querySelector(".scaffold-finite-scroll") ||
      document.body;
  
    const observer = new MutationObserver(handleMutations);
  
    observer.observe(feedRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-urn", "data-id", "data-chameleon-urn", "class"],
    });
    logger.debug("CONTENT", "MutationObserver attached with scoped feed filter and enclosing-container resolution");
  }
})();
