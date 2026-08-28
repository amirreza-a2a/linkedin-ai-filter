import test from "node:test";
import assert from "node:assert/strict";
import {
  savePost,
  savePostsBatch,
  unsavePost,
  getSavedPosts,
  clearSavedPosts,
  isPostSaved,
} from "../src/storage/saved-posts-store.js";

// Mock chrome.storage.local for tests
let storageMock = {};

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const res = {};
        for (const k of keys) res[k] = storageMock[k];
        return res;
      },
      set: async (obj) => {
        Object.assign(storageMock, obj);
      },
      remove: async (keys) => {
        for (const k of keys) delete storageMock[k];
      },
    },
  },
};

test("Saved Posts Store - Basic save, get, and unsave", async () => {
  storageMock = {};

  const post = await savePost({
    id: "urn:li:activity:1001",
    text: "Exciting 5G update",
    author: "Alice Engineer",
    authorUrl: "https://linkedin.com/in/alice",
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:1001",
    topics: ["5G", "Telecom"],
    saveReason: "Matched topic: 5G",
    autoSaved: true,
  });

  assert.equal(post.id, "urn:li:activity:1001");
  assert.equal(post.author, "Alice Engineer");
  assert.equal(post.autoSaved, true);
  assert.ok(post.savedAt > 0);
  assert.equal(post.savedAt, post.updatedAt);

  let list = await getSavedPosts();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "urn:li:activity:1001");

  const isSaved = await isPostSaved("urn:li:activity:1001");
  assert.equal(isSaved, true);

  await unsavePost("urn:li:activity:1001");
  list = await getSavedPosts();
  assert.equal(list.length, 0);
});

test("Saved Posts Store - Concurrent mutation serialization", async () => {
  storageMock = {};

  // Fire 10 concurrent saves and unsaves simultaneously
  const ops = [
    savePost({ id: "p1", text: "Post 1", topics: ["AI"] }),
    savePost({ id: "p2", text: "Post 2", topics: ["5G"] }),
    savePost({ id: "p3", text: "Post 3", topics: ["Robotics"] }),
    savePost({ id: "p4", text: "Post 4", topics: ["Cloud"] }),
    savePost({ id: "p5", text: "Post 5", topics: ["DevOps"] }),
    unsavePost("p2"),
    savePost({ id: "p6", text: "Post 6", topics: ["Hardware"] }),
  ];

  await Promise.all(ops);

  const list = await getSavedPosts();
  const ids = list.map((p) => p.id).sort();

  // p2 was unsaved, p1, p3, p4, p5, p6 must all survive
  assert.deepEqual(ids, ["p1", "p3", "p4", "p5", "p6"]);
});

test("Saved Posts Store - Write deduplication on re-scans & savedAt preservation", async () => {
  storageMock = {};

  const initialSavedAt = 1700000000000;
  await savePost({
    id: "p100",
    text: "Repeated post text",
    author: "Bob",
    authorUrl: "https://linkedin.com/in/bob",
    postUrl: "https://linkedin.com/posts/100",
    topics: ["AI", "Semiconductors"],
    saveReason: "Matched topic: AI",
    autoSaved: true,
    savedAt: initialSavedAt,
    updatedAt: initialSavedAt,
  });

  // Re-scan identical post
  const rescan = await savePost({
    id: "p100",
    text: "Repeated post text",
    author: "Bob",
    authorUrl: "https://linkedin.com/in/bob",
    postUrl: "https://linkedin.com/posts/100",
    topics: ["AI", "Semiconductors"],
    saveReason: "Matched topic: AI",
    autoSaved: true,
  });

  assert.equal(rescan.savedAt, initialSavedAt);
  assert.equal(rescan.updatedAt, initialSavedAt); // not updated because identical
});

test("Saved Posts Store - Manual save takes precedence over auto-save on re-scan", async () => {
  storageMock = {};

  // 1. Manually saved post
  await savePost({
    id: "p200",
    text: "Manual save post",
    topics: ["Physics"],
    saveReason: "Manual save",
    autoSaved: false,
  });

  // 2. Automatic re-scan encounters post
  const updated = await savePost({
    id: "p200",
    text: "Manual save post",
    topics: ["Physics"],
    saveReason: "Matched topic: Physics",
    autoSaved: true,
  });

  // Must preserve autoSaved: false and original manual saveReason
  assert.equal(updated.autoSaved, false);
  assert.equal(updated.saveReason, "Manual save");
});

