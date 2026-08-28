import test from "node:test";
import assert from "node:assert/strict";
import { classifyBatch as openaiClassify } from "../src/llm/openai-provider.js";
import { classifyBatch as geminiClassify } from "../src/llm/gemini-provider.js";
import { classifyBatch as claudeClassify } from "../src/llm/claude-provider.js";

test("OpenAI Provider - sends Authorization header and returns topics", async () => {
  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { id: "post-1", hide: true, reason: "spam", topics: ["Crypto", "Finance"] },
              ]),
            },
          },
        ],
      }),
    };
  };

  try {
    const result = await openaiClassify({
      apiKey: "sk-test-12345",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      rulesText: "Hide spam",
      posts: [{ id: "post-1", text: "Buy crypto now!" }],
    });

    assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(capturedHeaders["Authorization"], "Bearer sk-test-12345");
    assert.equal(capturedBody.model, "gpt-4o-mini");
    assert.equal(result.length, 1);
    assert.equal(result[0].hide, true);
    assert.equal(result[0].reason, "spam");
    assert.deepEqual(result[0].topics, ["Crypto", "Finance"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI Provider - OMITS Authorization header when apiKey is absent or empty", async () => {
  let capturedHeaders = null;
  let capturedUrl = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify([
                { id: "post-1", hide: false, reason: "ok", topics: ["Open Source"] },
              ]),
            },
          },
        ],
      }),
    };
  };

  try {
    const result = await openaiClassify({
      apiKey: "",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
      rulesText: "Hide spam",
      posts: [{ id: "post-1", text: "Nice software update." }],
    });

    assert.equal(capturedUrl, "http://localhost:11434/v1/chat/completions");
    assert.equal(capturedHeaders["Authorization"], undefined);
    assert.equal(result.length, 1);
    assert.equal(result[0].hide, false);
    assert.deepEqual(result[0].topics, ["Open Source"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini Provider - headers, schema, and topic preservation", async () => {
  let capturedHeaders = null;
  let capturedUrl = null;
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    { id: "p1", hide: false, reason: "keep", topics: ["AI", "Hardware"] },
                  ]),
                },
              ],
            },
          },
        ],
      }),
    };
  };

  try {
    // 1. With API key
    const res1 = await geminiClassify({
      apiKey: "AI-test-key",
      model: "gemini-3.5-flash",
      baseUrl: "",
      rulesText: "Hide ads",
      posts: [{ id: "p1", text: "Tech post" }],
    });
    assert.equal(
      capturedUrl,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
    );
    assert.equal(capturedHeaders["x-goog-api-key"], "AI-test-key");
    assert.deepEqual(res1[0].topics, ["AI", "Hardware"]);
    assert.ok(capturedBody.generationConfig.responseSchema.items.properties.topics);

    // 2. Without API key
    const res2 = await geminiClassify({
      apiKey: "",
      model: "gemini-3.5-flash",
      baseUrl: "https://custom-gemini-proxy.com",
      rulesText: "Hide ads",
      posts: [{ id: "p1", text: "Tech post" }],
    });
    assert.equal(
      capturedUrl,
      "https://custom-gemini-proxy.com/v1beta/models/gemini-3.5-flash:generateContent"
    );
    assert.equal(capturedHeaders["x-goog-api-key"], undefined);
    assert.deepEqual(res2[0].topics, ["AI", "Hardware"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claude Provider - headers, authentication, and topic preservation", async () => {
  let capturedHeaders = null;
  let capturedUrl = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      json: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify([
              { id: "p1", hide: false, reason: "ok", topics: ["Cloud", "DevOps"] },
            ]),
          },
        ],
      }),
    };
  };

  try {
    // 1. With API key
    const res1 = await claudeClassify({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5-20251001",
      baseUrl: "",
      rulesText: "Hide promo",
      posts: [{ id: "p1", text: "Article" }],
    });
    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(capturedHeaders["x-api-key"], "sk-ant-test");
    assert.equal(capturedHeaders["anthropic-dangerous-direct-browser-access"], "true");
    assert.deepEqual(res1[0].topics, ["Cloud", "DevOps"]);

    // 2. Without API key
    const res2 = await claudeClassify({
      apiKey: "",
      model: "claude-haiku-4-5-20251001",
      baseUrl: "https://my-claude-proxy.com",
      rulesText: "Hide promo",
      posts: [{ id: "p1", text: "Article" }],
    });
    assert.equal(capturedUrl, "https://my-claude-proxy.com/v1/messages");
    assert.equal(capturedHeaders["x-api-key"], undefined);
    assert.deepEqual(res2[0].topics, ["Cloud", "DevOps"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Storage Backward Compatibility - mock chrome.storage", async () => {
  const syncStore = {
    enabled: true,
    rulesText: "sample rules",
    provider: "openai",
    model: { openai: "gpt-4o" },
    dailyCallCap: 300,
  };
  const localStore = {
    apiKeys: { openai: "key123" },
  };

  globalThis.chrome = {
    storage: {
      sync: {
        get: async () => syncStore,
        set: async (obj) => Object.assign(syncStore, obj),
      },
      local: {
        get: async () => localStore,
        set: async (obj) => Object.assign(localStore, obj),
      },
    },
  };

  const { getSettings } = await import("../src/storage/rules-store.js");
  const s = await getSettings();

  assert.equal(s.enabled, true);
  assert.equal(s.rulesText, "sample rules");
  assert.equal(s.provider, "openai");
  assert.equal(s.model.openai, "gpt-4o");
  assert.equal(s.dailyCallCap, 300);
  assert.deepEqual(s.baseUrl, {
    openai: "",
    gemini: "",
    claude: "",
  });
  assert.equal(s.apiKeys.openai, "key123");
});
