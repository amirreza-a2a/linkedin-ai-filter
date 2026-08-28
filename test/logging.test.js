import test from "node:test";
import assert from "node:assert/strict";
import { appendLogEntries, getLogEntries, clearLog } from "../src/storage/log-store.js";

test("Decision Log - stores topics, saved event status, model, and maintains backward compatibility for legacy entries", async () => {
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

  // 1. Insert a legacy entry into storage that lacks topics, saved, autoSaved, and model
  localStorageMock["decisionLog"] = {
    "legacy-post-1": {
      id: "legacy-post-1",
      textSnippet: "Older post from before Phase 2",
      hide: true,
      reason: "recruiter spam",
      provider: "openai",
      rulesText: "Hide spam",
      ts: 1000,
    },
  };

  // 2. Read legacy entry and verify it defaults safely
  let entries = await getLogEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "legacy-post-1");
  assert.equal(entries[0].hide, true);
  assert.deepEqual(entries[0].topics, []);
  assert.equal(entries[0].saved, false);
  assert.equal(entries[0].saveReason, "");
  assert.equal(entries[0].autoSaved, false);
  assert.equal(entries[0].model, "");

  // 3. Append a new topic-bearing and saved event-bearing entry
  await appendLogEntries([
    {
      id: "new-post-2",
      textSnippet: "Exciting breakthrough in quantum computing",
      hide: false,
      reason: "keep",
      topics: ["Quantum Computing", "Physics"],
      saved: true,
      saveReason: "Matched topic: Quantum Computing",
      autoSaved: true,
      provider: "openai",
      model: "gpt-4o-mini",
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
  assert.equal(newEntry.saved, true);
  assert.equal(newEntry.saveReason, "Matched topic: Quantum Computing");
  assert.equal(newEntry.autoSaved, true);
  assert.equal(newEntry.model, "gpt-4o-mini");

  const legacyEntry = entries.find((e) => e.id === "legacy-post-1");
  assert.ok(legacyEntry);
  assert.equal(legacyEntry.hide, true);
  assert.deepEqual(legacyEntry.topics, []);
  assert.equal(legacyEntry.saved, false);

  // 5. Clear log
  await clearLog();
  entries = await getLogEntries();
  assert.deepEqual(entries, []);
});