test("Saved Posts Store - Filtering by topic and search", async () => {
  storageMock = {};

  await savePostsBatch([
    { id: "a1", text: "AI advancements in 2026", author: "Charlie", topics: ["AI", "NLP"], savedAt: 1000 },
    { id: "a2", text: "New 5G networks in Europe", author: "Diana", topics: ["5G", "Telecom"], savedAt: 2000 },
    { id: "a3", text: "Embedded Systems in Automotive", author: "Eve", topics: ["Embedded Systems", "Hardware"], savedAt: 3000 },
  ]);

  // Topic filter
  const aiPosts = await getSavedPosts({ topic: "AI" });
  assert.equal(aiPosts.length, 1);
  assert.equal(aiPosts[0].id, "a1");

  // Search filter
  const dianaPosts = await getSavedPosts({ search: "Diana" });
  assert.equal(dianaPosts.length, 1);
  assert.equal(dianaPosts[0].id, "a2");

  // Sorted desc by savedAt
  const all = await getSavedPosts();
  assert.equal(all.length, 3);
  assert.equal(all[0].id, "a3"); // 3000
  assert.equal(all[1].id, "a2"); // 2000
  assert.equal(all[2].id, "a1"); // 1000
});

test("Pipeline Integration - classification -> topics -> save rule evaluation -> persistence", async () => {
  storageMock = {};
  const { evaluateSaveRules } = await import("../src/rules/save-rule-engine.js");

  const classificationResult = {
    id: "urn:li:activity:9999",
    hide: false,
    reason: "Great technical post",
    topics: ["5G", "Signal Processing"],
  };

  const rawPost = {
    id: "urn:li:activity:9999",
    text: "Deep dive into 5G NR signal processing and beamforming algorithms.",
    author: "Dr. Claude Shannon",
    authorUrl: "https://linkedin.com/in/claude-shannon",
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:9999",
  };

  const userSaveRules = "AI, 5G, Embedded Systems";

  // 1. Evaluate save rules against extracted topics
  const saveDecision = evaluateSaveRules(classificationResult.topics, userSaveRules);
  assert.equal(saveDecision.shouldSave, true);
  assert.equal(saveDecision.saveReason, "Matched topic: 5G");

  // 2. Persist post
  await savePost({
    id: rawPost.id,
    text: rawPost.text,
    author: rawPost.author,
    authorUrl: rawPost.authorUrl,
    postUrl: rawPost.postUrl,
    topics: classificationResult.topics,
    saveReason: saveDecision.saveReason,
    autoSaved: true,
  });

  // 3. Verify in Second Brain store
  const saved = await getSavedPosts();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, "urn:li:activity:9999");
  assert.equal(saved[0].author, "Dr. Claude Shannon");
  assert.deepEqual(saved[0].topics, ["5G", "Signal Processing"]);
  assert.equal(saved[0].saveReason, "Matched topic: 5G");
  assert.equal(saved[0].autoSaved, true);
});

test("Saved Posts Store - Invariant: Rejects dangerous URL schemes and validates URLs", async () => {
  storageMock = {};

  const post = await savePost({
    id: "sec-1",
    text: "Security test",
    author: "Hacker",
    authorUrl: "javascript:alert(1)",
    postUrl: "data:text/html,<script>alert(1)</script>",
    topics: ["Security"],
  });

  assert.equal(post.authorUrl, "");
  assert.equal(post.postUrl, "");

  const validPost = await savePost({
    id: "sec-2",
    text: "Valid URLs",
    author: "Good Engineer",
    authorUrl: "https://www.linkedin.com/in/good-engineer",
    postUrl: "http://www.linkedin.com/feed/update/urn:li:activity:123",
    topics: ["Security"],
  });

  assert.equal(validPost.authorUrl, "https://www.linkedin.com/in/good-engineer");
  assert.equal(validPost.postUrl, "http://www.linkedin.com/feed/update/urn:li:activity:123");
});

test("Saved Posts Store - Invariant: Strict boolean autoSaved handling", async () => {
  storageMock = {};

  const p1 = await savePost({ id: "b1", text: "t", autoSaved: true });
  const p2 = await savePost({ id: "b2", text: "t", autoSaved: "true" });
  const p3 = await savePost({ id: "b3", text: "t", autoSaved: 1 });
  const p4 = await savePost({ id: "b4", text: "t", autoSaved: false });
  const p5 = await savePost({ id: "b5", text: "t", autoSaved: "false" });
  const p6 = await savePost({ id: "b6", text: "t", autoSaved: null });

  assert.equal(p1.autoSaved, true);
  assert.equal(p2.autoSaved, false);
  assert.equal(p3.autoSaved, false);
  assert.equal(p4.autoSaved, false);
  assert.equal(p5.autoSaved, false);
  assert.equal(p6.autoSaved, false);
});

test("Saved Posts Store - Invariant: Enforces 4000 character maximum on post text", async () => {
  storageMock = {};

  const longText = "A".repeat(6000);
  const post = await savePost({
    id: "len-1",
    text: longText,
    topics: ["Text"],
  });

  assert.equal(post.text.length, 4000);
  assert.equal(post.text, "A".repeat(4000));
});
