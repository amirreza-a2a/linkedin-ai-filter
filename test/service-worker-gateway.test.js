// test/service-worker-gateway.test.js
import test from "node:test";
import assert from "node:assert/strict";

let registeredListener = null;

const localStore = {
  settings: {
    enabled: true,
    rulesText: "Hide spam",
    saveRulesText: "AI, Tech",
    provider: "openai",
    model: { openai: "gpt-4o-mini" },
    baseUrl: { openai: "" },
    dailyCallCap: 100,
  },
  apiKeys: {
    openai: ["sk-key-1", "sk-key-2"],
  },
};

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener: (fn) => {
        registeredListener = fn;
      },
    },
  },
  storage: {
    local: {
      get: async (keys) => {
        if (!keys) return { ...localStore };
        const out = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) if (localStore[k] !== undefined) out[k] = localStore[k];
        return out;
      },
      set: async (items) => Object.assign(localStore, items),
      remove: async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) delete localStore[k];
      },
    },
    sync: {
      get: async () => ({ ...localStore.settings }),
      set: async (items) => Object.assign(localStore.settings, items),
    },
  },
};

// Import once to initialize listener
await import("../src/background/service-worker.js");

test("Service Worker: handleClassify routes through Request Gateway and auto-saves matching posts", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { id: "post_1", hide: true, reason: "Spam", topics: ["Crypto"] },
              { id: "post_2", hide: false, reason: "Useful", topics: ["AI", "Tech"] },
            ]),
          },
        },
      ],
    }),
  });

  try {
    const posts = [
      { id: "post_1", text: "Buy crypto tokens now!" },
      { id: "post_2", text: "New open source AI model released." },
    ];

    let responseResult = null;
    await new Promise((resolve) => {
      registeredListener({ type: "CLASSIFY_POSTS", posts }, {}, (res) => {
        responseResult = res;
        resolve();
      });
    });

    assert.equal(responseResult.ok, true);
    assert.equal(responseResult.results.length, 2);

    // post_1
    assert.equal(responseResult.results[0].id, "post_1");
    assert.equal(responseResult.results[0].hide, true);
    assert.equal(responseResult.results[0].saved, false);

    // post_2 (topics: ["AI", "Tech"] matched saveRulesText: "AI, Tech")
    assert.equal(responseResult.results[1].id, "post_2");
    assert.equal(responseResult.results[1].hide, false);
    assert.equal(responseResult.results[1].saved, true);
    assert.equal(responseResult.results[1].autoSaved, true);
    assert.equal(responseResult.results[1].saveReason, "Matched topic: AI, Tech");

    // Cache verification
    const stored = await globalThis.chrome.storage.local.get(null);
    const cacheKeys = Object.keys(stored).filter((k) => k.startsWith("cache:"));
    assert.equal(cacheKeys.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Service Worker: handleClassify fails open gracefully when gateway encounters fatal error", async () => {
  const originalFetch = globalThis.fetch;

  // 400 Bad Request
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => JSON.stringify({ error: { message: "Invalid parameter" } }),
  });

  try {
    const posts = [{ id: "post_fail", text: "Some text" }];

    let responseResult = null;
    await new Promise((resolve) => {
      registeredListener({ type: "CLASSIFY_POSTS", posts }, {}, (res) => {
        responseResult = res;
        resolve();
      });
    });

    assert.equal(responseResult.ok, true);
    assert.equal(responseResult.results.length, 1);
    assert.equal(responseResult.results[0].id, "post_fail");
    assert.equal(responseResult.results[0].hide, false);
    assert.equal(responseResult.results[0].reason, "INVALID_REQUEST");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
