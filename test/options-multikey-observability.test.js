// test/options-multikey-observability.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  renderKeyPool,
  addKeyRow,
  collectKeysFromDom,
  renderApiLogs,
  renderApiLogStats,
  updateProviderVisibility,
  load,
} from "../src/options/options.js";
import { resetScheduler, applyFailureOutcome } from "../src/llm/key-scheduler.js";
import { appendApiLog, clearApiLogs } from "../src/storage/api-log-store.js";
import { getSettings, setSettings } from "../src/storage/rules-store.js";

// DOM mock helper
class MockElement {
  constructor(tagName = "div", id = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = "";
    this.textContent = "";
    this._innerHTML = "";
    this.value = "";
    this.attributes = new Map();
    this.children = [];
    this.eventListeners = new Map();
  }

  set innerHTML(val) {
    this._innerHTML = val;
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || "";
  }

  setAttribute(name, val) {
    this.attributes.set(name, String(val));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  appendChild(child) {
    this.children.push(child);
  }

  addEventListener(event, fn) {
    if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
    this.eventListeners.get(event).push(fn);
  }

  trigger(event) {
    const list = this.eventListeners.get(event) || [];
    for (const fn of list) fn();
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const check = (node) => {
      if (selector.startsWith(".") && node.className.includes(selector.slice(1))) {
        results.push(node);
      } else if (selector.startsWith("#") && node.id === selector.slice(1)) {
        results.push(node);
      } else if (selector === node.tagName.toLowerCase()) {
        results.push(node);
      }
      for (const child of node.children) check(child);
    };
    check(this);
    return results;
  }

  focus() {}
}

function setupMockDom() {
  const elements = {
    provider: new MockElement("select", "provider"),
    openaiKeyList: new MockElement("div", "openaiKeyList"),
    geminiKeyList: new MockElement("div", "geminiKeyList"),
    claudeKeyList: new MockElement("div", "claudeKeyList"),
    openaiKey: new MockElement("input", "openaiKey"),
    geminiKey: new MockElement("input", "geminiKey"),
    claudeKey: new MockElement("input", "claudeKey"),
    openaiModel: new MockElement("input", "openaiModel"),
    geminiModel: new MockElement("input", "geminiModel"),
    claudeModel: new MockElement("input", "claudeModel"),
    openaiBaseUrl: new MockElement("input", "openaiBaseUrl"),
    geminiBaseUrl: new MockElement("input", "geminiBaseUrl"),
    claudeBaseUrl: new MockElement("input", "claudeBaseUrl"),
    dailyCap: new MockElement("input", "dailyCap"),
    kpiTotalRequests: new MockElement("span", "kpiTotalRequests"),
    kpiSuccessRate: new MockElement("span", "kpiSuccessRate"),
    kpiAvgLatency: new MockElement("span", "kpiAvgLatency"),
    kpiFailoverRate: new MockElement("span", "kpiFailoverRate"),
    filterProvider: new MockElement("select", "filterProvider"),
    filterStatus: new MockElement("select", "filterStatus"),
    searchApiLogs: new MockElement("input", "searchApiLogs"),
    apiLogList: new MockElement("div", "apiLogList"),
    apiLogActionStatus: new MockElement("span", "apiLogActionStatus"),
    save: new MockElement("button", "save"),
    status: new MockElement("span", "status"),
  };

  globalThis.document = {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: (sel) => {
      if (sel === ".provider-config") return [];
      return [];
    },
    createElement: (tag) => new MockElement(tag),
  };

  return elements;
}

test("HTML Contract: options.html contains multi-key pools, KPI cards, and activity log containers", () => {
  const html = fs.readFileSync(path.resolve("src/options/options.html"), "utf-8");

  // Multi-key lists
  assert.ok(html.includes('id="openaiKeyList"'), "Must contain openaiKeyList");
  assert.ok(html.includes('id="geminiKeyList"'), "Must contain geminiKeyList");
  assert.ok(html.includes('id="claudeKeyList"'), "Must contain claudeKeyList");
  assert.ok(html.includes('id="addOpenaiKeyBtn"'), "Must contain addOpenaiKeyBtn");

  // KPI cards
  assert.ok(html.includes('id="kpiTotalRequests"'), "Must contain kpiTotalRequests");
  assert.ok(html.includes('id="kpiSuccessRate"'), "Must contain kpiSuccessRate");
  assert.ok(html.includes('id="kpiAvgLatency"'), "Must contain kpiAvgLatency");
  assert.ok(html.includes('id="kpiFailoverRate"'), "Must contain kpiFailoverRate");

  // Activity filters
  assert.ok(html.includes('id="filterProvider"'), "Must contain filterProvider");
  assert.ok(html.includes('id="filterStatus"'), "Must contain filterStatus");
  assert.ok(html.includes('id="searchApiLogs"'), "Must contain searchApiLogs");
  assert.ok(html.includes('id="refreshApiLogsBtn"'), "Must contain refreshApiLogsBtn");
  assert.ok(html.includes('id="clearApiLogsBtn"'), "Must contain clearApiLogsBtn");
  assert.ok(html.includes('id="apiLogList"'), "Must contain apiLogList");
});

test("Multi-Key UI: renderKeyPool displays multiple keys with masked values and index labels", () => {
  const elements = setupMockDom();
  resetScheduler();

  renderKeyPool("openai", ["sk-first-key", "sk-second-key"]);

  const list = elements.openaiKeyList;
  assert.equal(list.children.length, 2);

  // Check row 0
  assert.ok(list.children[0].innerHTML.includes("Key #1"));
  assert.ok(list.children[0].innerHTML.includes("● Healthy"));
  assert.ok(list.children[0].innerHTML.includes("sk-first-key"));

  // Check row 1
  assert.ok(list.children[1].innerHTML.includes("Key #2"));
  assert.ok(list.children[1].innerHTML.includes("● Healthy"));
  assert.ok(list.children[1].innerHTML.includes("sk-second-key"));
});

test("Multi-Key UI: addKeyRow appends an empty row to key pool", () => {
  const elements = setupMockDom();
  renderKeyPool("openai", ["sk-first-key"]);
  assert.equal(elements.openaiKeyList.children.length, 1);

  addKeyRow("openai");
  assert.equal(elements.openaiKeyList.children.length, 2);
  assert.ok(elements.openaiKeyList.children[1].innerHTML.includes("Key #2"));
});

test("Multi-Key UI: renders 'No API keys configured' when key list is empty", () => {
  const elements = setupMockDom();
  renderKeyPool("gemini", []);

  const list = elements.geminiKeyList;
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].className, "empty-keys-msg");
  assert.equal(list.children[0].textContent, "No API keys configured");
});

