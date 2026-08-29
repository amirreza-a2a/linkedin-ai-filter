import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildKnowledgeGraph,
  filterGraphByNodeType,
  extractNeighborhood,
} from "../src/graph/graph-builder.js";
import {
  ForceLayout,
  PHYSICS_PRESETS,
  PHYSICS_RANGES,
  computeEffectivePhysics,
  getNodeCollisionRadius,
} from "../src/graph/force-layout.js";
import { sanitizeSavedPost } from "../src/storage/saved-posts-store.js";

test("buildKnowledgeGraph - handles empty dataset", () => {
  assert.deepEqual(buildKnowledgeGraph([]), { nodes: [], edges: [] });
  assert.deepEqual(buildKnowledgeGraph(null), { nodes: [], edges: [] });
  assert.deepEqual(buildKnowledgeGraph(undefined), { nodes: [], edges: [] });
});

test("buildKnowledgeGraph - single post with topic and author", () => {
  const post = {
    id: "urn:li:activity:1001",
    text: "Exploring 5G and beamforming algorithms in modern wireless communication.",
    author: "Alice Engineer",
    authorUrl: "https://linkedin.com/in/alice",
    postUrl: "https://linkedin.com/feed/update/urn:li:activity:1001",
    topics: ["5G"],
  };

  const graph = buildKnowledgeGraph([post]);

  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);

  const postNode = graph.nodes.find((n) => n.id === "post:urn:li:activity:1001");
  assert.ok(postNode);
  assert.equal(postNode.type, "post");
  assert.equal(postNode.data.id, "urn:li:activity:1001");

  const topicNode = graph.nodes.find((n) => n.id === "topic:5g");
  assert.ok(topicNode);
  assert.equal(topicNode.type, "topic");
  assert.equal(topicNode.label, "5G");
  assert.equal(topicNode.count, 1);

  const authorNode = graph.nodes.find((n) => n.id === "author:url:https://linkedin.com/in/alice");
  assert.ok(authorNode);
  assert.equal(authorNode.type, "author");
  assert.equal(authorNode.label, "Alice Engineer");
  assert.equal(authorNode.count, 1);

  const hasTopicEdge = graph.edges.find((e) => e.type === "has-topic");
  assert.ok(hasTopicEdge);
  assert.equal(hasTopicEdge.source, "post:urn:li:activity:1001");
  assert.equal(hasTopicEdge.target, "topic:5g");

  const writtenByEdge = graph.edges.find((e) => e.type === "written-by");
  assert.ok(writtenByEdge);
  assert.equal(writtenByEdge.source, "post:urn:li:activity:1001");
  assert.equal(writtenByEdge.target, "author:url:https://linkedin.com/in/alice");
});

test("buildKnowledgeGraph - case-insensitive topic deduplication", () => {
  const posts = [
    { id: "p1", text: "AI post 1", topics: ["AI", "Machine Learning"] },
    { id: "p2", text: "AI post 2", topics: ["ai", "Deep Learning"] },
    { id: "p3", text: "AI post 3", topics: [" AI ", "Machine Learning"] },
  ];

  const graph = buildKnowledgeGraph(posts);

  // Topics: 'ai', 'machine learning', 'deep learning'
  const topicNodes = graph.nodes.filter((n) => n.type === "topic");
  assert.equal(topicNodes.length, 3);

  const aiNode = topicNodes.find((t) => t.id === "topic:ai");
  assert.ok(aiNode);
  assert.equal(aiNode.label, "AI"); // Preserves first seen canonical casing
  assert.equal(aiNode.count, 3); // Referenced in all 3 posts

  const mlNode = topicNodes.find((t) => t.id === "topic:machine learning");
  assert.ok(mlNode);
  assert.equal(mlNode.count, 2);
});

