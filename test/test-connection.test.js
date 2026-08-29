// test/test-connection.test.js
// Comprehensive test suite for Test Connection / Test API provider testing feature.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { testProviderConnection, normalizeTestError } from "../src/llm/test-connection.js";
import { handleTestConnection, els } from "../src/options/options.js";

// --- 1. HTML DOM Contract Tests ---
test("Test Connection UI Contract: options.html contains test buttons and status elements for all 3 providers", () => {
  const html = fs.readFileSync(path.resolve("src/options/options.html"), "utf-8");

  assert.ok(html.includes('id="testOpenAiBtn"'), "Must contain OpenAI test button");
  assert.ok(html.includes('id="openaiTestStatus"'), "Must contain OpenAI test status element");
  assert.ok(html.includes('id="testGeminiBtn"'), "Must contain Gemini test button");
  assert.ok(html.includes('id="geminiTestStatus"'), "Must contain Gemini test status element");
  assert.ok(html.includes('id="testClaudeBtn"'), "Must contain Claude test button");
  assert.ok(html.includes('id="claudeTestStatus"'), "Must contain Claude test status element");
  assert.ok(html.includes(".btn-test"), "Must contain .btn-test styling");
  assert.ok(html.includes(".test-conn-status"), "Must contain .test-conn-status styling");
});

// --- 2. Error Normalization Unit Tests ---
test("normalizeTestError: correctly maps standard HTTP status codes and error bodies", () => {
  // 400
  const err400 = normalizeTestError(400, JSON.stringify({ error: { message: "Unknown model foo" } }));
  assert.equal(err400.errorCode, "INVALID_REQUEST");
  assert.ok(err400.message.includes("Unknown model foo"));

  // 401
  const err401 = normalizeTestError(401, "Unauthorized");
  assert.equal(err401.errorCode, "INVALID_API_KEY");
  assert.equal(err401.message, "Invalid API key");

  // 403
  const err403 = normalizeTestError(403, JSON.stringify({ error: "Forbidden access" }));
  assert.equal(err403.errorCode, "PERMISSION_DENIED");

  // 404
  const err404 = normalizeTestError(404, "Not Found");
  assert.equal(err404.errorCode, "NOT_FOUND");
  assert.ok(err404.message.includes("Model or endpoint not found"));

  // 429
  const err429 = normalizeTestError(429, JSON.stringify({ error: { message: "You exceeded your current quota" } }));
  assert.equal(err429.errorCode, "RATE_LIMITED");
  assert.ok(err429.message.includes("Quota exceeded"));

  // 500 / 503
  const err503 = normalizeTestError(503, "Service Unavailable");
  assert.equal(err503.errorCode, "SERVER_ERROR");
  assert.ok(err503.message.includes("503"));

  // Network (status = 0 or undefined)
  const errNet = normalizeTestError(0, "");
  assert.equal(errNet.errorCode, "NETWORK_ERROR");
  assert.equal(errNet.message, "Unable to reach provider endpoint");
});

