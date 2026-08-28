import test from "node:test";
import assert from "node:assert/strict";
import {
  savePost,
  savePostsBatch,
  unsavePost,
  getSavedPosts,
  clearSavedPosts,
  sanitizeSavedPost,
  sanitizeUrl,
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

  const postData = {
    id: "urn:li:activity:1001",
    text: "Building neural networks with WebGPU",
    author: "Alice Smith",
    authorUrl: "https://linkedin.com/in/alicesmith",
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:1001",
    topics: ["AI", "WebGPU"],
    saveReason: "Matched topic: AI",
    autoSaved: true,
  };

  // 1. Save post
  const saved = await savePost(postData);
  assert.equal(saved.id, postData.id);
  assert.equal(saved.author, "Alice Smith");
  assert.deepEqual(saved.topics, ["AI", "WebGPU"]);
  assert.ok(typeof saved.savedAt === "number");
  assert.ok(typeof saved.updatedAt === "number");

  // 2. Get saved posts
  let posts = await getSavedPosts();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, postData.id);

  // 3. Unsave post
  const removed = await unsavePost(postData.id);
  assert.equal(removed, true);

  posts = await getSavedPosts();
  assert.equal(posts.length, 0);
});

test("Saved Posts Store - Concurrent mutation serialization", async () => {
  storageMock = {};

  // Fire 10 concurrent saves
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      savePost({
        id: `post-${i}`,
        text: `Post content ${i}`,
        topics: [`Topic-${i}`],
        autoSaved: true,
      })
    );
  }

  await Promise.all(promises);

  const posts = await getSavedPosts();
  assert.equal(posts.length, 10);
  const ids = new Set(posts.map((p) => p.id));
  for (let i = 0; i < 10; i++) {
    assert.ok(ids.has(`post-${i}`));
  }
});

test("Saved Posts Store - Write deduplication on re-scans & savedAt preservation", async () => {
  storageMock = {};

  // 1. Initial save
  const first = await savePost({
    id: "p100",
    text: "Same content",
    author: "Bob",
    topics: ["AI"],
    autoSaved: true,
  });

  const originalSavedAt = first.savedAt;
  const originalUpdatedAt = first.updatedAt;

  // Wait a tiny fraction of time to ensure clock could advance
  await new Promise((r) => setTimeout(r, 10));

  // 2. Re-scan with identical content -> should deduplicate and return unmodified existing record
  const second = await savePost({
    id: "p100",
    text: "Same content",
    author: "Bob",
    topics: ["ai"], // case-insensitive topic equality
    autoSaved: true,
  });

  assert.equal(second.savedAt, originalSavedAt);
  assert.equal(second.updatedAt, originalUpdatedAt);

  // 3. Re-scan with altered topics -> should update record and bump updatedAt
  const third = await savePost({
    id: "p100",
    text: "Same content",
    author: "Bob",
    topics: ["AI", "Semiconductors"],
    autoSaved: true,
  });

  assert.equal(third.savedAt, originalSavedAt); // savedAt preserved
  assert.ok(third.updatedAt >= originalUpdatedAt);
  assert.deepEqual(third.topics, ["AI", "Semiconductors"]);
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
    authorUrl: "https://www.linkedin.com/in/good-engineer?trk=profile-view",
    postUrl: "http://www.linkedin.com/feed/update/urn:li:activity:123/",
    topics: ["Security"],
  });

  assert.equal(validPost.authorUrl, "https://linkedin.com/in/good-engineer");
  assert.equal(validPost.postUrl, "http://linkedin.com/feed/update/urn:li:activity:123");
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
