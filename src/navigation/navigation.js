// src/navigation/navigation.js
import { browserApi, getExtensionUrl } from "../utils/browser.js";
import { logger } from "../utils/logger.js";

export const PAGE_PATHS = {
  dashboard: "src/dashboard/dashboard.html",
  saved: "src/saved/saved.html",
  brain: "src/saved/saved.html",
  graph: "src/graph/graph.html",
  options: "src/options/options.html",
};

// Strict allowlist mapping of supported page keys, canonical paths, and known aliases
const STRICT_CANONICAL_MAP = {
  // Canonical keys
  dashboard: "src/dashboard/dashboard.html",
  saved: "src/saved/saved.html",
  brain: "src/saved/saved.html",
  graph: "src/graph/graph.html",
  options: "src/options/options.html",

  // Canonical paths
  "src/dashboard/dashboard.html": "src/dashboard/dashboard.html",
  "src/saved/saved.html": "src/saved/saved.html",
  "src/graph/graph.html": "src/graph/graph.html",
  "src/options/options.html": "src/options/options.html",

  // Root-relative aliases
  "/src/dashboard/dashboard.html": "src/dashboard/dashboard.html",
  "/src/saved/saved.html": "src/saved/saved.html",
  "/src/graph/graph.html": "src/graph/graph.html",
  "/src/options/options.html": "src/options/options.html",

  // Filename aliases
  "dashboard.html": "src/dashboard/dashboard.html",
  "saved.html": "src/saved/saved.html",
  "graph.html": "src/graph/graph.html",
  "options.html": "src/options/options.html",

  // Relative directory aliases
  "../dashboard/dashboard.html": "src/dashboard/dashboard.html",
  "../saved/saved.html": "src/saved/saved.html",
  "../graph/graph.html": "src/graph/graph.html",
  "../options/options.html": "src/options/options.html",
};

// Per-page in-flight navigation promises to coalesce concurrent clicks for the same page
const inFlightNavigations = new Map();

/**
 * Normalizes a page key or path to its canonical relative extension path using a strict allowlist.
 * Scheme-agnostic: handles chrome-extension://, moz-extension://, relative, and root paths.
 * Returns "" for unknown or invalid inputs to prevent constructing arbitrary/malformed URLs.
 *
 * @param {string} pageKeyOrPath
 * @returns {string} Canonical relative path (e.g. "src/graph/graph.html") or ""
 */
export function getCanonicalRelativePath(pageKeyOrPath) {
  if (!pageKeyOrPath || typeof pageKeyOrPath !== "string") return "";

  let clean = pageKeyOrPath.trim().toLowerCase();

  // Strip extension scheme and origin (e.g. chrome-extension://<id>/ or moz-extension://<uuid>/)
  clean = clean.replace(/^[a-z0-9-]+:\/\/[^/]+\//i, "");

  // Strip query parameters and hash fragments
  clean = clean.split("?")[0].split("#")[0].trim();

  // 1. Direct lookup in strict canonical map
  if (STRICT_CANONICAL_MAP[clean]) {
    return STRICT_CANONICAL_MAP[clean];
  }

  // 2. Strip leading slashes / dots and check again
  const stripped = clean.replace(/^[./]+/, "");
  if (STRICT_CANONICAL_MAP[stripped]) {
    return STRICT_CANONICAL_MAP[stripped];
  }

  // Unknown or invalid page input -> return empty string (reject)
  return "";
}

/**
 * Checks whether a URL or path is an internal FeedRule extension page.
 *
 * @param {string} urlOrPath
 * @returns {boolean}
 */
export function isInternalExtensionUrl(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== "string") return false;
  const str = urlOrPath.trim();
  if (/^https?:\/\//i.test(str)) {
    return false; // External web URLs (LinkedIn, docs, GitHub, etc.)
  }
  const rel = getCanonicalRelativePath(str);
  return Boolean(rel && Object.values(PAGE_PATHS).includes(rel));
}

/**
 * Returns the normalized pathname of an extension URL, stripping origin, query, and hash.
 *
 * @param {string} urlOrPath
 * @returns {string} Normalized pathname (e.g. "src/dashboard/dashboard.html") or ""
 */
export function normalizeExtensionPathname(urlOrPath) {
  return getCanonicalRelativePath(urlOrPath);
}

/**
 * Resolves the full canonical extension URL for a given page key or path across all browsers.
 *
 * @param {string} pageKeyOrPath
 * @returns {string} Full extension URL or "" if invalid
 */
export function getCanonicalExtensionUrl(pageKeyOrPath) {
  const relPath = getCanonicalRelativePath(pageKeyOrPath);
  if (!relPath) return "";
  return getExtensionUrl(relPath);
}

