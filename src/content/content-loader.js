// src/content/content-loader.js
// Dynamic module loader for Chrome MV3 content scripts.
// Allows content scripts to use standard ES modules (import/export).

(async () => {
  try {
    const src = chrome.runtime.getURL("src/content/content-index.js");
    await import(src);
  } catch (err) {
    console.error("[FeedRule] Failed to load content script module:", err);
  }
})();
