// test/multi-key-rules-store.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  getSettings,
  setSettings,
  normalizeApiKeys,
  getPrimaryApiKey,
} from "../src/storage/rules-store.js";
import {
  clearApiLogsData,
  clearAllLocalData,
} from "../src/storage/data-management.js";

function createMockStorage(initialLocal = {}, initialSync = {}) {
  const local = { ...initialLocal };
  const sync = { ...initialSync };

  return {
    storage: {
      local: {
        get: async (keys) => {
          if (!keys) return { ...local };
          const out = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            if (local[k] !== undefined) out[k] = local[k];
          }
          return out;
        },
        set: async (items) => {
          Object.assign(local, items);
        },
        remove: async (keys) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) delete local[k];
        },
        clear: async () => {
          for (const k of Object.keys(local)) delete local[k];
        },
      },
      sync: {
        get: async (keys) => {
          if (!keys) return { ...sync };
          const out = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            if (sync[k] !== undefined) out[k] = sync[k];
          }
          return out;
        },
        set: async (items) => {
          Object.assign(sync, items);
        },
      },
    },
  };
}

test("normalizeApiKeys - converts single string and arrays into clean arrays", () => {
  // 1. Single string (legacy)
  const legacy = normalizeApiKeys({ openai: "  sk-test-openai  ", gemini: "AIzaTest" });
  assert.deepEqual(legacy.openai, ["sk-test-openai"]);
  assert.deepEqual(legacy.gemini, ["AIzaTest"]);
  assert.deepEqual(legacy.claude, []);

  // 2. Arrays with duplicates, whitespace, and empty strings
  const arrayInput = normalizeApiKeys({
    openai: ["sk-key1", "  sk-key2  ", "sk-key1", "", "   "],
    claude: ["sk-ant-1"],
  });
  assert.deepEqual(arrayInput.openai, ["sk-key1", "sk-key2"]);
  assert.deepEqual(arrayInput.gemini, []);
  assert.deepEqual(arrayInput.claude, ["sk-ant-1"]);

  // 3. Null / undefined / empty input
  assert.deepEqual(normalizeApiKeys(null), { openai: [], gemini: [], claude: [] });
  assert.deepEqual(normalizeApiKeys(undefined), { openai: [], gemini: [], claude: [] });
  assert.deepEqual(normalizeApiKeys({}), { openai: [], gemini: [], claude: [] });
});

test("getPrimaryApiKey - extracts the first key across multiple representations", () => {
  assert.equal(getPrimaryApiKey("sk-single"), "sk-single");
  assert.equal(getPrimaryApiKey(["sk-1", "sk-2"]), "sk-1");
  assert.equal(getPrimaryApiKey({ openai: ["sk-1", "sk-2"] }, "openai"), "sk-1");
  assert.equal(getPrimaryApiKey({ openai: "sk-legacy" }, "openai"), "sk-legacy");
  assert.equal(getPrimaryApiKey({ openai: [] }, "openai"), "");
  assert.equal(getPrimaryApiKey(null, "openai"), "");
});

test("getSettings & setSettings - multi-key normalization and backward compatibility", async () => {
  const originalChrome = globalThis.chrome;
  // Initialize with legacy single-string key
  globalThis.chrome = createMockStorage(
    { apiKeys: { openai: "sk-legacy-openai", gemini: "AIzaLegacy" } },
    { provider: "openai" }
  );

  try {
    // 1. getSettings normalizes legacy strings to string arrays
    const settings = await getSettings();
    assert.deepEqual(settings.apiKeys.openai, ["sk-legacy-openai"]);
    assert.deepEqual(settings.apiKeys.gemini, ["AIzaLegacy"]);
    assert.deepEqual(settings.apiKeys.claude, []);

    // 2. setSettings updates with new multi-key array
    await setSettings({
      apiKeys: {
        openai: ["sk-new-1", "sk-new-2"],
      },
    });

    const updated = await getSettings();
    assert.deepEqual(updated.apiKeys.openai, ["sk-new-1", "sk-new-2"]);
    // Preserved inactive gemini key
    assert.deepEqual(updated.apiKeys.gemini, ["AIzaLegacy"]);

    // 3. setSettings also supports legacy string input
    await setSettings({
      apiKeys: {
        claude: "sk-ant-new",
      },
    });

    const finalSettings = await getSettings();
    assert.deepEqual(finalSettings.apiKeys.claude, ["sk-ant-new"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("clearApiLogsData - selectively clears apiLogs and preserves other storage", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockStorage({
    apiKeys: { openai: ["sk-1"] },
    apiLogs: [{ id: "req_1" }],
    savedPosts: [{ id: "p1" }],
  });

  try {
    await clearApiLogsData();
    const stored = await globalThis.chrome.storage.local.get(null);
    assert.equal(stored.apiLogs, undefined, "apiLogs should be deleted");
    assert.ok(stored.apiKeys !== undefined, "apiKeys should be preserved");
    assert.ok(stored.savedPosts !== undefined, "savedPosts should be preserved");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("clearAllLocalData - clears all local data including apiLogs", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockStorage({
    apiKeys: { openai: ["sk-1"] },
    apiLogs: [{ id: "req_1" }],
  });

  try {
    await clearAllLocalData();
    const stored = await globalThis.chrome.storage.local.get(null);
    assert.deepEqual(stored, {});
  } finally {
    globalThis.chrome = originalChrome;
  }
});