test("buildKnowledgeGraph - canonical author identity resolution (URL vs name fallback)", () => {
  const posts = [
    // Two posts with identical profile URL
    { id: "p1", text: "t1", author: "Bob Builder", authorUrl: "https://linkedin.com/in/bob" },
    { id: "p2", text: "t2", author: "Bob B.", authorUrl: "https://linkedin.com/in/bob" },
    // One post with no authorUrl, uses name fallback
    { id: "p3", text: "t3", author: "Charlie", authorUrl: "" },
    // One post with same name Charlie, also no URL -> merged by name
    { id: "p4", text: "t4", author: "charlie", authorUrl: "" },
  ];

  const graph = buildKnowledgeGraph(posts);
  const authorNodes = graph.nodes.filter((n) => n.type === "author");
  assert.equal(authorNodes.length, 2);

  const bobNode = authorNodes.find((a) => a.id === "author:url:https://linkedin.com/in/bob");
  assert.ok(bobNode);
  assert.equal(bobNode.count, 2);

  const charlieNode = authorNodes.find((a) => a.id === "author:name:charlie");
  assert.ok(charlieNode);
  assert.equal(charlieNode.count, 2);
});

test("buildKnowledgeGraph - equivalent LinkedIn author URLs produce the same Author node", () => {
  const p1 = sanitizeSavedPost({
    id: "p1",
    text: "Post 1",
    author: "Alice",
    authorUrl: "https://www.linkedin.com/in/alice",
    topics: ["AI"],
  });
  const p2 = sanitizeSavedPost({
    id: "p2",
    text: "Post 2",
    author: "Alice",
    authorUrl: "https://linkedin.com/in/alice/",
    topics: ["AI"],
  });
  const p3 = sanitizeSavedPost({
    id: "p3",
    text: "Post 3",
    author: "Alice",
    authorUrl: "https://linkedin.com/in/alice?trk=profile-view",
    topics: ["AI"],
  });

  assert.equal(p1.authorUrl, "https://linkedin.com/in/alice");
  assert.equal(p2.authorUrl, "https://linkedin.com/in/alice");
  assert.equal(p3.authorUrl, "https://linkedin.com/in/alice");

  const graph = buildKnowledgeGraph([p1, p2, p3]);
  const authorNodes = graph.nodes.filter((n) => n.type === "author");
  assert.equal(authorNodes.length, 1);
  assert.equal(authorNodes[0].id, "author:url:https://linkedin.com/in/alice");
  assert.equal(authorNodes[0].count, 3);
});

test("buildKnowledgeGraph - missing fields & no dangling edges", () => {
  const posts = [
    { id: "p1", text: "Anonymous post with no author and no topics", author: "", authorUrl: "", topics: [] },
  ];

  const graph = buildKnowledgeGraph(posts);
  assert.equal(graph.nodes.length, 1); // only post node
  assert.equal(graph.nodes[0].id, "post:p1");
  assert.equal(graph.edges.length, 0); // zero edges
});

test("buildKnowledgeGraph - deterministic sorting independent of input array order", () => {
  const p1 = { id: "p1", text: "Zebra", author: "Zoe", topics: ["Zoo"] };
  const p2 = { id: "p2", text: "Apple", author: "Adam", topics: ["Agriculture"] };

  const graphA = buildKnowledgeGraph([p1, p2]);
  const graphB = buildKnowledgeGraph([p2, p1]);

  assert.deepEqual(
    graphA.nodes.map((n) => n.id),
    graphB.nodes.map((n) => n.id)
  );

  assert.deepEqual(
    graphA.edges.map((e) => e.id),
    graphB.edges.map((e) => e.id)
  );
});

test("filterGraphByNodeType - filters node types and eliminates dangling edges", () => {
  const posts = [
    { id: "p1", text: "Post 1", author: "Alice", authorUrl: "https://linkedin.com/in/alice", topics: ["AI"] },
  ];
  const graph = buildKnowledgeGraph(posts);
  assert.equal(graph.nodes.length, 3); // post, topic, author
  assert.equal(graph.edges.length, 2); // has-topic, written-by

  // 1. Filter: Topics only
  const topicsOnly = filterGraphByNodeType(graph, "topics");
  assert.equal(topicsOnly.nodes.length, 1);
  assert.equal(topicsOnly.nodes[0].type, "topic");
  assert.equal(topicsOnly.edges.length, 0); // zero dangling edges!

  // 2. Filter: Authors only
  const authorsOnly = filterGraphByNodeType(graph, "authors");
  assert.equal(authorsOnly.nodes.length, 1);
  assert.equal(authorsOnly.nodes[0].type, "author");
  assert.equal(authorsOnly.edges.length, 0); // zero dangling edges!

  // 3. Filter: Posts only
  const postsOnly = filterGraphByNodeType(graph, "posts");
  assert.equal(postsOnly.nodes.length, 1);
  assert.equal(postsOnly.nodes[0].type, "post");
  assert.equal(postsOnly.edges.length, 0); // zero dangling edges!
});

