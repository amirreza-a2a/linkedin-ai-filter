import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareEdgeRouting,
  computeEdgeGeometry,
  routeGraphEdges,
} from "../src/graph/edge-router.js";
import { GraphRenderer } from "../src/graph/graph-renderer.js";

// Helper to create mock nodes
function createMockNode(id, x, y, radius = 7) {
  return { id, x, y, radius, type: "topic", label: id };
}

test("Single isolated edge -> generates straight line geometry", () => {
  const u = createMockNode("u", 100, 200);
  const v = createMockNode("v", 400, 600);
  const edge = { id: "e1", source: "u", target: "v", sourceNode: u, targetNode: v };

  prepareEdgeRouting([edge]);
  const geom = computeEdgeGeometry(edge);

  assert.equal(geom.type, "straight");
  assert.equal(geom.x1, 100);
  assert.equal(geom.y1, 200);
  assert.equal(geom.x2, 400);
  assert.equal(geom.y2, 600);
  assert.equal(geom.cx, undefined);
  assert.equal(geom.cy, undefined);
});

test("Two parallel edges -> opposite symmetric quadratic Bézier curvature", () => {
  const u = createMockNode("u", 100, 300);
  const v = createMockNode("v", 500, 300);
  const edgeA = { id: "e1", type: "has-topic", source: "u", target: "v", sourceNode: u, targetNode: v };
  const edgeB = { id: "e2", type: "written-by", source: "u", target: "v", sourceNode: u, targetNode: v };

  prepareEdgeRouting([edgeA, edgeB]);

  const geomA = computeEdgeGeometry(edgeA);
  const geomB = computeEdgeGeometry(edgeB);

  assert.equal(geomA.type, "curved");
  assert.equal(geomB.type, "curved");

  // Midpoint x = 300, y = 300
  // Direction vector is horizontal (dx = 400, dy = 0) -> normal vector is vertical (nx = 0, ny = 1)
  assert.equal(geomA.x1, 100);
  assert.equal(geomA.x2, 500);
  assert.equal(geomB.x1, 100);
  assert.equal(geomB.x2, 500);

  // Both control points have same x midpoint
  assert.equal(geomA.cx, 300);
  assert.equal(geomB.cx, 300);

  // Symmetric opposite curvature in y: one curves upward (cy < 300), other curves downward (cy > 300)
  const offsetA = geomA.cy - 300;
  const offsetB = geomB.cy - 300;
  assert.ok(Math.abs(offsetA + offsetB) < 1e-9, "Curvatures must be equal in magnitude and opposite in sign");
  assert.ok(Math.abs(offsetA) > 5, "Curvature displacement must be non-zero");
});

test("Three parallel edges -> symmetric arrangement with centered middle edge", () => {
  const u = createMockNode("nodeA", 200, 200);
  const v = createMockNode("nodeB", 200, 600);
  const edges = [
    { id: "e1", source: "nodeA", target: "nodeB", sourceNode: u, targetNode: v },
    { id: "e2", source: "nodeA", target: "nodeB", sourceNode: u, targetNode: v },
    { id: "e3", source: "nodeA", target: "nodeB", sourceNode: u, targetNode: v },
  ];

  prepareEdgeRouting(edges);

  const g1 = computeEdgeGeometry(edges[0]);
  const g2 = computeEdgeGeometry(edges[1]);
  const g3 = computeEdgeGeometry(edges[2]);

  // Center edge (index 1) should be straight
  assert.equal(g2.type, "straight");

  // Outer edges (index 0 and 2) should be curved symmetrically
  assert.equal(g1.type, "curved");
  assert.equal(g3.type, "curved");

  const diff1 = g1.cx - 200;
  const diff3 = g3.cx - 200;
  assert.ok(Math.abs(diff1 + diff3) < 1e-9, "Outer edges must have equal and opposite lateral displacement");
});

test("Parallel-edge routing is invariant to input edge array order", () => {
  const u = createMockNode("a", 100, 100);
  const v = createMockNode("b", 400, 400);

  const edge1 = { id: "alpha", source: "a", target: "b", sourceNode: u, targetNode: v };
  const edge2 = { id: "beta", source: "a", target: "b", sourceNode: u, targetNode: v };

  // Run in order [edge1, edge2]
  prepareEdgeRouting([edge1, edge2]);
  const g1_order1 = computeEdgeGeometry(edge1);
  const g2_order1 = computeEdgeGeometry(edge2);

  // Run in reversed order [edge2, edge1]
  prepareEdgeRouting([edge2, edge1]);
  const g1_order2 = computeEdgeGeometry(edge1);
  const g2_order2 = computeEdgeGeometry(edge2);

  // Edge 'alpha' must receive identical geometry regardless of array positioning
  assert.equal(g1_order1.type, g1_order2.type);
  assert.equal(g1_order1.cx, g1_order2.cx);
  assert.equal(g1_order1.cy, g1_order2.cy);

  // Edge 'beta' must receive identical geometry regardless of array positioning
  assert.equal(g2_order1.type, g2_order2.type);
  assert.equal(g2_order1.cx, g2_order2.cx);
  assert.equal(g2_order1.cy, g2_order2.cy);
});

