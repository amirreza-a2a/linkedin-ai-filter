// src/storage/data-management.js
// Centralized storage management & reset routines for FeedRule local data.

import { withSerializedMutation } from "./saved-posts-store.js";

/**
 * Clears the Second Brain (savedPosts) from local storage.
 * Uses serialized mutation lock to prevent race conditions with in-flight saves.
 *
 * @returns {Promise<void>}
 */
export async function clearSavedPostsData() {
  return withSerializedMutation(async () => {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      await chrome.storage.local.remove("savedPosts");
    }
  });
}

/**
 * Clears the historical classification decision log from local storage.
 *
 * @returns {Promise<void>}
 */
export async function clearDecisionLogData() {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    await chrome.storage.local.remove("decisionLog");
  }
}

/**
 * Enumerates all keys in chrome.storage.local and removes only keys starting with "cache:".
 * Preserves settings, API keys, saved posts, decision logs, and any other local data.
 *
 * @returns {Promise<number>} Number of removed cache keys
 */
export async function clearClassificationCache() {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all || {}).filter((k) => k.startsWith("cache:"));
    if (cacheKeys.length > 0) {
      await chrome.storage.local.remove(cacheKeys);
    }
    return cacheKeys.length;
  }
  return 0;
}

/**
 * Full FeedRule extension-local reset.
 * Clears all local data stored in chrome.storage.local, including:
 * - API keys
 * - daily usage state
 * - classification cache
 * - decision log
 * - Second Brain / saved posts
 * - any other extension-local data
 *
 * @returns {Promise<void>}
 */
export async function clearAllLocalData() {
  return withSerializedMutation(async () => {
    if (typeof chrome !== "undefined" && chrome?.storage?.local) {
      await chrome.storage.local.clear();
    }
  });
}