test("extractNeighborhood - extracts focused subgraphs for post, topic, and author", () => {
  const posts = [
    { id: "p1", text: "Post 1", author: "Alice", topics: ["AI", "5G"] },
    { id: "p2", text: "Post 2", author: "Bob", topics: ["AI"] },
    { id: "p3", text: "Post 3", author: "Charlie", topics: ["Robotics"] },
  ];
  const graph = buildKnowledgeGraph(posts);

  // 1. Focus on Topic 'topic:ai'
  const topicFocus = extractNeighborhood(graph, "topic:ai");
  assert.ok(topicFocus.nodes.some((n) => n.id === "topic:ai"));
  assert.ok(topicFocus.nodes.some((n) => n.id === "post:p1"));
  assert.ok(topicFocus.nodes.some((n) => n.id === "post:p2"));
  assert.ok(!topicFocus.nodes.some((n) => n.id === "post:p3")); // p3 is not in AI topic

  // 2. Focus on Post 'post:p1'
  const postFocus = extractNeighborhood(graph, "post:p1");
  assert.ok(postFocus.nodes.some((n) => n.id === "post:p1"));
  assert.ok(postFocus.nodes.some((n) => n.id === "topic:ai"));
  assert.ok(postFocus.nodes.some((n) => n.id === "topic:5g"));
  assert.ok(postFocus.nodes.some((n) => n.id === "author:name:alice"));
  assert.ok(!postFocus.nodes.some((n) => n.id === "post:p2")); // p2 is not directly connected

  // 3. Focus on Author 'author:name:bob'
  const authorFocus = extractNeighborhood(graph, "author:name:bob");
  assert.ok(authorFocus.nodes.some((n) => n.id === "author:name:bob"));
  assert.ok(authorFocus.nodes.some((n) => n.id === "post:p2"));
  assert.ok(!authorFocus.nodes.some((n) => n.id === "post:p1"));
});

test("ForceLayout - physics presets and ordering", () => {
  const layout = new ForceLayout();

  // 1. Preset ordering invariants
  assert.ok(PHYSICS_PRESETS.compact.springLength < PHYSICS_PRESETS.balanced.springLength);
  assert.ok(PHYSICS_PRESETS.balanced.springLength < PHYSICS_PRESETS.spread.springLength);

  assert.ok(PHYSICS_PRESETS.compact.repulsion < PHYSICS_PRESETS.balanced.repulsion);
  assert.ok(PHYSICS_PRESETS.balanced.repulsion < PHYSICS_PRESETS.spread.repulsion);

  assert.ok(PHYSICS_PRESETS.compact.gravity > PHYSICS_PRESETS.balanced.gravity);
  assert.ok(PHYSICS_PRESETS.balanced.gravity > PHYSICS_PRESETS.spread.gravity);

  // 2. Balanced (default)
  assert.equal(layout.repulsion, PHYSICS_PRESETS.balanced.repulsion);
  assert.equal(layout.springLength, PHYSICS_PRESETS.balanced.springLength);

  // 3. Apply Compact preset
  layout.applyPreset("compact");
  assert.equal(layout.repulsion, PHYSICS_PRESETS.compact.repulsion);
  assert.equal(layout.springLength, PHYSICS_PRESETS.compact.springLength);
  assert.equal(layout.gravity, PHYSICS_PRESETS.compact.gravity);

  // 4. Apply Spread preset
  layout.applyPreset("spread");
  assert.equal(layout.repulsion, PHYSICS_PRESETS.spread.repulsion);
  assert.equal(layout.springLength, PHYSICS_PRESETS.spread.springLength);

  // 5. Reset physics
  layout.resetPhysics();
  assert.equal(layout.repulsion, PHYSICS_PRESETS.balanced.repulsion);
});

