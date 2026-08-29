// test/lifecycle-hardening.test.js
// Production hardening, lifecycle boundaries, memory invariants, and failure mode regression tests.

import test from "node:test";
import assert from "node:assert/strict";
import { GraphRenderer } from "../src/graph/graph-renderer.js";
import {
  buildKnowledgeGraph,
  filterPostsByTopics,
  filterPostsByAuthors,
  filterGraphByNodeTypes,
  areGraphsEqual,
} from "../src/graph/graph-builder.js";
import { openExtensionPage, getCanonicalRelativePath } from "../src/navigation/navigation.js";
import { logger, isDebugEnabled } from "../src/utils/logger.js";

function createMockCanvas() {
  const listeners = new Map();
  return {
    getContext: () => ({
      save: () => {},
      restore: () => {},
      scale: () => {},
      clearRect: () => {},
      translate: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      strokeText: () => {},
      fillText: () => {},
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
    removeEventListener: (event, handler) => {
      if (listeners.has(event)) {
        const arr = listeners.get(event).filter((h) => h !== handler);
        listeners.set(event, arr);
      }
    },
    _listeners: listeners,
    style: {},
  };
}

test("Lifecycle: GraphRenderer start() is idempotent and never creates multiple competing loops", () => {
  // Set up mock window and requestAnimationFrame
  let nextFrameId = 1;
  const activeFrames = new Set();
  const originalWindow = globalThis.window;
  const originalRAF = globalThis.requestAnimationFrame;
  const originalCAF = globalThis.cancelAnimationFrame;

  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    devicePixelRatio: 1,
  };
  globalThis.requestAnimationFrame = (cb) => {
    const id = nextFrameId++;
    activeFrames.add(id);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    activeFrames.delete(id);
  };

  try {
    const mockCanvas = createMockCanvas();
    const mockLayout = {
      nodes: [{ id: "1", x: 10, y: 10, type: "post" }],
      edges: [],
      width: 800,
      height: 600,
      tick: () => false, // keeps running
      reheat: () => {},
    };

    const renderer = new GraphRenderer(mockCanvas, mockLayout);

    // Initial state after constructor (resize calls requestRender)
    assert.equal(renderer.isRunning, true);
    assert.ok(renderer.animationFrameId !== null);
    const frameId1 = renderer.animationFrameId;

    // Repeated start calls must NOT spawn new animation loops
    renderer.start();
    renderer.start();
    renderer.start();

    assert.equal(renderer.isRunning, true);
    assert.equal(renderer.animationFrameId, frameId1);

    // Repeated stop calls
    renderer.stop();
    assert.equal(renderer.isRunning, false);
    assert.equal(renderer.animationFrameId, null);

    renderer.stop();
    renderer.stop();
    assert.equal(renderer.isRunning, false);
    assert.equal(renderer.animationFrameId, null);

    renderer.destroy();
  } finally {
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalRAF;
    globalThis.cancelAnimationFrame = originalCAF;
  }
});

test("Lifecycle: GraphRenderer destroy() cleanly unbinds event listeners and resets state", () => {
  const windowListeners = new Map();
  const originalWindow = globalThis.window;
  globalThis.window = {
    addEventListener: (event, handler) => {
      if (!windowListeners.has(event)) windowListeners.set(event, []);
      windowListeners.get(event).push(handler);
    },
    removeEventListener: (event, handler) => {
      if (windowListeners.has(event)) {
        const arr = windowListeners.get(event).filter((h) => h !== handler);
        windowListeners.set(event, arr);
      }
    },
    devicePixelRatio: 1,
  };

  try {
    const mockCanvas = createMockCanvas();
    const mockLayout = {
      nodes: [],
      edges: [],
      width: 800,
      height: 600,
      tick: () => true,
      reheat: () => {},
    };

    const renderer = new GraphRenderer(mockCanvas, mockLayout);
    assert.ok(mockCanvas._listeners.get("mousedown")?.length > 0);
    assert.ok(mockCanvas._listeners.get("click")?.length > 0);
    assert.ok(mockCanvas._listeners.get("wheel")?.length > 0);
    assert.ok(windowListeners.get("mousemove")?.length > 0);
    assert.ok(windowListeners.get("mouseup")?.length > 0);
    assert.ok(windowListeners.get("resize")?.length > 0);

    renderer.start();
    renderer.destroy();

    // Canvas listeners must be detached
    assert.equal(mockCanvas._listeners.get("mousedown")?.length || 0, 0);
    assert.equal(mockCanvas._listeners.get("click")?.length || 0, 0);
    assert.equal(mockCanvas._listeners.get("wheel")?.length || 0, 0);

    // Window listeners must be detached
    assert.equal(windowListeners.get("mousemove")?.length || 0, 0);
    assert.equal(windowListeners.get("mouseup")?.length || 0, 0);
    assert.equal(windowListeners.get("resize")?.length || 0, 0);

    assert.equal(renderer.isRunning, false);
    assert.equal(renderer.animationFrameId, null);
    assert.equal(renderer.hoveredNode, null);
    assert.equal(renderer.selectedNode, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("Memory Hot-Path: getConnectedNodeIds caches Set and avoids allocation on identical active node", () => {
  const mockCanvas = createMockCanvas();
  const mockLayout = {
    nodes: [{ id: "A" }, { id: "B" }, { id: "C" }],
    edges: [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
    ],
    width: 800,
    height: 600,
    tick: () => true,
    reheat: () => {},
  };

  const renderer = new GraphRenderer(mockCanvas, mockLayout);

  const nodeA = { id: "A" };
  const set1 = renderer.getConnectedNodeIds(nodeA);
  const set2 = renderer.getConnectedNodeIds(nodeA);

  // Exact reference equality -> zero new allocation on consecutive frames
  assert.equal(set1, set2);
  assert.equal(set1.size, 2); // A + B

  // Switching active node recalculates and updates cache
  const nodeB = { id: "B" };
  const setB = renderer.getConnectedNodeIds(nodeB);
  assert.notEqual(set1, setB);
  assert.equal(setB.size, 3); // B + A + C

  renderer.destroy();
});

test("Data Integrity: Filtering and graph building strictly preserve source immutability", () => {
  const originalPosts = [
    {
      id: "post:1",
      text: "Machine Learning with Rust and WebAssembly",
      author: "Alice Engineer",
      authorUrl: "https://linkedin.com/in/alice",
      topics: ["ML", "Rust", "Wasm"],
    },
    {
      id: "post:2",
      text: "Distributed consensus and storage engines",
      author: "Bob Architect",
      authorUrl: "https://linkedin.com/in/bob",
      topics: ["Systems", "Storage"],
    },
  ];

  const postsSnapshot = JSON.stringify(originalPosts);

  // 1. Build Knowledge Graph
  const graph1 = buildKnowledgeGraph(originalPosts);
  assert.equal(JSON.stringify(originalPosts), postsSnapshot, "buildKnowledgeGraph must not mutate input posts");

  // 2. Filter posts by topics
  const filteredTopics = filterPostsByTopics(originalPosts, ["ML"]);
  assert.equal(filteredTopics.length, 1);
  assert.equal(JSON.stringify(originalPosts), postsSnapshot, "filterPostsByTopics must not mutate input posts");

  // 3. Filter posts by authors
  const filteredAuthors = filterPostsByAuthors(originalPosts, ["Bob Architect"]);
  assert.equal(filteredAuthors.length, 1);
  assert.equal(JSON.stringify(originalPosts), postsSnapshot, "filterPostsByAuthors must not mutate input posts");

  // 4. Filter graph by node types
  const graphNodesSnapshot = JSON.stringify(graph1.nodes);
  const graphEdgesSnapshot = JSON.stringify(graph1.edges);
  const filteredGraph = filterGraphByNodeTypes(graph1, ["post", "topic"]);

  assert.equal(JSON.stringify(graph1.nodes), graphNodesSnapshot, "filterGraphByNodeTypes must not mutate source graph nodes");
  assert.equal(JSON.stringify(graph1.edges), graphEdgesSnapshot, "filterGraphByNodeTypes must not mutate source graph edges");
  assert.ok(filteredGraph.nodes.length < graph1.nodes.length);
});

test("Error Resilience: openExtensionPage handles missing chrome environment without throwing", async () => {
  // Test invalid key
  const invalidResult = await openExtensionPage("invalid_key_xyz");
  assert.equal(invalidResult, null);

  // Test canonical relative path fallback
  assert.equal(getCanonicalRelativePath(""), "");
  assert.equal(getCanonicalRelativePath(null), "");
  assert.equal(getCanonicalRelativePath(undefined), "");
  assert.equal(getCanonicalRelativePath(12345), "");
});

test("Logger: Diagnostic logging operates safely without errors", () => {
  // Verify logger methods execute cleanly
  assert.doesNotThrow(() => {
    logger.debug("TEST", "Debug message");
    logger.info("TEST", "Info message");
    logger.warn("TEST", "Warn message");
    logger.error("TEST", "Error message");
  });
  assert.equal(typeof isDebugEnabled(), "boolean");
});
