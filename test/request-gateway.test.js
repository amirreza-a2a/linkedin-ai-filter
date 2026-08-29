// test/request-gateway.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { executeClassifyRequest } from "../src/llm/request-gateway.js";
import { resetScheduler, getKeyPoolStatus } from "../src/llm/key-scheduler.js";
import { getApiLogs, clearApiLogs } from "../src/storage/api-log-store.js";

// Mock storage helper
function setupMockStorage() {
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          if (!keys) return { ...store };
          const out = {};
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) {
            if (store[k] !== undefined) out[k] = store[k];
          }
          return out;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
        remove: async (keys) => {
          const keyList = Array.isArray(keys) ? keys : [keys];
          for (const k of keyList) delete store[k];
        },
      },
    },
  };
  return store;
}

test("request-gateway: single-key successful classification", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  globalThis.fetch = async (url, opts) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { id: "post_1", hide: true, reason: "Ad", topics: ["Ads"] },
            ]),
          },
        },
      ],
    }),
  });

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys: ["sk-key-1"],
      model: "gpt-4o-mini",
      rulesText: "Hide ads",
      posts: [{ id: "post_1", text: "Buy crypto now" }],
    });

    assert.equal(res.ok, true);
    assert.equal(res.finalStatus, 200);
    assert.equal(res.totalAttempts, 1);
    assert.equal(res.results.length, 1);
    assert.equal(res.results[0].hide, true);

    // Verify exactly 1 logical API log
    const logs = await getApiLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].ok, true);
    assert.equal(logs[0].totalAttempts, 1);
    assert.equal(logs[0].attempts.length, 1);
    assert.equal(logs[0].attempts[0].keyIndex, 0);
    assert.equal(logs[0].attempts[0].status, 200);

    // Verify lease released
    const status = getKeyPoolStatus("openai", ["sk-key-1"]);
    assert.equal(status[0].activeLeases, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 3-Key failover scenario (429 -> 503 -> 200)", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-key-1", "sk-key-2", "sk-key-3"];
  const attemptedKeys = [];

  globalThis.fetch = async (url, opts) => {
    const auth = opts.headers["Authorization"] || "";
    attemptedKeys.push(auth);

    if (auth.includes("sk-key-1")) {
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "Rate limit reached" } }),
      };
    } else if (auth.includes("sk-key-2")) {
      return {
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ error: { message: "Service Unavailable" } }),
      };
    } else if (auth.includes("sk-key-3")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify([{ id: "p1", hide: false, reason: "OK", topics: ["AI"] }]),
              },
            },
          ],
        }),
      };
    }
    return { ok: false, status: 500, text: async () => "Unknown" };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "Hide spam",
      posts: [{ id: "p1", text: "Research update" }],
    });

    assert.equal(res.ok, true);
    assert.equal(res.finalStatus, 200);
    assert.equal(res.totalAttempts, 3);
    assert.equal(res.results.length, 1);

    // Invariant: exactly 1 logical API log record with 3 attempts
    const logs = await getApiLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].ok, true);
    assert.equal(logs[0].totalAttempts, 3);
    assert.equal(logs[0].attempts.length, 3);

    assert.equal(logs[0].attempts[0].keyIndex, 0);
    assert.equal(logs[0].attempts[0].status, 429);
    assert.equal(logs[0].attempts[0].errorCode, "RATE_LIMITED");

    assert.equal(logs[0].attempts[1].keyIndex, 1);
    assert.equal(logs[0].attempts[1].status, 503);
    assert.equal(logs[0].attempts[1].errorCode, "SERVER_ERROR");

    assert.equal(logs[0].attempts[2].keyIndex, 2);
    assert.equal(logs[0].attempts[2].status, 200);
    assert.equal(logs[0].attempts[2].ok, true);

    // Invariant: All scheduler leases returned to 0
    const poolStatus = getKeyPoolStatus("openai", keys);
    assert.equal(poolStatus[0].activeLeases, 0);
    assert.equal(poolStatus[1].activeLeases, 0);
    assert.equal(poolStatus[2].activeLeases, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 401 permanently invalidates key and fails over to healthy key", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-invalid-1", "sk-valid-2"];

  globalThis.fetch = async (url, opts) => {
    const auth = opts.headers["Authorization"] || "";
    if (auth.includes("sk-invalid-1")) {
      return {
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: "Incorrect API key provided: sk-invalid-1" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{ id: "p1", hide: false, reason: "OK", topics: [] }]) } }],
      }),
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, true);
    assert.equal(res.totalAttempts, 2);

    // Verify key 0 is marked invalid in scheduler
    const poolStatus = getKeyPoolStatus("openai", keys);
    assert.equal(poolStatus[0].status, "invalid");
    assert.equal(poolStatus[1].status, "healthy");

    // Verify no secret leak in logs
    const logs = await getApiLogs();
    assert.equal(logs.length, 1);
    assert.ok(!logs[0].attempts[0].errorMessage.includes("sk-invalid-1"));
    assert.ok(logs[0].attempts[0].errorMessage.includes("sk-***"));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 401 on all configured keys returns normalized terminal error", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-bad-1", "sk-bad-2"];

  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
  });

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 401);
    assert.equal(res.finalErrorCode, "INVALID_API_KEY");
    assert.equal(res.totalAttempts, 2);

    const poolStatus = getKeyPoolStatus("openai", keys);
    assert.equal(poolStatus[0].status, "invalid");
    assert.equal(poolStatus[1].status, "invalid");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 403 Forbidden applies 300s cooldown and fails over", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-forbidden-1", "sk-good-2"];

  globalThis.fetch = async (url, opts) => {
    const auth = opts.headers["Authorization"] || "";
    if (auth.includes("sk-forbidden-1")) {
      return {
        ok: false,
        status: 403,
        text: async () => JSON.stringify({ error: { message: "Account suspended or tier restricted" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{ id: "p1", hide: false, reason: "OK", topics: [] }]) } }],
      }),
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, true);
    assert.equal(res.totalAttempts, 2);

    const poolStatus = getKeyPoolStatus("openai", keys);
    assert.equal(poolStatus[0].status, "cooldown");
    assert.ok(poolStatus[0].cooldownRemainingMs > 250000); // 300s
    assert.equal(poolStatus[1].status, "healthy");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 429 quota exhaustion applies 300s cooldown", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-quota-1", "sk-good-2"];

  globalThis.fetch = async (url, opts) => {
    const auth = opts.headers["Authorization"] || "";
    if (auth.includes("sk-quota-1")) {
      return {
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: { message: "You exceeded your current quota" } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{ id: "p1", hide: false, reason: "OK", topics: [] }]) } }],
      }),
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, true);
    assert.equal(res.totalAttempts, 2);

    const poolStatus = getKeyPoolStatus("openai", keys);
    assert.equal(poolStatus[0].status, "cooldown");
    assert.ok(poolStatus[0].cooldownRemainingMs > 250000); // 300s for quota
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 409 Conflict caps failover at 1 alternate key", async () => {
  resetScheduler();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2", "sk-k3"];

  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: false,
      status: 409,
      text: async () => "Resource state conflict",
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 409);
    assert.equal(res.finalErrorCode, "CONFLICT");
    assert.equal(res.totalAttempts, 2);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: Timeout caps failover at 1 alternate key", async () => {
  resetScheduler();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2", "sk-k3"];

  globalThis.fetch = async () => {
    fetchCount++;
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    throw err;
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 0);
    assert.equal(res.finalErrorCode, "TIMEOUT");
    assert.equal(res.totalAttempts, 2);
    assert.equal(fetchCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 400 Bad Request terminates immediately without key failover", async () => {
  resetScheduler();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2", "sk-k3"];

  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: "Invalid JSON schema parameter" } }),
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 400);
    assert.equal(res.finalErrorCode, "INVALID_REQUEST");
    assert.equal(res.totalAttempts, 1);
    assert.equal(fetchCount, 1, "Must NOT failover on 400");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 404 Not Found terminates immediately without key failover", async () => {
  resetScheduler();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2"];

  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: false,
      status: 404,
      text: async () => "Model not found",
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-nonexistent",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 404);
    assert.equal(res.finalErrorCode, "NOT_FOUND");
    assert.equal(res.totalAttempts, 1);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: Network Error terminates immediately without key failover", async () => {
  resetScheduler();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2"];

  globalThis.fetch = async () => {
    fetchCount++;
    throw new TypeError("Failed to fetch");
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 0);
    assert.equal(res.finalErrorCode, "NETWORK_ERROR");
    assert.equal(res.totalAttempts, 1);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: 5xx server error caps failover at 1 alternate key", async () => {
  resetScheduler();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2", "sk-k3", "sk-k4"];

  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: false,
      status: 503,
      text: async () => "Service Unavailable",
    };
  };

  try {
    const res = await executeClassifyRequest({
      provider: "openai",
      keys,
      model: "gpt-4o-mini",
      rulesText: "filter",
      posts: [{ id: "p1", text: "text" }],
    });

    assert.equal(res.ok, false);
    assert.equal(res.finalStatus, 503);
    assert.equal(res.finalErrorCode, "SERVER_ERROR");
    // Initial attempt (key 1) + 1 alternate attempt (key 2) = exactly 2 attempts
    assert.equal(res.totalAttempts, 2);
    assert.equal(fetchCount, 2, "Must cap 5xx failovers at 1 alternate attempt to protect key pool");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

test("request-gateway: concurrent requests distribute leases across keys and balance back to zero", async () => {
  resetScheduler();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  setupMockStorage();

  const keys = ["sk-k1", "sk-k2", "sk-k3"];

  globalThis.fetch = async () => {
    // Artificial 20ms delay
    await new Promise((r) => setTimeout(r, 20));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify([{ id: "p1", hide: false, reason: "OK", topics: [] }]) } }],
      }),
    };
  };

  try {
    // Launch 6 parallel classification requests
    const promises = Array.from({ length: 6 }, () =>
      executeClassifyRequest({
        provider: "openai",
        keys,
        model: "gpt-4o-mini",
        rulesText: "filter",
        posts: [{ id: "p1", text: "text" }],
      })
    );

    const results = await Promise.all(promises);
    assert.equal(results.length, 6);
    for (const r of results) {
      assert.equal(r.ok, true);
    }

    // All active leases must return to 0
    const poolStatus = getKeyPoolStatus("openai", keys);
    assert.equal(poolStatus[0].activeLeases, 0);
    assert.equal(poolStatus[1].activeLeases, 0);
    assert.equal(poolStatus[2].activeLeases, 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});
