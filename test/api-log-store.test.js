// test/api-log-store.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendApiLog,
  getApiLogs,
  clearApiLogs,
  getApiLogStats,
  normalizeApiLogRecord,
  normalizeAttempt,
  MAX_LOGICAL_LOGS,
} from "../src/storage/api-log-store.js";

// Helper mock storage
function createMockChromeStorage(initial = {}) {
  const store = { ...initial };
  return {
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
        clear: async () => {
          for (const k of Object.keys(store)) delete store[k];
        },
      },
    },
  };
}

test("normalizeAttempt - produces safe normalized attempt structures with sanitized errors", () => {
  const raw = {
    attemptIndex: 0,
    keyIndex: 1,
    keyLabel: "Key #2",
    status: 429,
    ok: false,
    startedAt: 1000,
    latencyMs: 150.4,
    endpointHost: "api.openai.com",
    errorCode: "RATE_LIMITED",
    errorMessage: "Rate limit exceeded for key sk-1234567890abcdef",
  };

  const norm = normalizeAttempt(raw);
  assert.equal(norm.attemptIndex, 0);
  assert.equal(norm.keyIndex, 1);
  assert.equal(norm.keyLabel, "Key #2");
  assert.equal(norm.status, 429);
  assert.equal(norm.ok, false);
  assert.equal(norm.latencyMs, 150);
  assert.equal(norm.endpointHost, "api.openai.com");
  assert.equal(norm.errorCode, "RATE_LIMITED");
  assert.ok(!norm.errorMessage.includes("sk-1234567890abcdef"));
  assert.ok(norm.errorMessage.includes("sk-***"));
});

test("normalizeApiLogRecord - defaults missing fields and embeds normalized attempts", () => {
  const norm = normalizeApiLogRecord({});
  assert.ok(norm.correlationId.startsWith("req_"));
  assert.equal(norm.provider, "openai");
  assert.equal(norm.model, "");
  assert.equal(norm.operation, "classifyBatch");
  assert.equal(norm.ok, false);
  assert.equal(norm.totalAttempts, 1);
  assert.deepEqual(norm.attempts, []);
});

