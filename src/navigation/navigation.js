// src/navigation/navigation.js
// Centralized, race-safe singleton navigation controller for FeedRule extension pages.
// Ensures each internal page (Dashboard, Second Brain, Knowledge Graph, Options)
// is opened in at most 1 tab per session, activating existing tabs without recreation.

export const PAGE_PATHS = {
  dashboard: "src/dashboard/dashboard.html",
  saved: "src/saved/saved.html",
  brain: "src/saved/saved.html",
  graph: "src/graph/graph.html",
  options: "src/options/options.html",
};

// Per-page in-flight navigation promises to coalesce concurrent clicks for the same page
const inFlightNavigations = new Map();

/**
 * Normalizes a page key or path to its canonical relative extension path.
 *
 * @param {string} pageKeyOrPath
 * @returns {string} Relative path (e.g. "src/dashboard/dashboard.html")
 */
export function getCanonicalRelativePath(pageKeyOrPath) {
  if (!pageKeyOrPath || typeof pageKeyOrPath !== "string") return "";
  const key = pageKeyOrPath.trim().toLowerCase();
  if (PAGE_PATHS[key]) {
    return PAGE_PATHS[key];
  }
  // Strip leading slash, query parameters, and hash fragments
  let clean = pageKeyOrPath.trim().replace(/^\//, "").split("?")[0].split("#")[0];
  // Handle relative prefix if passed as "dashboard.html" or "./dashboard.html"
  for (const knownPath of Object.values(PAGE_PATHS)) {
    if (knownPath.endsWith(clean) || clean.endsWith(knownPath)) {
      return knownPath;
    }
  }
  return clean;
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
  if (str.startsWith("chrome-extension://")) {
    return Object.values(PAGE_PATHS).some((p) => str.includes(p));
  }
  const rel = getCanonicalRelativePath(str);
  return Object.values(PAGE_PATHS).includes(rel);
}

/**
 * Returns the normalized pathname of an extension URL, stripping origin, query, and hash.
 *
 * @param {string} urlOrPath
 * @returns {string} Normalized pathname (e.g. "src/dashboard/dashboard.html")
 */
export function normalizeExtensionPathname(urlOrPath) {
  if (!urlOrPath || typeof urlOrPath !== "string") return "";
  let clean = urlOrPath.trim();

  // If full chrome-extension:// URL, extract path after origin
  const extMatch = clean.match(/^chrome-extension:\/\/[a-z0-9_-]+\/(.*)$/i);
  if (extMatch && extMatch[1]) {
    clean = extMatch[1];
  }

  // Strip query and hash
  clean = clean.split("?")[0].split("#")[0].replace(/^\//, "");
  return getCanonicalRelativePath(clean);
}

/**
 * Resolves the full canonical chrome-extension:// URL for a given page key or path.
 *
 * @param {string} pageKeyOrPath
 * @returns {string} Full extension URL
 */
export function getCanonicalExtensionUrl(pageKeyOrPath) {
  const relPath = getCanonicalRelativePath(pageKeyOrPath);
  if (!relPath) return "";
  return typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL(relPath)
    : `chrome-extension://feedrule/${relPath}`;
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
  // Never intercept external web URLs
  if (typeof pageKeyOrPath === "string" && /^https?:\/\//i.test(pageKeyOrPath.trim())) {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      return chrome.tabs.create({ url: pageKeyOrPath.trim() });
    }
    return null;
  }

  const relPath = getCanonicalRelativePath(pageKeyOrPath);
  if (!relPath) return null;

  const canonicalUrl = getCanonicalExtensionUrl(pageKeyOrPath);
  const canonicalPathname = normalizeExtensionPathname(relPath);

  // Per-page in-flight mutex: coalesce rapid clicks for the SAME page without blocking other pages
  if (inFlightNavigations.has(canonicalPathname)) {
    return inFlightNavigations.get(canonicalPathname);
  }

  const navPromise = (async () => {
    try {
      if (typeof chrome === "undefined" || !chrome.tabs) {
        return null;
      }

      // Query for existing open tabs matching the exact extension URL
      let matchingTabs = [];
      try {
        matchingTabs = await chrome.tabs.query({ url: canonicalUrl });
      } catch {
        matchingTabs = [];
      }

      // Fallback query to match tabs that might have query params or hash fragments
      if (!matchingTabs || matchingTabs.length === 0) {
        try {
          const allTabs = await chrome.tabs.query({});
          matchingTabs = (allTabs || []).filter((tab) => {
            if (!tab.url) return false;
            return normalizeExtensionPathname(tab.url) === canonicalPathname;
          });
        } catch {
          // ignore
        }
      }

      if (matchingTabs && matchingTabs.length > 0) {
        const existingTab = matchingTabs[0];

        // Current-Tab Optimization: If this page is already active, avoid redundant tabs.update()
        if (existingTab.active) {
          if (existingTab.windowId && chrome.windows?.update) {
            try {
              await chrome.windows.update(existingTab.windowId, { focused: true });
            } catch {
              // ignore window focus error
            }
          }
          return existingTab;
        }

        try {
          // Activate tab and focus its window
          await chrome.tabs.update(existingTab.id, { active: true });
          if (existingTab.windowId && chrome.windows?.update) {
            try {
              await chrome.windows.update(existingTab.windowId, { focused: true });
            } catch {
              // ignore window focus error
            }
          }
          return existingTab;
        } catch (updateErr) {
          // Stale tab ID (tab was closed right as update was called) -> fall through to create
          console.warn("[FeedRule] Stale tab ID on update, falling back to create:", updateErr);
        }
      }

      // No existing tab -> create exactly one new tab
      return await chrome.tabs.create({ url: canonicalUrl });
    } finally {
      inFlightNavigations.delete(canonicalPathname);
    }
  })();

  inFlightNavigations.set(canonicalPathname, navPromise);
  return navPromise;
}