test("Runtime Key Health: reflects cooldown and invalid states from key-scheduler", () => {
  const elements = setupMockDom();
  resetScheduler();

  // Key 0: Invalid, Key 1: 30s cooldown, Key 2: Healthy
  applyFailureOutcome("claude", 0, { invalidateKey: true });
  applyFailureOutcome("claude", 1, { cooldownMs: 30000 });

  renderKeyPool("claude", ["sk-k1", "sk-k2", "sk-k3"]);

  const list = elements.claudeKeyList;
  assert.equal(list.children.length, 3);

  assert.ok(list.children[0].innerHTML.includes("✕ Invalid"));
  assert.ok(list.children[1].innerHTML.includes("◷ Cooldown"));
  assert.ok(list.children[2].innerHTML.includes("● Healthy"));
});

test("API Activity Observability: renderApiLogStats updates KPI cards accurately", async () => {
  const elements = setupMockDom();
  const originalChrome = globalThis.chrome;

  const now = Date.now();
  const mockLogs = [
    {
      correlationId: "req_1",
      ts: now - 1000,
      logicalLatencyMs: 150,
      provider: "openai",
      ok: true,
      totalAttempts: 1,
    },
    {
      correlationId: "req_2",
      ts: now - 2000,
      logicalLatencyMs: 250,
      provider: "gemini",
      ok: true,
      totalAttempts: 2,
    },
  ];

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ apiLogs: mockLogs }),
      },
    },
  };

  try {
    await renderApiLogStats();

    assert.equal(elements.kpiTotalRequests.textContent, "2");
    assert.equal(elements.kpiSuccessRate.textContent, "100%");
    assert.equal(elements.kpiAvgLatency.textContent, "200 ms");
    assert.equal(elements.kpiFailoverRate.textContent, "50%");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("API Activity Observability: renderApiLogs renders logical requests with embedded attempts", async () => {
  const elements = setupMockDom();
  const originalChrome = globalThis.chrome;

  const mockLogs = [
    {
      correlationId: "req_100",
      ts: 1724948000000,
      logicalLatencyMs: 840,
      provider: "gemini",
      model: "gemini-3.5-flash",
      operation: "classifyBatch",
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
          startedAt: 1724948000000,
          latencyMs: 140,
          errorCode: "RATE_LIMITED",
          errorMessage: "Rate limit exceeded",
        },
        {
          attemptIndex: 1,
          keyIndex: 1,
          keyLabel: "Key #2",
          status: 200,
          ok: true,
          startedAt: 1724948000150,
          latencyMs: 700,
        },
      ],
    },
  ];

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ apiLogs: mockLogs }),
      },
    },
  };

  try {
    await renderApiLogs();

    const list = elements.apiLogList;
    assert.equal(list.children.length, 1);

    const cardHtml = list.children[0].innerHTML;
    assert.ok(cardHtml.includes("gemini"));
    assert.ok(cardHtml.includes("gemini-3.5-flash"));
    assert.ok(cardHtml.includes("✓ Success"));
    assert.ok(cardHtml.includes("2 attempts"));
    assert.ok(cardHtml.includes("840 ms"));

    // Check embedded attempt details
    assert.ok(cardHtml.includes("Attempt 1"));
    assert.ok(cardHtml.includes("Key #1"));
    assert.ok(cardHtml.includes("HTTP 429"));
    assert.ok(cardHtml.includes("RATE_LIMITED"));

    assert.ok(cardHtml.includes("Attempt 2"));
    assert.ok(cardHtml.includes("Key #2"));
    assert.ok(cardHtml.includes("HTTP 200"));

    // Security invariant: raw secrets and auth headers never rendered
    assert.ok(!cardHtml.includes("Authorization"));
    assert.ok(!cardHtml.includes("x-api-key"));
    assert.ok(!cardHtml.includes("x-goog-api-key"));
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("API Activity Observability: Clear logs removes all items and resets KPIs", async () => {
  const elements = setupMockDom();
  const originalChrome = globalThis.chrome;
  let localStore = {
    apiLogs: [
      { correlationId: "req_1", ts: 1000, provider: "openai", ok: true },
    ],
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ ...localStore }),
        remove: async (keys) => {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) delete localStore[k];
        },
      },
    },
  };

  try {
    await clearApiLogs();
    await renderApiLogs();
    await renderApiLogStats();

    assert.equal(elements.kpiTotalRequests.textContent, "0");
    assert.equal(elements.kpiSuccessRate.textContent, "100%");
    assert.equal(elements.kpiAvgLatency.textContent, "0 ms");
    assert.equal(elements.apiLogList.children[0].textContent, "No API activity records found.");
  } finally {
    globalThis.chrome = originalChrome;
  }
});