// --- 3. Provider Testing - OpenAI ---
test("testProviderConnection: OpenAI successful connection using minimal ping payload", async () => {
  let capturedUrl = "";
  let capturedHeaders = null;
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    };
  };

  try {
    const res = await testProviderConnection({
      provider: "openai",
      apiKey: "sk-test-openai-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
    });

    assert.equal(res.ok, true);
    assert.equal(res.provider, "openai");
    assert.equal(res.model, "gpt-4o-mini");
    assert.ok(typeof res.latencyMs === "number" && res.latencyMs >= 0);

    assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
    assert.equal(capturedHeaders["Authorization"], "Bearer sk-test-openai-key");
    assert.equal(capturedBody.model, "gpt-4o-mini");
    assert.equal(capturedBody.max_tokens, 1);
    assert.deepEqual(capturedBody.messages, [{ role: "user", content: "ping" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 4. Provider Testing - Gemini ---
test("testProviderConnection: Gemini successful connection using minimal generateContent payload", async () => {
  let capturedUrl = "";
  let capturedHeaders = null;
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "pong" }] } }] }),
    };
  };

  try {
    const res = await testProviderConnection({
      provider: "gemini",
      apiKey: "AI-test-gemini-key",
      model: "gemini-3.5-flash",
      baseUrl: "",
    });

    assert.equal(res.ok, true);
    assert.equal(res.provider, "gemini");
    assert.equal(res.model, "gemini-3.5-flash");
    assert.ok(res.latencyMs >= 0);

    assert.ok(capturedUrl.includes("generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"));
    assert.equal(capturedHeaders["x-goog-api-key"], "AI-test-gemini-key");
    assert.deepEqual(capturedBody.contents, [{ parts: [{ text: "ping" }] }]);
    assert.equal(capturedBody.generationConfig.maxOutputTokens, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 5. Provider Testing - Claude ---
test("testProviderConnection: Claude successful connection using minimal messages payload", async () => {
  let capturedUrl = "";
  let capturedHeaders = null;
  let capturedBody = null;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "pong" }] }),
    };
  };

  try {
    const res = await testProviderConnection({
      provider: "claude",
      apiKey: "sk-ant-test-claude-key",
      model: "claude-haiku-4-5-20251001",
      baseUrl: "",
    });

    assert.equal(res.ok, true);
    assert.equal(res.provider, "claude");
    assert.equal(res.model, "claude-haiku-4-5-20251001");
    assert.ok(res.latencyMs >= 0);

    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(capturedHeaders["x-api-key"], "sk-ant-test-claude-key");
    assert.equal(capturedHeaders["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
    assert.equal(capturedBody.max_tokens, 1);
    assert.deepEqual(capturedBody.messages, [{ role: "user", content: "ping" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 6. Failure Scenarios ---
test("testProviderConnection: Validation errors for missing API key or invalid Base URL", async () => {
  // Missing API key for Gemini
  const res1 = await testProviderConnection({
    provider: "gemini",
    apiKey: "",
    model: "gemini-3.5-flash",
  });
  assert.equal(res1.ok, false);
  assert.equal(res1.errorCode, "MISSING_API_KEY");

  // Invalid Base URL (bad protocol)
  const res2 = await testProviderConnection({
    provider: "openai",
    apiKey: "sk-123",
    model: "gpt-4o-mini",
    baseUrl: "ftp://invalid-url.com",
  });
  assert.equal(res2.ok, false);
  assert.equal(res2.errorCode, "INVALID_BASE_URL");

  // Custom OpenAI with empty API key is ALLOWED (e.g. Ollama localhost)
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "pong" } }] }),
  });
  try {
    const res3 = await testProviderConnection({
      provider: "openai",
      apiKey: "",
      model: "llama3.2",
      baseUrl: "http://localhost:11434/v1",
    });
    assert.equal(res3.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testProviderConnection: Handles 401 Invalid API key cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: "Incorrect API key provided" } }),
  });

  try {
    const res = await testProviderConnection({
      provider: "openai",
      apiKey: "sk-invalid",
      model: "gpt-4o-mini",
    });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "INVALID_API_KEY");
    assert.equal(res.message, "Invalid API key");
    assert.equal(res.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testProviderConnection: Handles 404 Model Not Found cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => "The model 'non-existent-model' does not exist",
  });

  try {
    const res = await testProviderConnection({
      provider: "openai",
      apiKey: "sk-valid",
      model: "non-existent-model",
    });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "NOT_FOUND");
    assert.ok(res.message.includes("Model or endpoint not found"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testProviderConnection: Handles 429 Rate Limit cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { message: "Rate limit reached for requests" } }),
  });

  try {
    const res = await testProviderConnection({
      provider: "claude",
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5-20251001",
    });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "RATE_LIMITED");
    assert.ok(res.message.includes("Rate limit"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testProviderConnection: Handles Network Error / Fetch Rejection cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };

  try {
    const res = await testProviderConnection({
      provider: "gemini",
      apiKey: "AI-test",
      model: "gemini-3.5-flash",
    });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "NETWORK_ERROR");
    assert.ok(res.message.includes("Unable to reach provider endpoint"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("testProviderConnection: Handles Timeout cleanly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    return new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        reject(err);
      });
    });
  };

  try {
    const res = await testProviderConnection({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      timeoutMs: 50, // fast timeout for test
    });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "TIMEOUT");
    assert.ok(res.message.includes("timed out"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- 7. UI Integration & Unsaved Form Values Tests ---
test("handleTestConnection: Uses current unsaved DOM values and updates UI states", async () => {
  const formElements = {
    provider: { value: "claude" },
    claudeKey: { value: "sk-ant-unsaved-key" },
    claudeModel: { value: "claude-3-5-sonnet-latest" },
    claudeBaseUrl: { value: "" },
  };

  const mockBtn = {
    disabled: false,
    textContent: "Test Connection",
  };

  const mockStatusEl = {
    textContent: "",
    className: "",
  };

  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  let receivedModel = "";
  let receivedKey = "";

  globalThis.document = {
    getElementById: (id) => formElements[id] || null,
  };

  globalThis.fetch = async (url, options) => {
    receivedKey = options.headers["x-api-key"];
    const body = JSON.parse(options.body);
    receivedModel = body.model;
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: "text", text: "pong" }] }),
    };
  };

  try {
    const res = await handleTestConnection("claude", mockBtn, mockStatusEl);

    // 1. Result must be OK
    assert.equal(res.ok, true);

    // 2. Must have used the unsaved DOM values
    assert.equal(receivedKey, "sk-ant-unsaved-key");
    assert.equal(receivedModel, "claude-3-5-sonnet-latest");

    // 3. UI state must be updated to success and button re-enabled
    assert.equal(mockBtn.disabled, false);
    assert.equal(mockBtn.textContent, "Test Connection");
    assert.ok(mockStatusEl.textContent.includes("✓ Connection successful"));
    assert.equal(mockStatusEl.className, "test-conn-status status-success");
  } finally {
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});