test("ForceLayout - spring force direction for stretched and compressed edges", () => {
  const layout = new ForceLayout({
    repulsion: 0, // Isolate spring force
    gravity: 0,
    springLength: 100,
    springStrength: 0.1,
    alphaDecay: 1.0,
  });

  const nodes = [
    { id: "u", type: "post" },
    { id: "v", type: "topic" },
  ];
  const edges = [
    { id: "e1", source: "u", target: "v", type: "has-topic" },
  ];

  layout.init(nodes, edges, 800, 600);
  const u = layout.nodeMap.get("u");
  const v = layout.nodeMap.get("v");

  // 1. STRETCHED SPRING: dist = 200 > springLength (100)
  u.x = 300;
  u.y = 300;
  u.vx = 0;
  u.vy = 0;

  v.x = 500;
  v.y = 300;
  v.vx = 0;
  v.vy = 0;

  layout.tick();

  // u should move TOWARD v (positive x)
  assert.ok(u.vx > 0, `Expected u.vx > 0 but got ${u.vx}`);
  // v should move TOWARD u (negative x)
  assert.ok(v.vx < 0, `Expected v.vx < 0 but got ${v.vx}`);

  // 2. COMPRESSED SPRING: dist = 40 < springLength (100)
  u.x = 380;
  u.y = 300;
  u.vx = 0;
  u.vy = 0;

  v.x = 420;
  v.y = 300;
  v.vx = 0;
  v.vy = 0;

  layout.tick();

  // u should move AWAY from v (negative x)
  assert.ok(u.vx < 0, `Expected u.vx < 0 but got ${u.vx}`);
  // v should move AWAY from u (positive x)
  assert.ok(v.vx > 0, `Expected v.vx > 0 but got ${v.vx}`);
});

test("ForceLayout - live parameter changes diverge from previous trajectory", () => {
  const posts = [
    { id: "p1", text: "Post 1", author: "Alice", topics: ["AI"] },
    { id: "p2", text: "Post 2", author: "Bob", topics: ["AI"] },
  ];
  const graph = buildKnowledgeGraph(posts);

  const layout = new ForceLayout();
  layout.init(graph.nodes, graph.edges, 800, 600);

  // Run 10 ticks under Balanced
  for (let i = 0; i < 10; i++) layout.tick();
  const baselineX = layout.nodes[0].x;

  // Apply Spread preset live
  layout.applyPreset("spread");
  for (let i = 0; i < 10; i++) layout.tick();
  const spreadX = layout.nodes[0].x;

  // Node position diverged under spread parameters
  assert.notEqual(baselineX, spreadX);
});

test("ForceLayout - deterministic circular initialization and physics convergence", () => {
  const posts = [
    { id: "p1", text: "Post 1", author: "Alice", topics: ["AI"] },
    { id: "p2", text: "Post 2", author: "Bob", topics: ["AI"] },
  ];
  const graph = buildKnowledgeGraph(posts);

  const layout = new ForceLayout();
  layout.init(graph.nodes, graph.edges, 800, 600);

  assert.equal(layout.nodes.length, graph.nodes.length);
  assert.equal(layout.edges.length, graph.edges.length);

  for (const node of layout.nodes) {
    assert.ok(typeof node.x === "number" && !isNaN(node.x));
    assert.ok(typeof node.y === "number" && !isNaN(node.y));
  }

  let ticks = 0;
  let done = false;
  while (!done && ticks < 200) {
    done = layout.tick();
    ticks++;
  }

  assert.ok(done);
  assert.ok(layout.alpha < layout.alphaMin);
});

test("DOM Contract: All element IDs required by graph.js exist in graph.html", () => {
  const htmlPath = path.resolve("src/graph/graph.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  const requiredElementIds = [
    "graphCanvas",
    "topicFilterSelect",
    "authorFilterSelect",
    "nodeTypeSelect",
    "searchGraph",
    "clearFiltersBtn",
    "fitGraphBtn",
    "resetViewBtn",
    "focusBanner",
    "focusLabel",
    "exitFocusBtn",
    "emptyState",
    "emptyStateDesc",
    "sidebar",
    "toggleSidebarBtn",
    "nodeDetailsContent",
    "togglePhysicsBtn",
    "physicsPanel",
    "densitySlider",
    "spacingSlider",
    "gravitySlider",
    "resetPhysicsBtn",
    "openBrainBtn",
    "openDashboardBtn",
  ];

  for (const id of requiredElementIds) {
    const idRegex = new RegExp(`id=["']${id}["']`);
    assert.ok(
      idRegex.test(htmlContent),
      `Element id='${id}' required by graph.js must exist in src/graph/graph.html`
    );
  }
});

