import test from "node:test";
import assert from "node:assert/strict";
import {
  clearSavedPostsData,
  clearDecisionLogData,
  clearClassificationCache,
  clearAllLocalData,
} from "../src/storage/data-management.js";
import { savePost, getSavedPosts } from "../src/storage/saved-posts-store.js";

// Mock chrome.storage.local for Node test environment
let mockLocalStorage = {};

globalThis.chrome = {
  storage: {
    local: {
      get: (keys) => {
        if (!keys) return Promise.resolve({ ...mockLocalStorage });
        if (typeof keys === "string") {
          return Promise.resolve({ [keys]: mockLocalStorage[keys] });
        }
        if (Array.isArray(keys)) {
          const res = {};
          for (const k of keys) res[k] = mockLocalStorage[k];
          return Promise.resolve(res);
        }
        return Promise.resolve({ ...mockLocalStorage });
      },
      set: (items) => {
        Object.assign(mockLocalStorage, items);
        return Promise.resolve();
      },
      remove: (keys) => {
        const toRemove = Array.isArray(keys) ? keys : [keys];
        for (const k of toRemove) delete mockLocalStorage[k];
        return Promise.resolve();
      },
      clear: () => {
        mockLocalStorage = {};
        return Promise.resolve();
      },
    },
  },
};

test("clearSavedPostsData - selectively removes savedPosts and preserves other keys", async () => {
  mockLocalStorage = {
    savedPosts: { p1: { id: "p1", text: "Post 1" } },
    decisionLog: [{ id: "p1", hide: false }],
    apiKeys: { openai: "sk-test" },
    "cache:sha123": { hide: false },
  };

  await clearSavedPostsData();

  assert.equal(mockLocalStorage.savedPosts, undefined);
  assert.ok(Array.isArray(mockLocalStorage.decisionLog));
  assert.equal(mockLocalStorage.apiKeys.openai, "sk-test");
  assert.ok(mockLocalStorage["cache:sha123"]);
});

test("clearDecisionLogData - selectively removes decisionLog and preserves other keys", async () => {
  mockLocalStorage = {
    savedPosts: { p1: { id: "p1", text: "Post 1" } },
    decisionLog: [{ id: "p1", hide: false }],
    apiKeys: { openai: "sk-test" },
    "cache:sha123": { hide: false },
  };

  await clearDecisionLogData();

  assert.equal(mockLocalStorage.decisionLog, undefined);
  assert.ok(mockLocalStorage.savedPosts);
  assert.equal(mockLocalStorage.apiKeys.openai, "sk-test");
  assert.ok(mockLocalStorage["cache:sha123"]);
});

test("clearClassificationCache - selectively removes all cache:* keys and preserves untargeted keys", async () => {
  mockLocalStorage = {
    savedPosts: { p1: { id: "p1", text: "Post 1" } },
    decisionLog: [{ id: "p1", hide: false }],
    apiKeys: { openai: "sk-test" },
    "cache:hash1": { hide: false, reason: "r1" },
    "cache:hash2": { hide: true, reason: "r2" },
    "cache:hash3": { hide: false, reason: "r3" },
    dailyUsage: { date: "2026-08-28", count: 12 },
  };

  const removedCount = await clearClassificationCache();

  assert.equal(removedCount, 3);
  assert.equal(mockLocalStorage["cache:hash1"], undefined);
  assert.equal(mockLocalStorage["cache:hash2"], undefined);
  assert.equal(mockLocalStorage["cache:hash3"], undefined);
  assert.ok(mockLocalStorage.savedPosts);
  assert.ok(mockLocalStorage.decisionLog);
  assert.equal(mockLocalStorage.apiKeys.openai, "sk-test");
  assert.equal(mockLocalStorage.dailyUsage.count, 12);
});

test("clearAllLocalData - full local reset wipes all chrome.storage.local keys", async () => {
  mockLocalStorage = {
    savedPosts: { p1: { id: "p1", text: "Post 1" } },
    decisionLog: [{ id: "p1", hide: false }],
    apiKeys: { openai: "sk-test", gemini: "ai-test" },
    "cache:hash1": { hide: false },
    dailyUsage: { date: "2026-08-28", count: 50 },
  };

  await clearAllLocalData();

  assert.deepEqual(mockLocalStorage, {});
});

test("Idempotency - running cleanup operations on empty storage is safe", async () => {
  mockLocalStorage = {};

  await clearSavedPostsData();
  await clearDecisionLogData();
  const count = await clearClassificationCache();
  assert.equal(count, 0);
  await clearAllLocalData();

  assert.deepEqual(mockLocalStorage, {});
});

test("Concurrency - clearSavedPostsData synchronizes safely with serialized save operations", async () => {
  mockLocalStorage = { savedPosts: {} };

  // Trigger concurrent save and clear
  const p1 = savePost({ id: "post-1", text: "Post 1", author: "Alice" });
  const p2 = clearSavedPostsData();
  const p3 = savePost({ id: "post-2", text: "Post 2", author: "Bob" });

  await Promise.all([p1, p2, p3]);

  const remaining = await getSavedPosts();
  // Serialized execution: p1 saves, p2 clears, p3 saves -> only p3 survives
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "post-2");
});
