// src/content/post-qualifier.js
// Deterministic Post Container Qualification Layer for LinkedIn DOM.
// Strictly discriminates between genuine feed posts and non-post UI widgets
// (composers, recommendation carousels, comment lists, action bars).

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

/**
 * Checks if a candidate DOM element is a genuine LinkedIn feed post.
 * Returns { qualified: boolean, reason: string }.
 *
 * CRITICAL INVARIANTS:
 * 1. role="listitem" alone NEVER qualifies an element.
 * 2. False positives are worse than false negatives.
 * 3. Non-post widgets ("Start a post", "Recommended for you", comments lists) are immediately rejected.
 *
 * @param {Element|Object} el
 * @returns {{ qualified: boolean, reason: string }}
 */
export function isLikelyPostContainer(el) {
  if (!el || typeof el.querySelector !== "function") {
    return { qualified: false, reason: "invalid-element" };
  }

  // --- HARD REJECTIONS (Negative Signals) ---

  // 1. "Start a post" / Composer UI
  for (const sel of DISQUALIFIED_COMPOSER_SELECTORS) {
    if (el.matches?.(sel) || el.classList?.contains?.(sel.replace(/^\./, "")) || el.querySelector?.(sel)) {
      return { qualified: false, reason: "composer-detected" };
    }
  }

  // 2. "Recommended for you" / Follow recommendation carousels / PYMK lists
  for (const sel of DISQUALIFIED_RECS_SELECTORS) {
    if (el.matches?.(sel) || el.classList?.contains?.(sel.replace(/^\./, "")) || el.querySelector?.(sel)) {
      return { qualified: false, reason: "recommendation-card" };
    }
  }

  // Multiple entity cards / multiple follow buttons with no post text
  const followButtons = el.querySelectorAll?.("button[aria-label*='Follow'], .feed-shared-actor-recommendation button");
  const profileLinks = el.querySelectorAll?.("a[href*='/in/'], a[href*='/company/']");
  if (followButtons?.length >= 3 && profileLinks?.length >= 3) {
    const hasPostText = Boolean(
      el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description")
    );
    if (!hasPostText) {
      return { qualified: false, reason: "recommendation-card" };
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
      el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description")
    );
    if (!hasPostText) {
      return { qualified: false, reason: "recommendation-card" };
    }
  }

  // 3. Comments-only container
  if (
    el.classList?.contains?.("comments-comments-list") ||
    el.classList?.contains?.("comments-comment-item") ||
    (el.querySelector?.(".comments-comment-item") && !el.querySelector?.(".update-components-actor, .feed-shared-actor"))
  ) {
    return { qualified: false, reason: "comments-container" };
  }

  // 4. Social-action-only containers / Navigation widgets
  if (
    el.classList?.contains?.("feed-shared-social-actions") ||
    el.classList?.contains?.("feed-shared-social-action-bar")
  ) {
    return { qualified: false, reason: "social-action-only" };
  }

  // --- POSITIVE QUALIFICATION SIGNALS ---

  // Signal 1: Valid Post Activity / UGC / Update URN on container or direct child
  const urn =
    el.getAttribute?.("data-urn") ||
    el.getAttribute?.("data-id") ||
    el.querySelector?.("[data-urn*='activity:'], [data-urn*='ugcPost:']")?.getAttribute?.("data-urn") ||
    "";

  const hasValidPostUrn = /^urn:li:(?:activity|ugcPost|sponsoredUpdate):\d+$/i.test(urn);

  // Signal 2: Verified LinkedIn Post Permalink
  const hasPostPermalink = Boolean(
    el.querySelector?.("a[href*='/feed/update/urn:li:activity:'], a[href*='/feed/update/urn:li:ugcPost:'], a[href*='/posts/']")
  );

  // Signal 3: Recognizable Actor Header + Post Text Container
  const hasActorStructure = Boolean(
    el.querySelector?.(".update-components-actor, .feed-shared-actor, [data-testid='actor-container']")
  );

  const hasPostTextStructure = Boolean(
    el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text")
  );

  // Signal 4: Update class
  const hasUpdateClass =
    el.classList?.contains?.("feed-shared-update-v2") ||
    Boolean(el.querySelector?.(".feed-shared-update-v2"));

  // --- QUALIFICATION DECISION MATRIX ---

  // Tier 1: Definite Post (Valid URN or Permalink + (Actor or Post Text))
  if ((hasValidPostUrn || hasPostPermalink) && (hasActorStructure || hasPostTextStructure || hasUpdateClass)) {
    return { qualified: true, reason: "activity-urn-and-content" };
  }

  // Tier 2: Standard LinkedIn Post structure without explicit URN attribute (e.g. dynamic rendered feed card)
  if (hasUpdateClass && hasActorStructure && hasPostTextStructure) {
    return { qualified: true, reason: "standard-update-structure" };
  }

  // Tier 3: Actor + Post Text + Valid Author Link (Fallback for customized/A-B test post cards)
  const hasAuthorLink = Boolean(
    el.querySelector?.("a[href*='/in/'], a[href*='/company/'], a[href*='/school/'], a[href*='/showcase/']")
  );
  if (hasActorStructure && hasPostTextStructure && hasAuthorLink) {
    return { qualified: true, reason: "actor-text-author-structure" };
  }

  // Insufficient evidence: reject bare listitems or ambiguous UI blocks
  return { qualified: false, reason: "no-credible-post-identity" };
}