/**
 * Opens or activates a singleton FeedRule extension page.
 *
 * BEHAVIOR:
 * 1. Resolves canonical page identity.
 * 2. Checks for existing tab matching the canonical pathname (ignoring query/hash).
 * 3. If already active: returns without redundant update.
 * 4. If open in background/other window: activates tab and focuses window.
 * 5. If not open (or stale ID): creates exactly 1 new tab.
 * 6. Coalesces rapid concurrent clicks for the same page via per-page in-flight mutex.
 *
 * @param {string} pageKeyOrPath - Page key ("dashboard", "graph", "saved", "options") or path
 * @returns {Promise<Object|null>} Resolved tab object
 */
export async function openExtensionPage(pageKeyOrPath) {
  logger.debug("NAV", `requested page: ${pageKeyOrPath}`);

  // Never intercept external web URLs
  if (typeof pageKeyOrPath === "string" && /^https?:\/\//i.test(pageKeyOrPath.trim())) {
    const extUrl = pageKeyOrPath.trim();
    logger.debug("NAV", `external URL detected, opening in new tab: ${extUrl}`);
    if (browserApi?.tabs?.create) {
      return browserApi.tabs.create({ url: extUrl });
    }
    return null;
  }

  const relPath = getCanonicalRelativePath(pageKeyOrPath);
  logger.debug("NAV", `canonical relative path: ${relPath}`);

  if (!relPath) {
    logger.warn("NAV", `Rejected unknown internal page key/path: "${pageKeyOrPath}"`);
    return null;
  }

  const canonicalUrl = getCanonicalExtensionUrl(pageKeyOrPath);
  const canonicalPathname = normalizeExtensionPathname(relPath);
  logger.debug("NAV", `canonical extension URL: ${canonicalUrl}`);
  logger.debug("NAV", `normalized pathname: ${canonicalPathname}`);

  // Per-page in-flight mutex: coalesce rapid clicks for the SAME page without blocking other pages
  if (inFlightNavigations.has(canonicalPathname)) {
    logger.debug("NAV", `in-flight navigation exists for ${canonicalPathname}, coalescing`);
    return inFlightNavigations.get(canonicalPathname);
  }

  const navPromise = (async () => {
    try {
      if (!browserApi?.tabs) {
        return null;
      }

      // Query for existing open tabs matching the exact extension URL
      let matchingTabs = [];
      try {
        matchingTabs = await browserApi.tabs.query({ url: canonicalUrl });
      } catch (err) {
        logger.warn("NAV", "tabs.query by URL pattern failed:", err);
      }

      // Fallback query to match tabs that might have query params, hash fragments, or pendingUrl
      if (!matchingTabs || matchingTabs.length === 0) {
        try {
          const allTabs = await browserApi.tabs.query({});
          matchingTabs = (allTabs || []).filter((tab) => {
            const rawUrl = tab.url || tab.pendingUrl || "";
            if (!rawUrl) return false;
            return normalizeExtensionPathname(rawUrl) === canonicalPathname;
          });
        } catch (err) {
          logger.warn("NAV", "allTabs query failed:", err);
        }
      }

      logger.debug("NAV", `existing tabs found:`, matchingTabs ? matchingTabs.length : 0);

      if (matchingTabs && matchingTabs.length > 0) {
        const existingTab = matchingTabs[0];

        // Current-Tab Optimization: If this page is already active, avoid redundant tabs.update()
        if (existingTab.active) {
          logger.debug("NAV", `tab ${existingTab.id} is already active, focusing window`);
          if (existingTab.windowId && browserApi.windows?.update) {
            try {
              await browserApi.windows.update(existingTab.windowId, { focused: true });
            } catch {
              // ignore window focus error
            }
          }
          return existingTab;
        }

        try {
          logger.debug("NAV", `reusing tab ${existingTab.id}`);
          await browserApi.tabs.update(existingTab.id, { active: true });
          if (existingTab.windowId && browserApi.windows?.update) {
            try {
              await browserApi.windows.update(existingTab.windowId, { focused: true });
            } catch {
              // ignore window focus error
            }
          }
          return existingTab;
        } catch (updateErr) {
          logger.warn("NAV", "Stale tab ID on update, falling back to create:", updateErr);
        }
      }

      // No existing tab -> create exactly one new tab
      logger.debug("NAV", `creating tab: ${canonicalUrl}`);
      return await browserApi.tabs.create({ url: canonicalUrl });
    } finally {
      inFlightNavigations.delete(canonicalPathname);
    }
  })();

  inFlightNavigations.set(canonicalPathname, navPromise);
  return navPromise;
}