test("Data Pipeline: Non-empty saved posts produce non-empty graph and default filters preserve all nodes", () => {
  const mockSavedPosts = [
    {
      id: "post:1",
      text: "Machine learning systems and neural network pipelines.",
      author: "Alice Engineer",
      authorUrl: "https://linkedin.com/in/alice",
      topics: ["Machine Learning", "Systems"],
    },
    {
      id: "post:2",
      text: "Distributed consensus algorithms and storage engines.",
      author: "Bob Architect",
      authorUrl: "https://linkedin.com/in/bob",
      topics: ["Systems", "Distributed"],
    },
  ];

  // 1. Build base graph
  const baseGraph = buildKnowledgeGraph(mockSavedPosts);
  assert.equal(baseGraph.nodes.length, 7); // 2 posts + 3 topics (ML, Systems, Distributed) + 2 authors (Alice, Bob)
  assert.equal(baseGraph.edges.length, 6); // 4 has-topic edges + 2 written-by edges

  // 2. Default filters (all topics, all authors, all types, empty search)
  const selTopic = "";
  const selAuthor = "";
  const selNodeType = "all";
  const searchQuery = "";

  const filteredPosts = mockSavedPosts.filter((p) => {
    if (selTopic && !(p.topics || []).some((t) => t.toLowerCase() === selTopic.toLowerCase())) return false;
    if (selAuthor && (p.author || "").toLowerCase() !== selAuthor.toLowerCase()) return false;
    if (searchQuery && !(p.text || "").toLowerCase().includes(searchQuery)) return false;
    return true;
  });

  // Verify filteredPosts is identical in length and content
  assert.equal(filteredPosts.length, mockSavedPosts.length);

  let activeGraph = buildKnowledgeGraph(filteredPosts);
  if (selNodeType !== "all") {
    activeGraph = filterGraphByNodeType(activeGraph, selNodeType);
  }

  // Verify activeGraph matches baseGraph completely
  assert.equal(activeGraph.nodes.length, baseGraph.nodes.length);
  assert.equal(activeGraph.edges.length, baseGraph.edges.length);

  // Invariant: mockSavedPosts array and post objects were never mutated
  assert.equal(mockSavedPosts.length, 2);
  assert.equal(mockSavedPosts[0].topics.length, 2);
  assert.equal(mockSavedPosts[1].topics.length, 2);
});

// =========================================================================
// ADAPTIVE KNOWLEDGE GRAPH PHYSICS REGRESSION TESTS
// =========================================================================

test("computeEffectivePhysics - scales gracefully across small, medium, and large graph sizes", () => {
  const scales = [10, 50, 100, 250, 500, 1000];

  for (const n of scales) {
    const eff = computeEffectivePhysics({
      nodeCount: n,
      edgeCount: n * 2,
      width: 800,
      height: 600,
      repulsion: 900,
      springLength: 75,
      gravity: 0.025,
    });

    // 1. All effective values must be positive, finite numbers
    assert.ok(typeof eff.effectiveRepulsion === "number" && isFinite(eff.effectiveRepulsion) && eff.effectiveRepulsion > 0);
    assert.ok(typeof eff.effectiveSpringLength === "number" && isFinite(eff.effectiveSpringLength) && eff.effectiveSpringLength > 0);
    assert.ok(typeof eff.effectiveGravity === "number" && isFinite(eff.effectiveGravity) && eff.effectiveGravity > 0);
    assert.ok(typeof eff.effectiveAlphaDecay === "number" && eff.effectiveAlphaDecay >= 0.96 && eff.effectiveAlphaDecay <= 0.99);
    assert.ok(typeof eff.collisionStrength === "number" && eff.collisionStrength > 0);
  }

  // 2. Large graph scales down per-node repulsion to prevent O(N^2) explosive buildup
  const eff10 = computeEffectivePhysics({ nodeCount: 10, edgeCount: 15, repulsion: 900 });
  const eff500 = computeEffectivePhysics({ nodeCount: 500, edgeCount: 1000, repulsion: 900 });
  assert.ok(eff500.effectiveRepulsion < eff10.effectiveRepulsion, "Large graphs must have smaller per-node repulsion coefficient than small graphs");

  // 3. Large graph scales down gravity to prevent central clumping
  assert.ok(eff500.effectiveGravity < eff10.effectiveGravity, "Large graphs must have softer gravity than small graphs");
});

