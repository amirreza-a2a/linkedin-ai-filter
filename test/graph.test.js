import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  buildKnowledgeGraph,
  filterGraphByNodeType,
  extractNeighborhood,
} from "../src/graph/graph-builder.js";
import { ForceLayout, PHYSICS_PRESETS } from "../src/graph/force-layout.js";
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