test("handleTestConnection: Prevents duplicate concurrent test runs for the same provider", async () => {
  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;

  const formElements = {
    openaiKey: { value: "sk-test-key" },
    openaiModel: { value: "gpt-4o-mini" },
    openaiBaseUrl: { value: "" },
  };

  globalThis.document = {
    getElementById: (id) => formElements[id] || null,
  };

  globalThis.fetch = async () => {
    fetchCallCount++;
    await new Promise((r) => setTimeout(r, 50));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "pong" } }] }),
    };
  };

  const mockBtn = { disabled: false, textContent: "Test Connection" };
  const mockStatus = { textContent: "", className: "" };

  try {
    // Launch two simultaneous connection tests
    const p1 = handleTestConnection("openai", mockBtn, mockStatus);
    const p2 = handleTestConnection("openai", mockBtn, mockStatus);

    await Promise.all([p1, p2]);

    // Second in-flight click must have been ignored
    assert.equal(fetchCallCount, 1, "Concurrent test clicks must be coalesced/ignored");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});

test("Persistence Invariant: Testing connection never mutates storage", async () => {
  let storageSetCalled = false;
  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;

  globalThis.document = {
    getElementById: () => ({ value: "test-val" }),
  };

  globalThis.chrome = {
    storage: {
      sync: {
        set: async () => {
          storageSetCalled = true;
        },
      },
      local: {
        set: async () => {
          storageSetCalled = true;
        },
      },
    },
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "pong" } }] }),
  });

  try {
    await testProviderConnection({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });

    assert.equal(storageSetCalled, false, "testProviderConnection must NOT call storage.set");
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  }
});

// --- 8. Contract Invariants & Security Masking Tests ---
test("Security Invariant: normalizeTestError masks raw secrets and Bearer tokens in error messages", () => {
  const leakedResponse = JSON.stringify({
    error: {
      message: "Failed authenticating sk-1234567890abcdef with Bearer eyJhbGciOiJIUzI1Ni... and key sk-ant-9876543210zyx and AIzaSyD987654321",
    },
  });

  const normalized = normalizeTestError(401, leakedResponse);
  assert.equal(normalized.errorCode, "INVALID_API_KEY");
  assert.equal(normalized.message, "Invalid API key");

  const normalized400 = normalizeTestError(400, leakedResponse);
  assert.equal(normalized400.errorCode, "INVALID_REQUEST");
  assert.ok(!normalized400.message.includes("sk-1234567890abcdef"));
  assert.ok(!normalized400.message.includes("sk-ant-9876543210zyx"));
  assert.ok(!normalized400.message.includes("AIzaSyD987654321"));
  assert.ok(normalized400.message.includes("sk-***"));
  assert.ok(normalized400.message.includes("sk-ant-***"));
  assert.ok(normalized400.message.includes("AIza***"));
});

test("Contract Invariant: 409 Conflict status is mapped cleanly to CONFLICT error code", () => {
  const err409 = normalizeTestError(409, JSON.stringify({ error: { message: "Model resource locked" } }));
  assert.equal(err409.errorCode, "CONFLICT");
  assert.ok(err409.message.includes("Conflict"));
});

test("Contract Invariant: Host permission requests only trigger for custom Base URLs, never built-in endpoints", async () => {
  let containsCalled = false;
  let requestCalled = false;

  const originalChrome = globalThis.chrome;
  const originalFetch = globalThis.fetch;

  globalThis.chrome = {
    permissions: {
      contains: async () => {
        containsCalled = true;
        return true;
      },
      request: async () => {
        requestCalled = true;
        return true;
      },
    },
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "pong" } }] }),
  });

  try {
    // 1. Built-in OpenAI endpoint (empty baseUrl) -> must NOT query chrome.permissions
    containsCalled = false;
    requestCalled = false;
    await testProviderConnection({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "",
    });
    assert.equal(containsCalled, false, "Default endpoint must not check permissions");
    assert.equal(requestCalled, false, "Default endpoint must not request permissions");

    // 2. Custom Base URL -> must check permissions
    containsCalled = false;
    requestCalled = false;
    await testProviderConnection({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://my-custom-proxy.internal.corp/v1",
    });
    assert.equal(containsCalled, true, "Custom Base URL must check permissions");
  } finally {
    globalThis.chrome = originalChrome;
    globalThis.fetch = originalFetch;
  }
});