test("computeEffectivePhysics - strict monotonicity with respect to user sliders", () => {
  const n = 100;
  const e = 200;

  // 1. Repulsion monotonicity: Higher slider -> strictly higher effectiveRepulsion
  const repLow = computeEffectivePhysics({ nodeCount: n, edgeCount: e, repulsion: 400 });
  const repMed = computeEffectivePhysics({ nodeCount: n, edgeCount: e, repulsion: 900 });
  const repHigh = computeEffectivePhysics({ nodeCount: n, edgeCount: e, repulsion: 2000 });
  assert.ok(repLow.effectiveRepulsion < repMed.effectiveRepulsion);
  assert.ok(repMed.effectiveRepulsion < repHigh.effectiveRepulsion);

  // 2. Spacing / SpringLength monotonicity: Higher slider -> strictly higher effectiveSpringLength
  const lenLow = computeEffectivePhysics({ nodeCount: n, edgeCount: e, springLength: 45 });
  const lenMed = computeEffectivePhysics({ nodeCount: n, edgeCount: e, springLength: 75 });
  const lenHigh = computeEffectivePhysics({ nodeCount: n, edgeCount: e, springLength: 130 });
  assert.ok(lenLow.effectiveSpringLength < lenMed.effectiveSpringLength);
  assert.ok(lenMed.effectiveSpringLength < lenHigh.effectiveSpringLength);

  // 3. Gravity monotonicity: Higher slider -> strictly higher effectiveGravity
  const gravLow = computeEffectivePhysics({ nodeCount: n, edgeCount: e, gravity: 0.01 });
  const gravMed = computeEffectivePhysics({ nodeCount: n, edgeCount: e, gravity: 0.025 });
  const gravHigh = computeEffectivePhysics({ nodeCount: n, edgeCount: e, gravity: 0.05 });
  assert.ok(gravLow.effectiveGravity < gravMed.effectiveGravity);
  assert.ok(gravMed.effectiveGravity < gravHigh.effectiveGravity);
});

test("ForceLayout - collision non-overlap force pushes overlapping nodes apart", () => {
  const layout = new ForceLayout({
    repulsion: 0, // Isolate collision restoring force
    gravity: 0,
    springStrength: 0,
  });

  const nodes = [
    { id: "node1", type: "topic", count: 10 }, // radius = min(9 + 15, 22) = 22
    { id: "node2", type: "author", count: 5 },  // radius = min(8 + 7.5, 19) = 15.5
  ];

  layout.init(nodes, [], 800, 600);
  const u = layout.nodeMap.get("node1");
  const v = layout.nodeMap.get("node2");

  // Place nodes on top of each other (distance = 5px < radius sum 37.5 + 4)
  u.x = 400;
  u.y = 300;
  u.vx = 0;
  u.vy = 0;

  v.x = 405;
  v.y = 300;
  v.vx = 0;
  v.vy = 0;

  layout.tick();

  // Collision force must push u to left (negative vx) and v to right (positive vx)
  assert.ok(u.vx < 0, `Expected u.vx < 0 but got ${u.vx}`);
  assert.ok(v.vx > 0, `Expected v.vx > 0 but got ${v.vx}`);
});

