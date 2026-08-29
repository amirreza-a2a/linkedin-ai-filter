// src/graph/edge-router.js
// Pure, deterministic 2D edge geometry router for Knowledge Graph Canvas.
// Zero external dependencies. Generates straight lines, symmetric quadratic Bézier curves,
// and cubic Bézier self-loops with canonical deterministic ordering.

/**
 * Prepares and indexes an array of edges with deterministic parallel-edge metadata.
 * Performs stable grouping and sorting in O(E log E) once per graph topology change,
 * allowing subsequent per-frame geometry calculations to execute in strict O(E) time
 * with zero memory allocations.
 *
 * @param {Array<Object>} edges - Array of graph edges
 * @returns {Array<Object>} The same edges array, annotated with routing metadata
 */
export function prepareEdgeRouting(edges) {
  if (!Array.isArray(edges) || edges.length === 0) return edges;

  // 1. Group edges by canonical undirected node-pair key
  const pairGroups = new Map();

  for (const edge of edges) {
    const s = edge.source || edge.sourceNode?.id || "";
    const t = edge.target || edge.targetNode?.id || "";
    const pairKey = s < t ? `${s}<->${t}` : `${t}<->${s}`;

    let group = pairGroups.get(pairKey);
    if (!group) {
      group = [];
      pairGroups.set(pairKey, group);
    }
    group.push(edge);
  }

  // 2. Deterministically sort each group by immutable edge properties
  for (const group of pairGroups.values()) {
    group.sort((a, b) => {
      // Primary sort: edge ID
      const idA = a.id || "";
      const idB = b.id || "";
      const cmpId = idA.localeCompare(idB);
      if (cmpId !== 0) return cmpId;

      // Secondary sort: edge type
      const typeA = a.type || "";
      const typeB = b.type || "";
      const cmpType = typeA.localeCompare(typeB);
      if (cmpType !== 0) return cmpType;

      // Tertiary sort: source ID then target ID
      const sA = a.source || a.sourceNode?.id || "";
      const sB = b.source || b.sourceNode?.id || "";
      const cmpSource = sA.localeCompare(sB);
      if (cmpSource !== 0) return cmpSource;

      const tA = a.target || a.targetNode?.id || "";
      const tB = b.target || b.targetNode?.id || "";
      return tA.localeCompare(tB);
    });

    const count = group.length;
    for (let i = 0; i < count; i++) {
      const edge = group[i];
      edge._pairIndex = i;
      edge._pairCount = count;
    }
  }

  return edges;
}

/**
 * Computes 2D rendering geometry for a single edge based on current node positions.
 * Operates in O(1) time without allocations.
 *
 * @param {Object} edge - Edge object with sourceNode, targetNode, and routing metadata
 * @param {number} [customPairIndex] - Optional override for pair index
 * @param {number} [customPairCount] - Optional override for pair count
 * @returns {Object} Geometry descriptor:
 *   - type: "straight" | "curved" | "loop"
 *   - x1, y1, x2, y2: Endpoints
 *   - cx, cy: Quadratic control point (when type === "curved")
 *   - cp1x, cp1y, cp2x, cp2y: Cubic control points (when type === "loop")
 */
export function computeEdgeGeometry(edge, customPairIndex, customPairCount) {
  const u = edge?.sourceNode;
  const v = edge?.targetNode;

  if (!u || !v) {
    return { type: "straight", x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  const uId = u.id || edge.source || "";
  const vId = v.id || edge.target || "";
  const pairIndex = typeof customPairIndex === "number" ? customPairIndex : edge._pairIndex ?? 0;
  const pairCount = typeof customPairCount === "number" ? customPairCount : edge._pairCount ?? 1;

  // 1. Self-Loop (Source === Target)
  if (uId === vId) {
    const r = u.radius || 7;
    const loopOffset = r + 16 + pairIndex * 10;
    return {
      type: "loop",
      x1: u.x,
      y1: u.y - r,
      cp1x: u.x - loopOffset,
      cp1y: u.y - loopOffset * 1.5,
      cp2x: u.x + loopOffset,
      cp2y: u.y - loopOffset * 1.5,
      x2: u.x + r,
      y2: u.y,
    };
  }

  const dx = v.x - u.x;
  const dy = v.y - u.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Safe fallback for coincident nodes (distance < 0.001)
  if (dist < 0.001) {
    return { type: "straight", x1: u.x, y1: u.y, x2: v.x, y2: v.y };
  }

  // 2. Single isolated edge between distinct nodes -> Straight line
  if (pairCount <= 1) {
    return {
      type: "straight",
      x1: u.x,
      y1: u.y,
      x2: v.x,
      y2: v.y,
    };
  }

  // 3. Parallel / Multiple edges -> Deterministic symmetric quadratic Bézier curve
  const isCanonicalOrder = uId < vId;
  const midpointX = (u.x + v.x) / 2;
  const midpointY = (u.y + v.y) / 2;

  // Canonical unit normal vector perpendicular to (dx, dy)
  // When uId < vId: normal is (-dy/d, dx/d)
  // When vId < uId: normal is (dy/d, -dx/d) to preserve fixed orientation regardless of edge direction
  const rawNx = -dy / dist;
  const rawNy = dx / dist;
  const nx = isCanonicalOrder ? rawNx : -rawNx;
  const ny = isCanonicalOrder ? rawNy : -rawNy;

  // Centered offset index for symmetric arrangement
  // e.g. For 2 edges: index 0 -> -0.5, index 1 -> +0.5
  // e.g. For 3 edges: index 0 -> -1.0, index 1 -> 0.0, index 2 -> +1.0
  const offsetIndex = pairIndex - (pairCount - 1) / 2;

  if (Math.abs(offsetIndex) < 0.001) {
    // Exact center edge in odd-count group stays straight
    return {
      type: "straight",
      x1: u.x,
      y1: u.y,
      x2: v.x,
      y2: v.y,
    };
  }

  // Curvature bulge scales with distance, capped to avoid excessive bowing
  const baseBulge = Math.min(45, Math.max(14, dist * 0.22));
  const curvatureHeight = offsetIndex * baseBulge;

  return {
    type: "curved",
    x1: u.x,
    y1: u.y,
    cx: midpointX + nx * curvatureHeight,
    cy: midpointY + ny * curvatureHeight,
    x2: v.x,
    y2: v.y,
  };
}

/**
 * Routes all edges in an array, returning their computed 2D render geometries.
 *
 * @param {Array<Object>} edges
 * @returns {Array<{ edge: Object, geometry: Object }>}
 */
export function routeGraphEdges(edges) {
  if (!Array.isArray(edges) || edges.length === 0) return [];
  prepareEdgeRouting(edges);

  return edges.map((edge) => ({
    edge,
    geometry: computeEdgeGeometry(edge),
  }));
}
