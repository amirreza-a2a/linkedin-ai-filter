import test from "node:test";
import assert from "node:assert/strict";
import { appendLogEntries, getLogEntries, clearLog } from "../src/storage/log-store.js";

test("Decision Log - stores topics and maintains backward compatibility for legacy entries", async () => {
  let localStorageMock = {};

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = localStorageMock[k];
          return res;
        },
        set: async (obj) => {
          Object.assign(localStorageMock, obj);
        },
        remove: async (keys) => {
          for (const k of keys) delete localStorageMock[k];
        },
      },
    },
  };

  // 1. Insert a legacy entry into storage that lacks the `topics` property
  localStorageMock["decisionLog"] = {
    "legacy-post-1": {
      id: "legacy-post-1",
      textSnippet: "Older post from before Phase 2",
      hide: true,
      reason: "recruiter spam",
      provider: "openai",
      rulesText: "Hide spam",
      ts: 1000,
      // Notice: `topics` field is completely omitted in legacy format
    },
  };

  // 2. Read legacy entry and verify it exposes topics: []
  let entries = await getLogEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "legacy-post-1");
  assert.equal(entries[0].hide, true);
  assert.deepEqual(entries[0].topics, []);

  // 3. Append a new topic-bearing entry
  await appendLogEntries([
    {
      id: "new-post-2",
      textSnippet: "Exciting breakthrough in quantum computing",
      hide: false,
      reason: "keep",
      topics: ["Quantum Computing", "Physics"],
      provider: "openai",
      rulesText: "Hide spam",
      ts: 2000,
    },
  ]);

  // 4. Read both entries and verify ordering and fields
  entries = await getLogEntries();
  assert.equal(entries.length, 2);

  const newEntry = entries.find((e) => e.id === "new-post-2");
  assert.ok(newEntry);
  assert.equal(newEntry.hide, false);
  assert.deepEqual(newEntry.topics, ["Quantum Computing", "Physics"]);

  const legacyEntry = entries.find((e) => e.id === "legacy-post-1");
  assert.ok(legacyEntry);
  assert.equal(legacyEntry.hide, true);
  assert.deepEqual(legacyEntry.topics, []);

  // 5. Clear log
  await clearLog();
  entries = await getLogEntries();
  assert.deepEqual(entries, []);
});