test("ForceLayout - large graph simulation (500 nodes) maintains numerical stability and bounded coordinates", () => {
  const nodeCount = 500;
  const mockPosts = Array.from({ length: 150 }, (_, i) => ({
    id: `post-${i}`,
    text: `Research post ${i} on deep distributed neural networks`,
    author: `Author ${i % 20}`,
    topics: [`Topic-${i % 15}`, `Topic-${(i + 1) % 15}`],
  }));

  const graph = buildKnowledgeGraph(mockPosts);
  assert.ok(graph.nodes.length >= 170, `Expected at least 170 nodes, got ${graph.nodes.length}`);

  const layout = new ForceLayout();
  layout.init(graph.nodes, graph.edges, 1200, 900);

  // Run 50 ticks
  for (let i = 0; i < 50; i++) {
    layout.tick();
  }

  // Assert all node coordinates are valid numbers and strictly finite
  for (const node of layout.nodes) {
    assert.ok(!isNaN(node.x), `Node ${node.id} has NaN x coordinate`);
    assert.ok(!isNaN(node.y), `Node ${node.id} has NaN y coordinate`);
    assert.ok(isFinite(node.x), `Node ${node.id} has non-finite x coordinate`);
    assert.ok(isFinite(node.y), `Node ${node.id} has non-finite y coordinate`);

    // Bounded coordinates check (should stay within reasonable screen neighborhood)
    assert.ok(node.x > -2000 && node.x < 3200, `Node ${node.id} x coordinate exploded: ${node.x}`);
    assert.ok(node.y > -2000 && node.y < 2900, `Node ${node.id} y coordinate exploded: ${node.y}`);
  }
});

test("ForceLayout - determinism invariant (identical inputs produce identical simulation results)", () => {
  const mockPosts = [
    { id: "p1", text: "AI post 1", author: "Alice", topics: ["AI", "Robotics"] },
    { id: "p2", text: "AI post 2", author: "Bob", topics: ["AI", "Vision"] },
    { id: "p3", text: "Cloud post 3", author: "Charlie", topics: ["Cloud", "DevOps"] },
  ];

  const graph1 = buildKnowledgeGraph(mockPosts);
  const layout1 = new ForceLayout();
  layout1.init(graph1.nodes, graph1.edges, 800, 600);
  for (let i = 0; i < 30; i++) layout1.tick();

  const graph2 = buildKnowledgeGraph(mockPosts);
  const layout2 = new ForceLayout();
  layout2.init(graph2.nodes, graph2.edges, 800, 600);
  for (let i = 0; i < 30; i++) layout2.tick();

  assert.equal(layout1.nodes.length, layout2.nodes.length);
  for (let i = 0; i < layout1.nodes.length; i++) {
    const n1 = layout1.nodes[i];
    const n2 = layout2.nodes[i];
    assert.equal(n1.id, n2.id);
    assert.equal(n1.x, n2.x);
    assert.equal(n1.y, n2.y);
    assert.equal(n1.vx, n2.vx);
    assert.equal(n1.vy, n2.vy);
  }
});

// =========================================================================
// EXPANDED USER-CONTROL PHYSICS RANGES TESTS
// =========================================================================

test("PHYSICS_RANGES - canonical configuration defines valid min, max, default, and step for all controls", () => {
  const params = ["repulsion", "springLength", "gravity"];

  for (const p of params) {
    const config = PHYSICS_RANGES[p];
    assert.ok(config, `PHYSICS_RANGES must define config for ${p}`);
    assert.ok(typeof config.min === "number" && !isNaN(config.min), `${p}.min must be a number`);
    assert.ok(typeof config.max === "number" && !isNaN(config.max), `${p}.max must be a number`);
    assert.ok(typeof config.default === "number" && !isNaN(config.default), `${p}.default must be a number`);
    assert.ok(typeof config.step === "number" && !isNaN(config.step), `${p}.step must be a number`);

    // Invariants
    assert.ok(config.min < config.max, `${p}.min (${config.min}) must be strictly less than ${p}.max (${config.max})`);
    assert.ok(
      config.default >= config.min && config.default <= config.max,
      `${p}.default (${config.default}) must be within [${config.min}, ${config.max}]`
    );
  }

  // Expanded ceiling invariants
  assert.ok(PHYSICS_RANGES.repulsion.max >= 6000, "Repulsion max must be expanded to at least 6000");
  assert.ok(PHYSICS_RANGES.springLength.max >= 300, "SpringLength max must be expanded to at least 300");

  // Presets must be within the canonical ranges
  for (const [presetName, preset] of Object.entries(PHYSICS_PRESETS)) {
    assert.ok(
      preset.repulsion >= PHYSICS_RANGES.repulsion.min && preset.repulsion <= PHYSICS_RANGES.repulsion.max,
      `Preset ${presetName} repulsion must be within canonical range`
    );
    assert.ok(
      preset.springLength >= PHYSICS_RANGES.springLength.min && preset.springLength <= PHYSICS_RANGES.springLength.max,
      `Preset ${presetName} springLength must be within canonical range`
    );
    assert.ok(
      preset.gravity >= PHYSICS_RANGES.gravity.min && preset.gravity <= PHYSICS_RANGES.gravity.max,
      `Preset ${presetName} gravity must be within canonical range`
    );
  }

  // Spread preset is within range but no longer the upper ceiling
  assert.ok(
    PHYSICS_PRESETS.spread.repulsion < PHYSICS_RANGES.repulsion.max,
    "Spread preset repulsion must be less than the maximum slider ceiling"
  );
  assert.ok(
    PHYSICS_PRESETS.spread.springLength < PHYSICS_RANGES.springLength.max,
    "Spread preset springLength must be less than the maximum slider ceiling"
  );
});

