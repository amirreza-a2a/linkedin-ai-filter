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

export const ACCEPT_THRESHOLD = 40;
export const AMBIGUOUS_THRESHOLD = 15;

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
export function isLikelyPostContainer(el) {
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

  // 5. Feed controls ("Sort by", "New posts", "Load more" pills/buttons)
  const textRaw = (el.innerText || el.textContent || "").trim().toLowerCase();
  if (
    textRaw.startsWith("sort by:") ||
    textRaw === "sort by" ||
    textRaw === "new posts" ||
    textRaw === "load more" ||
    textRaw === "show more results"
  ) {
    return {
      qualified: false,
      decision: "REJECT",
      score: 0,
      signals: { controls: true },
      reason: "feed-control-ui",
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

  const hasLazyMount = Boolean(
    el.getAttribute?.("data-lazy-mount-id") || el.querySelector?.("[data-lazy-mount-id]")
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
  if (hasLazyMount) score += 25;
  if (hasTimestamp) score += 20;
  if (hasControlMenu) score += 20;
  if (hasAuthorLink) score += 15;
  if (hasSocialActions) score += 10;

  const signals = {
    urn: hasValidPostUrn,
    permalink: hasPostPermalink,
    updateClass: hasUpdateClass,
    actor: hasActorStructure,
    lazyMount: hasLazyMount,
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
