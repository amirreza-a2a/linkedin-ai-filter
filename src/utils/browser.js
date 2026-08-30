// src/utils/browser.js
// Cross-browser WebExtensions API abstraction layer for FeedRule.
// Dynamically routes calls to standard W3C WebExtensions API (`browser.*`) or Chromium (`chrome.*`).

/**
 * Dynamic cross-browser API proxy.
 * Resolves properties against `globalThis.browser` (Firefox / W3C standard) or `globalThis.chrome` (Chrome / Chromium).
 * Supports runtime mock injection in tests and seamless cross-browser execution.
 */
export const browserApi = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof globalThis.browser !== "undefined" && globalThis.browser && globalThis.browser[prop] !== undefined) {
        return globalThis.browser[prop];
      }
      if (typeof globalThis.chrome !== "undefined" && globalThis.chrome && globalThis.chrome[prop] !== undefined) {
        return globalThis.chrome[prop];
      }
      return undefined;
    },
    has(_target, prop) {
      return Boolean(
        (typeof globalThis.browser !== "undefined" && globalThis.browser && prop in globalThis.browser) ||
        (typeof globalThis.chrome !== "undefined" && globalThis.chrome && prop in globalThis.chrome)
      );
    },
    set(_target, prop, value) {
      if (typeof globalThis.browser !== "undefined" && globalThis.browser) {
        globalThis.browser[prop] = value;
        return true;
      }
      if (typeof globalThis.chrome !== "undefined" && globalThis.chrome) {
        globalThis.chrome[prop] = value;
        return true;
      }
      return false;
    },
  }
);

/**
 * Returns true if running in a Mozilla Firefox extension environment.
 *
 * @returns {boolean}
 */
export function isFirefox() {
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    if (navigator.userAgent.includes("Firefox") || navigator.userAgent.includes("Gecko/")) {
      return true;
    }
  }
  return typeof globalThis.browser !== "undefined" && Boolean(globalThis.browser?.runtime?.getBrowserInfo);
}

/**
 * Returns the fully resolved extension URL for a given relative path.
 * Scheme-agnostic: uses `browserApi.runtime.getURL` whenever available.
 *
 * @param {string} relPath
 * @returns {string} Full extension URL (e.g. "chrome-extension://.../..." or "moz-extension://.../...")
 */
export function getExtensionUrl(relPath) {
  const clean = String(relPath || "").replace(/^\/+/, "");
  if (!clean) return "";
  if (browserApi?.runtime?.getURL) {
    return browserApi.runtime.getURL(clean);
  }
  return `chrome-extension://feedrule/${clean}`;
}
