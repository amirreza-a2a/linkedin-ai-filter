// src/storage/data-management.js
// Centralized storage management & reset routines for FeedRule local data.

import { withSerializedMutation } from "./saved-posts-store.js";
import { browserApi } from "../utils/browser.js";

/**
 * Clears the Second Brain (savedPosts) from local storage.
 * Uses serialized mutation lock to prevent race conditions with in-flight saves.
 *
 * @returns {Promise<void>}
 */
export async function clearSavedPostsData() {
  return withSerializedMutation(async () => {
    if (browserApi?.storage?.local) {
      await browserApi.storage.local.remove("savedPosts");
    }
  });
}

/**
 * Clears the historical classification decision log from local storage.
 *
 * @returns {Promise<void>}
 */
export async function clearDecisionLogData() {
  if (browserApi?.storage?.local) {
    await browserApi.storage.local.remove("decisionLog");
  }
}

/**
 * Clears the persistent API request logs from local storage.
 *
 * @returns {Promise<void>}
 */
export async function clearApiLogsData() {
  if (browserApi?.storage?.local) {
    await browserApi.storage.local.remove("apiLogs");
  }
}

/**
 * Enumerates all keys in local storage and removes only keys starting with "cache:".
 * Preserves settings, API keys, saved posts, decision logs, and any other local data.
 *
 * @returns {Promise<number>} Number of removed cache keys
 */
export async function clearClassificationCache() {
  if (browserApi?.storage?.local) {
    const all = await browserApi.storage.local.get(null);
    const cacheKeys = Object.keys(all || {}).filter((k) => k.startsWith("cache:"));
    if (cacheKeys.length > 0) {
      await browserApi.storage.local.remove(cacheKeys);
    }
    return cacheKeys.length;
  }
  return 0;
}

/**
 * Full FeedRule extension-local reset.
 * Clears all local data stored in local storage, including:
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
    if (browserApi?.storage?.local) {
      await browserApi.storage.local.clear();
    }
  });
}