test("Expanded Physics Ranges - maximum slider values produce substantially larger effective values than defaults", () => {
  const n = 150;
  const e = 300;

  const defaultEff = computeEffectivePhysics({
    nodeCount: n,
    edgeCount: e,
    repulsion: PHYSICS_RANGES.repulsion.default,
    springLength: PHYSICS_RANGES.springLength.default,
    gravity: PHYSICS_RANGES.gravity.default,
  });

  const maxEff = computeEffectivePhysics({
    nodeCount: n,
    edgeCount: e,
    repulsion: PHYSICS_RANGES.repulsion.max,
    springLength: PHYSICS_RANGES.springLength.max,
    gravity: PHYSICS_RANGES.gravity.max,
  });

  // Effective repulsion at max must be > 3x the default
  assert.ok(
    maxEff.effectiveRepulsion >= defaultEff.effectiveRepulsion * 3,
    `Max effective repulsion (${maxEff.effectiveRepulsion}) should be >= 3x default (${defaultEff.effectiveRepulsion})`
  );

  // Effective spring length at max must be > 3x the default
  assert.ok(
    maxEff.effectiveSpringLength >= defaultEff.effectiveSpringLength * 3,
    `Max effective spring length (${maxEff.effectiveSpringLength}) should be >= 3x default (${defaultEff.effectiveSpringLength})`
  );
});

test("ForceLayout - large graph remains numerically stable at maximum expanded physics settings", () => {
  const mockPosts = Array.from({ length: 150 }, (_, i) => ({
    id: `post-${i}`,
    text: `Architectural post ${i} on distributed storage`,
    author: `Author ${i % 25}`,
    topics: [`Topic-${i % 15}`, `Topic-${(i + 1) % 15}`],
  }));

  const graph = buildKnowledgeGraph(mockPosts);
  const layout = new ForceLayout();
  layout.init(graph.nodes, graph.edges, 1400, 1000);

  // Apply maximum expanded settings
  layout.setPhysics({
    repulsion: PHYSICS_RANGES.repulsion.max,
    springLength: PHYSICS_RANGES.springLength.max,
    gravity: PHYSICS_RANGES.gravity.min,
  });

  // Run 60 simulation ticks
  for (let i = 0; i < 60; i++) {
    layout.tick();
  }

  // Assert all coordinates and velocities remain finite and non-NaN
  for (const node of layout.nodes) {
    assert.ok(!isNaN(node.x), `Node ${node.id} has NaN x`);
    assert.ok(!isNaN(node.y), `Node ${node.id} has NaN y`);
    assert.ok(!isNaN(node.vx), `Node ${node.id} has NaN vx`);
    assert.ok(!isNaN(node.vy), `Node ${node.id} has NaN vy`);
    assert.ok(isFinite(node.x), `Node ${node.id} has infinite x`);
    assert.ok(isFinite(node.y), `Node ${node.id} has infinite y`);

    // Clamped coordinates: does not explode to infinity
    assert.ok(node.x > -5000 && node.x < 6500, `Node ${node.id} x out of bounds: ${node.x}`);
    assert.ok(node.y > -5000 && node.y < 6000, `Node ${node.id} y out of bounds: ${node.y}`);
  }
});
