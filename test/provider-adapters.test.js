// test/provider-adapters.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { executeHttpAttempt as openaiAttempt } from "../src/llm/openai-provider.js";
import { executeHttpAttempt as geminiAttempt } from "../src/llm/gemini-provider.js";
import { executeHttpAttempt as claudeAttempt } from "../src/llm/claude-provider.js";

test("OpenAI Adapter: verifies endpoint, headers, payload, and normalized response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedOpts = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedOpts = opts;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{ id: "post_1", hide: true, reason: "Ad" }]) } }],
      }),
    };
  };

  try {
    const res = await openaiAttempt({
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      rulesText: "Filter ads",
      posts: [{ id: "post_1", text: "Buy something" }],
    });

    assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(capturedOpts.method, "POST");
    assert.equal(capturedOpts.headers["Authorization"], "Bearer sk-test-key");
    assert.equal(capturedOpts.headers["Content-Type"], "application/json");

    const body = JSON.parse(capturedOpts.body);
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.temperature, 0);

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.endpointHost, "api.openai.com");
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].hide, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini Adapter: verifies endpoint, headers, schema payload, and normalized response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedOpts = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedOpts = opts;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: JSON.stringify([{ id: "p1", hide: false, reason: "OK", topics: ["Tech"] }]) }],
            },
          },
        ],
      }),
    };
  };

  try {
    const res = await geminiAttempt({
      apiKey: "AIzaTestKey",
      model: "gemini-3.5-flash",
      rulesText: "Filter news",
      posts: [{ id: "p1", text: "Tech post" }],
    });

    assert.ok(capturedUrl.includes("generativelanguage.googleapis.com"));
    assert.ok(capturedUrl.includes("gemini-3.5-flash:generateContent"));
    assert.equal(capturedOpts.headers["x-goog-api-key"], "AIzaTestKey");

    const body = JSON.parse(capturedOpts.body);
    assert.ok(body.generationConfig.responseSchema);
    assert.equal(body.generationConfig.responseMimeType, "application/json");

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.endpointHost, "generativelanguage.googleapis.com");
    assert.equal(res.results[0].topics[0], "Tech");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claude Adapter: verifies endpoint, headers, direct-browser header, and normalized response", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedOpts = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedOpts = opts;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify([{ id: "p1", hide: true, reason: "Self-promo" }]) }],
      }),
    };
  };

  try {
    const res = await claudeAttempt({
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5-20251001",
      rulesText: "Filter promos",
      posts: [{ id: "p1", text: "Promo post" }],
    });

    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(capturedOpts.headers["x-api-key"], "sk-ant-test");
    assert.equal(capturedOpts.headers["anthropic-dangerous-direct-browser-access"], "true");

    const body = JSON.parse(capturedOpts.body);
    assert.equal(body.max_tokens, 1024);

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.equal(res.endpointHost, "api.anthropic.com");
    assert.equal(res.results[0].hide, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
