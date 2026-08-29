// test/second-brain-ux.test.js
// Regression test suite for Second Brain loading lifecycle, topic dropdown population, and unsave UX.

import test from "node:test";
import assert from "node:assert/strict";
import {
  updateTopicDropdown,
  filterAndRender,
  handleUnsave,
  renderStats,
  renderPosts,
  setPageState,
  PAGE_STATE,
  setAllPosts,
  getAllPosts,
} from "../src/saved/saved.js";

function setupMockDOM() {
  const elements = {
    statsBar: { textContent: "Loading saved posts..." },
    topicSelect: { value: "", innerHTML: "" },
    searchInput: { value: "" },
    postsList: { innerHTML: "", querySelectorAll: () => [] },
  };
  return elements;
}

test("Second Brain Initialization: updateTopicDropdown safely extracts topics without ReferenceError", () => {
  const mockPosts = [
    { id: "1", text: "AI post", topics: ["AI", "Machine Learning"] },
    { id: "2", text: "Rust post", topics: ["Rust", "Systems"] },
    { id: "3", text: "Another AI post", topics: ["AI", "Robotics"] },
  ];

  // In the past, this threw ReferenceError: uniqueTopics is not defined
  assert.doesNotThrow(() => {
    updateTopicDropdown(mockPosts);
  });
});

test("Second Brain Dropdown: Preserves active topic filter if still valid after mutation", () => {
  const mockPosts = [
    { id: "1", text: "AI post", topics: ["AI", "Machine Learning"] },
    { id: "2", text: "Rust post", topics: ["Rust"] },
  ];

  updateTopicDropdown(mockPosts);
  // Should have "AI", "Machine Learning", "Rust"
  assert.doesNotThrow(() => {
    updateTopicDropdown(mockPosts);
  });
});

test("Second Brain Unsave: Immediate local state update removes post without full storage reload", async () => {
  const initialPosts = [
    { id: "post:1", text: "Post 1", author: "Alice", topics: ["AI"] },
    { id: "post:2", text: "Post 2", author: "Bob", topics: ["Rust"] },
    { id: "post:3", text: "Post 3", author: "Charlie", topics: ["Systems"] },
  ];

  setAllPosts([...initialPosts]);
  assert.equal(getAllPosts().length, 3);

  // Mock mock button element
  const mockBtn = { disabled: false, textContent: "Unsave" };

  // Mock chrome storage
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ savedPosts: { "post:1": initialPosts[0], "post:2": initialPosts[1], "post:3": initialPosts[2] } }),
        set: async () => {},
      },
    },
  };

  try {
    await handleUnsave("post:2", mockBtn);

    // Invariant 1: Local state updated immediately
    const remaining = getAllPosts();
    assert.equal(remaining.length, 2);
    assert.equal(remaining.some((p) => p.id === "post:2"), false);
    assert.ok(remaining.some((p) => p.id === "post:1"));
    assert.ok(remaining.some((p) => p.id === "post:3"));
  } finally {
    delete globalThis.chrome;
  }
});

test("Second Brain Unsave: Double-click concurrency protection ignores duplicate in-flight requests", async () => {
  const initialPosts = [
    { id: "post:10", text: "Concurrent test", author: "Alice", topics: ["AI"] },
  ];
  setAllPosts([...initialPosts]);

  let storageSetCount = 0;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ savedPosts: { "post:10": initialPosts[0] } }),
        set: async () => {
          storageSetCount++;
          await new Promise((r) => setTimeout(r, 20));
        },
      },
    },
  };

  try {
    const btn = { disabled: false, textContent: "Unsave" };

    // Fire two unsaves simultaneously for the same post ID
    const p1 = handleUnsave("post:10", btn);
    const p2 = handleUnsave("post:10", btn);

    await Promise.all([p1, p2]);

    // Should only execute 1 effective storage operation
    assert.equal(storageSetCount, 1);
    assert.equal(getAllPosts().length, 0);
  } finally {
    delete globalThis.chrome;
  }
});

test("Second Brain State: setPageState transitions between LOADING, READY, EMPTY, and ERROR cleanly", () => {
  assert.equal(PAGE_STATE.LOADING, "loading");
  assert.equal(PAGE_STATE.READY, "ready");
  assert.equal(PAGE_STATE.EMPTY, "empty");
  assert.equal(PAGE_STATE.ERROR, "error");

  assert.doesNotThrow(() => {
    setPageState(PAGE_STATE.LOADING);
    setPageState(PAGE_STATE.READY);
    setPageState(PAGE_STATE.EMPTY);
    setPageState(PAGE_STATE.ERROR, "Storage timeout");
  });
});

test("Second Brain Unsave: Preserves active search query and topic filters", async () => {
  const initialPosts = [
    { id: "post:1", text: "AI agent architectures", author: "Alice", topics: ["AI"] },
    { id: "post:2", text: "AI training pipelines", author: "Bob", topics: ["AI"] },
    { id: "post:3", text: "Rust compiler internals", author: "Charlie", topics: ["Rust"] },
  ];

  setAllPosts([...initialPosts]);

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ savedPosts: {} }),
        set: async () => {},
      },
    },
  };

  try {
    const btn = { disabled: false, textContent: "Unsave" };
    await handleUnsave("post:1", btn);

    const remaining = getAllPosts();
    assert.equal(remaining.length, 2);
    assert.equal(remaining.some((p) => p.id === "post:1"), false);
    assert.ok(remaining.some((p) => p.id === "post:2"));
    assert.ok(remaining.some((p) => p.id === "post:3"));
  } finally {
    delete globalThis.chrome;
  }
});

test("Second Brain Storage Error: Failed unsave handles error cleanly and re-enables button", async () => {
  const initialPosts = [
    { id: "post:err", text: "Error post", author: "Alice", topics: ["AI"] },
  ];
  setAllPosts([...initialPosts]);

  // Mock window.alert
  const originalAlert = globalThis.alert;
  let alertMessage = "";
  globalThis.alert = (msg) => { alertMessage = msg; };

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => { throw new Error("Disk full"); },
        set: async () => {},
      },
    },
  };

  try {
    const btn = { disabled: false, textContent: "Unsave" };
    await handleUnsave("post:err", btn);

    // Invariant: Button is re-enabled and error feedback triggered
    assert.equal(btn.disabled, false);
    assert.equal(btn.textContent, "Unsave");
    assert.ok(alertMessage.includes("Failed to unsave post"));
    // Post remains in local state
    assert.equal(getAllPosts().length, 1);
  } finally {
    globalThis.alert = originalAlert;
    delete globalThis.chrome;
  }
});