test("appendApiLog & getApiLogs - stores logical request with correlated attempts", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockChromeStorage();

  try {
    const record = {
      correlationId: "req_1001",
      ts: 1000,
      completedAt: 1800,
      logicalLatencyMs: 800,
      provider: "gemini",
      model: "gemini-3.5-flash",
      operation: "classifyBatch",
      itemCount: 4,
      ok: true,
      finalStatus: 200,
      totalAttempts: 2,
      attempts: [
        {
          attemptIndex: 0,
          keyIndex: 0,
          keyLabel: "Key #1",
          status: 429,
          ok: false,
          startedAt: 1000,
          latencyMs: 200,
          errorCode: "RATE_LIMITED",
          errorMessage: "Quota limit exceeded",
        },
        {
          attemptIndex: 1,
          keyIndex: 1,
          keyLabel: "Key #2",
          status: 200,
          ok: true,
          startedAt: 1200,
          latencyMs: 600,
          endpointHost: "generativelanguage.googleapis.com",
        },
      ],
    };

    const appended = await appendApiLog(record);
    assert.equal(appended, true);

    const logs = await getApiLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].correlationId, "req_1001");
    assert.equal(logs[0].provider, "gemini");
    assert.equal(logs[0].totalAttempts, 2);
    assert.equal(logs[0].attempts.length, 2);
    assert.equal(logs[0].attempts[0].status, 429);
    assert.equal(logs[0].attempts[1].status, 200);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("getApiLogs - filtering by provider, status, search, and limit", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockChromeStorage();

  try {
    // Insert 3 records
    await appendApiLog({
      correlationId: "req_openai_ok",
      ts: 1000,
      provider: "openai",
      model: "gpt-4o-mini",
      ok: true,
      finalStatus: 200,
      totalAttempts: 1,
    });
    await appendApiLog({
      correlationId: "req_gemini_fail",
      ts: 2000,
      provider: "gemini",
      model: "gemini-3.5-flash",
      ok: false,
      finalStatus: 503,
      finalErrorCode: "SERVER_ERROR",
      finalErrorMessage: "Service Unavailable",
      totalAttempts: 2,
    });
    await appendApiLog({
      correlationId: "req_claude_failover",
      ts: 3000,
      provider: "claude",
      model: "claude-haiku",
      ok: true,
      finalStatus: 200,
      totalAttempts: 2,
    });

    // 1. Provider filter
    const openaiLogs = await getApiLogs({ provider: "openai" });
    assert.equal(openaiLogs.length, 1);
    assert.equal(openaiLogs[0].correlationId, "req_openai_ok");

    // 2. Status filter: error
    const errorLogs = await getApiLogs({ status: "error" });
    assert.equal(errorLogs.length, 1);
    assert.equal(errorLogs[0].correlationId, "req_gemini_fail");

    // 3. Status filter: failover
    const failoverLogs = await getApiLogs({ status: "failover" });
    assert.equal(failoverLogs.length, 2);

    // 4. Search filter
    const searchLogs = await getApiLogs({ search: "Unavailable" });
    assert.equal(searchLogs.length, 1);
    assert.equal(searchLogs[0].correlationId, "req_gemini_fail");

    // 5. Limit filter
    const limitedLogs = await getApiLogs({ limit: 1 });
    assert.equal(limitedLogs.length, 1);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("appendApiLog - bounds storage to MAX_LOGICAL_LOGS (100)", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockChromeStorage();

  try {
    for (let i = 0; i < 120; i++) {
      await appendApiLog({
        correlationId: `req_${i}`,
        ts: 1000 + i,
        provider: "openai",
        model: "gpt-4o-mini",
        ok: true,
      });
    }

    const logs = await getApiLogs();
    assert.equal(logs.length, MAX_LOGICAL_LOGS);
    // Newest record should be req_119
    assert.equal(logs[0].correlationId, "req_119");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("appendApiLog - quota error recovery trims log capacity to 50%", async () => {
  const originalChrome = globalThis.chrome;
  let throwOnce = true;
  // Initialize with 100 records
  const initialLogs = Array.from({ length: 100 }, (_, i) => ({
    correlationId: `init_${i}`,
    ts: 1000 + i,
    provider: "openai",
    ok: true,
  }));
  const store = { apiLogs: initialLogs };

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...store }),
        set: async (items) => {
          if (throwOnce && items.apiLogs && items.apiLogs.length > 50) {
            throwOnce = false;
            throw new Error("QUOTA_BYTES_PER_ITEM quota exceeded");
          }
          Object.assign(store, items);
        },
      },
    },
  };

  try {
    // Append 1 item when storage is full and triggers quota error on > 50 items
    const appended = await appendApiLog({
      correlationId: "new_overflow_record",
      ts: 5000,
      provider: "openai",
      ok: true,
    });

    assert.equal(appended, true);
    assert.equal(store.apiLogs.length, 50, "Log capacity should be trimmed to 50 items after quota error");
    assert.equal(store.apiLogs[0].correlationId, "new_overflow_record");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("getApiLogStats - accurately aggregates request metrics", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockChromeStorage();

  try {
    const now = Date.now();
    await appendApiLog({
      correlationId: "req_1",
      ts: now - 1000,
      logicalLatencyMs: 200,
      provider: "openai",
      ok: true,
      totalAttempts: 1,
    });
    await appendApiLog({
      correlationId: "req_2",
      ts: now - 2000,
      logicalLatencyMs: 400,
      provider: "openai",
      ok: false,
      totalAttempts: 1,
    });
    await appendApiLog({
      correlationId: "req_3",
      ts: now - 3000,
      logicalLatencyMs: 600,
      provider: "gemini",
      ok: true,
      totalAttempts: 2,
    });

    const stats = await getApiLogStats();
    assert.equal(stats.totalRequests, 3);
    assert.equal(stats.totalRequests24h, 3);
    assert.equal(stats.successCount, 2);
    assert.equal(stats.failureCount, 1);
    assert.equal(stats.successRate, 66.7);
    assert.equal(stats.failoverCount, 1);
    assert.equal(stats.failoverRate, 33.3);
    assert.equal(stats.avgLogicalLatencyMs, 400);

    assert.equal(stats.byProvider.openai.count, 2);
    assert.equal(stats.byProvider.openai.success, 1);
    assert.equal(stats.byProvider.openai.error, 1);
    assert.equal(stats.byProvider.openai.avgLatencyMs, 300);

    assert.equal(stats.byProvider.gemini.count, 1);
    assert.equal(stats.byProvider.gemini.success, 1);
    assert.equal(stats.byProvider.gemini.avgLatencyMs, 600);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("clearApiLogs - removes apiLogs from storage", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = createMockChromeStorage();

  try {
    await appendApiLog({ correlationId: "req_1", ts: 1000, provider: "openai" });
    assert.equal((await getApiLogs()).length, 1);

    await clearApiLogs();
    assert.equal((await getApiLogs()).length, 0);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
