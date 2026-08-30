// src/storage/saved-posts-store.js
// Local persistence for the Second Brain (saved LinkedIn posts).
// Serializes storage mutations to guarantee race-free concurrent updates.

import { browserApi } from "../utils/browser.js";

const SAVED_POSTS_KEY = "savedPosts";
const MAX_TEXT_LENGTH = 4000;

// Global sequential mutation lock
let mutationQueue = Promise.resolve();

export function withSerializedMutation(operation) {
  const next = mutationQueue.then(() => operation());
  mutationQueue = next.catch(() => {}); // prevent chain breakage
  return next;
}

/**
 * Validates, sanitizes, and canonicalizes a URL.
 * - Allows only safe http: and https: protocols
 * - Strips query parameters and hash fragments (e.g. tracking params ?trk=...)
 * - Normalizes www. prefixes and trailing slashes
 * - Rejects javascript:, data:, file:, chrome:, or malformed URLs
 *
 * @param {string} rawUrl
 * @returns {string} Canonical URL or empty string
 */
export function sanitizeUrl(rawUrl) {
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

/**
 * Normalizes a raw saved post object into the canonical SavedPost schema:
 * - Enforces max 4000 characters for post text
 * - Validates and canonicalizes URLs (http/https only, tracking params stripped)
 * - Enforces strict boolean for autoSaved (only === true is true)
 *
 * @param {Object} raw
 * @returns {Object} Canonical SavedPost
 */
export function sanitizeSavedPost(raw) {
  const now = Date.now();
  return {
    id: String(raw.id || "").trim(),
    text: String(raw.text || "").trim().slice(0, MAX_TEXT_LENGTH),
    author: String(raw.author || "").trim(),
    authorUrl: sanitizeUrl(raw.authorUrl),
    postUrl: sanitizeUrl(raw.postUrl),
    topics: Array.isArray(raw.topics) ? raw.topics.filter((t) => typeof t === "string") : [],
    savedAt: typeof raw.savedAt === "number" && !isNaN(raw.savedAt) ? raw.savedAt : now,
    updatedAt: typeof raw.updatedAt === "number" && !isNaN(raw.updatedAt) ? raw.updatedAt : now,
    saveReason: String(raw.saveReason || "").trim(),
    autoSaved: raw.autoSaved === true,
  };
}

function areTopicsEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  const setA = new Set(a.map((t) => t.toLowerCase()));
  for (const t of b) {
    if (!setA.has(t.toLowerCase())) return false;
  }
  return true;
}

function isPostUnchanged(existing, incoming) {
  return (
    existing.text === incoming.text &&
    existing.author === incoming.author &&
    existing.authorUrl === incoming.authorUrl &&
    existing.postUrl === incoming.postUrl &&
    existing.autoSaved === incoming.autoSaved &&
    existing.saveReason === incoming.saveReason &&
    areTopicsEqual(existing.topics, incoming.topics)
  );
}

/**
 * Saves or updates a single post in the Second Brain.
 *
 * @param {Object} postData
 * @returns {Promise<Object>} Saved post
 */
export async function savePost(postData) {
  const results = await savePostsBatch([postData]);
  return results[0];
}

/**
 * Batch saves multiple posts with deduplication and serialized locking.
 *
 * @param {Object[]} postsArray
 * @returns {Promise<Object[]>} Array of saved posts
 */
export async function savePostsBatch(postsArray) {
  if (!Array.isArray(postsArray) || postsArray.length === 0) {
    return [];
  }

  return withSerializedMutation(async () => {
    const localStore = browserApi?.storage?.local;
    if (!localStore) return [];

    const { [SAVED_POSTS_KEY]: store = {} } = await localStore.get([SAVED_POSTS_KEY]);
    let hasChanges = false;
    const savedResults = [];

    const now = Date.now();

    for (const raw of postsArray) {
      if (!raw || !raw.id) continue;
      const sanitized = sanitizeSavedPost(raw);
      const existing = store[sanitized.id];

      if (existing) {
        // If the post was already manually saved, an automatic re-scan must not downgrade autoSaved to true
        let resolvedAutoSaved = sanitized.autoSaved;
        if (existing.autoSaved === false && sanitized.autoSaved === true) {
          resolvedAutoSaved = false;
        }

        const candidate = {
          ...sanitized,
          savedAt: existing.savedAt, // preserve original savedAt
          autoSaved: resolvedAutoSaved,
          saveReason:
            existing.autoSaved === false && sanitized.autoSaved === true
              ? existing.saveReason
              : sanitized.saveReason || existing.saveReason,
        };

        if (isPostUnchanged(existing, candidate)) {
          savedResults.push(existing);
          continue;
        }

        // Relevant fields changed -> update with new updatedAt
        const updated = {
          ...candidate,
          updatedAt: now,
        };
        store[sanitized.id] = updated;
        savedResults.push(updated);
        hasChanges = true;
      } else {
        // New post
        const created = {
          ...sanitized,
          savedAt: sanitized.savedAt || now,
          updatedAt: sanitized.savedAt || now,
        };
        store[sanitized.id] = created;
        savedResults.push(created);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await localStore.set({ [SAVED_POSTS_KEY]: store });
    }

    return savedResults;
  });
}

/**
 * Removes a post from the Second Brain.
 *
 * @param {string} postId
 * @returns {Promise<boolean>} True if removed
 */
export async function unsavePost(postId) {
  if (!postId) return false;
  return withSerializedMutation(async () => {
    const localStore = browserApi?.storage?.local;
    if (!localStore) return false;

    const { [SAVED_POSTS_KEY]: store = {} } = await localStore.get([SAVED_POSTS_KEY]);
    if (store[postId]) {
      delete store[postId];
      await localStore.set({ [SAVED_POSTS_KEY]: store });
      return true;
    }
    return false;
  });
}

/**
 * Retrieves all saved posts, sorted descending by savedAt (newest first).
 * Supports optional topic and search filtering.
 *
 * @param {Object} [filter]
 * @param {string} [filter.topic]
 * @param {string} [filter.search]
 * @returns {Promise<Object[]>}
 */
export async function getSavedPosts(filter = {}) {
  const localStore = browserApi?.storage?.local;
  if (!localStore) return [];

  const { [SAVED_POSTS_KEY]: store = {} } = await localStore.get([SAVED_POSTS_KEY]);

  const allPosts = Object.values(store)
    .map(sanitizeSavedPost)
    .sort((a, b) => b.savedAt - a.savedAt);

  const topicFilter = (filter.topic || "").trim().toLowerCase();
  const searchFilter = (filter.search || "").trim().toLowerCase();

  return allPosts.filter((post) => {
    if (topicFilter) {
      const hasTopic = post.topics.some((t) => t.toLowerCase() === topicFilter);
      if (!hasTopic) return false;
    }
    if (searchFilter) {
      const matchText = post.text.toLowerCase().includes(searchFilter);
      const matchAuthor = post.author.toLowerCase().includes(searchFilter);
      const matchReason = post.saveReason.toLowerCase().includes(searchFilter);
      if (!matchText && !matchAuthor && !matchReason) return false;
    }
    return true;
  });
}

export async function isPostSaved(postId) {
  if (!postId) return false;
  const localStore = browserApi?.storage?.local;
  if (!localStore) return false;

  const { [SAVED_POSTS_KEY]: store = {} } = await localStore.get([SAVED_POSTS_KEY]);
  return Boolean(store[postId]);
}

export async function clearSavedPosts() {
  return withSerializedMutation(async () => {
    const localStore = browserApi?.storage?.local;
    if (localStore) {
      await localStore.remove([SAVED_POSTS_KEY]);
    }
  });
}