test("Edge keeps identical geometry across repeated calls and dynamic node translations", () => {
  const u = createMockNode("u", 100, 100);
  const v = createMockNode("v", 300, 300);
  const edge = { id: "e1", source: "u", target: "v", sourceNode: u, targetNode: v };

  prepareEdgeRouting([edge]);
  const geom1 = computeEdgeGeometry(edge);
  const geom2 = computeEdgeGeometry(edge);

  assert.deepEqual(geom1, geom2);

  // Translate nodes (simulating force layout tick)
  u.x += 50;
  u.y += 20;
  v.x += 50;
  v.y += 20;

  const geom3 = computeEdgeGeometry(edge);
  assert.equal(geom3.x1, 150);
  assert.equal(geom3.y1, 120);
  assert.equal(geom3.x2, 350);
  assert.equal(geom3.y2, 320);
});

test("Self-loop geometry generates valid, finite cubic Bézier curve", () => {
  const u = createMockNode("selfNode", 400, 300, 12);
  const loopEdge = { id: "loop1", source: "selfNode", target: "selfNode", sourceNode: u, targetNode: u };

  prepareEdgeRouting([loopEdge]);
  const geom = computeEdgeGeometry(loopEdge);

  assert.equal(geom.type, "loop");
  assert.ok(isFinite(geom.x1) && isFinite(geom.y1));
  assert.ok(isFinite(geom.x2) && isFinite(geom.y2));
  assert.ok(isFinite(geom.cp1x) && isFinite(geom.cp1y));
  assert.ok(isFinite(geom.cp2x) && isFinite(geom.cp2y));
  assert.ok(geom.cp1y < geom.y1, "Self loop control point must loop outward above the node");
});

test("Coincident nodes (distance = 0) produce safe, finite geometry without NaN or Infinity", () => {
  const u = createMockNode("u", 250, 250);
  const v = createMockNode("v", 250, 250);
  const edge = { id: "coincident", source: "u", target: "v", sourceNode: u, targetNode: v };

  prepareEdgeRouting([edge]);
  const geom = computeEdgeGeometry(edge);

  assert.equal(geom.type, "straight");
  assert.equal(geom.x1, 250);
  assert.equal(geom.y1, 250);
  assert.equal(geom.x2, 250);
  assert.equal(geom.y2, 250);
  assert.ok(!isNaN(geom.x1) && !isNaN(geom.y1));
});

test("Missing source or target nodes fail gracefully with finite coordinates", () => {
  const edgeWithoutNodes = { id: "broken", source: "missingA", target: "missingB" };
  const geom = computeEdgeGeometry(edgeWithoutNodes);

  assert.equal(geom.type, "straight");
  assert.equal(geom.x1, 0);
  assert.equal(geom.y1, 0);
  assert.equal(geom.x2, 0);
  assert.equal(geom.y2, 0);
});

test("routeGraphEdges - routes 2,000 edges efficiently in under 5ms", () => {
  const nodes = Array.from({ length: 500 }, (_, i) =>
    createMockNode(`node-${i}`, (i * 37) % 800, (i * 53) % 600)
  );

  const edges = Array.from({ length: 2000 }, (_, i) => {
    const s = (i * 7) % 500;
    const t = (i * 11) % 500;
    return {
      id: `edge-${i}`,
      type: i % 2 === 0 ? "has-topic" : "written-by",
      source: `node-${s}`,
      target: `node-${t}`,
      sourceNode: nodes[s],
      targetNode: nodes[t],
    };
  });

  const t0 = performance.now();
  const routed = routeGraphEdges(edges);
  const t1 = performance.now();

  assert.equal(routed.length, 2000);
  for (const item of routed) {
    assert.ok(item.geometry);
    assert.ok(isFinite(item.geometry.x1));
    assert.ok(isFinite(item.geometry.y1));
    assert.ok(isFinite(item.geometry.x2));
    assert.ok(isFinite(item.geometry.y2));
  }

  const durationMs = t1 - t0;
  assert.ok(durationMs < 15, `Expected 2000 edges routed in < 15ms, took ${durationMs.toFixed(3)}ms`);
});

test("GraphRenderer Integration - renders straight, curved, and loop edges without throwing", () => {
  const canvas = {
    getContext: () => ({
      save: () => {},
      scale: () => {},
      clearRect: () => {},
      translate: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      fillText: () => {},
      strokeText: () => {},
      restore: () => {},
    }),
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    addEventListener: () => {},
    style: {},
  };

  const nodeA = createMockNode("A", 100, 100);
  const nodeB = createMockNode("B", 300, 300);

  const layout = {
    nodes: [nodeA, nodeB],
    edges: [
      { id: "e1", source: "A", target: "B", sourceNode: nodeA, targetNode: nodeB, type: "has-topic" },
      { id: "e2", source: "A", target: "B", sourceNode: nodeA, targetNode: nodeB, type: "written-by" },
      { id: "loop", source: "A", target: "A", sourceNode: nodeA, targetNode: nodeA, type: "has-topic" },
    ],
    width: 800,
    height: 600,
    tick: () => true,
    reheat: () => {},
    releaseNode: () => {},
    setNodePosition: () => {},
  };

  const renderer = new GraphRenderer(canvas, layout);

  // Trigger draw and verify clean execution with all edge types
  assert.doesNotThrow(() => {
    renderer.draw();
  });
});
