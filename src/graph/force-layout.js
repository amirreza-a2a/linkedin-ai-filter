// src/graph/force-layout.js
// Lightweight, deterministic, adaptive spring-embedder force simulation.
// Zero external dependencies. Uses scale-aware physics and collision modeling.

export const PHYSICS_PRESETS = {
  compact: { repulsion: 400, springLength: 45, gravity: 0.05 },
  balanced: { repulsion: 900, springLength: 75, gravity: 0.025 },
  spread: { repulsion: 2000, springLength: 130, gravity: 0.01 },
};

/**
 * Computes deterministic, scale-adapted simulation parameters from base user settings
 * and active graph geometry.
 *
 * @param {Object} options
 * @param {number} [options.nodeCount=10]
 * @param {number} [options.edgeCount=10]
 * @param {number} [options.width=800]
 * @param {number} [options.height=600]
 * @param {number} [options.repulsion=900]
 * @param {number} [options.springLength=75]
 * @param {number} [options.springStrength=0.06]
 * @param {number} [options.gravity=0.025]
 * @returns {Object} Effective physics parameters
 */
export function computeEffectivePhysics({
  nodeCount = 10,
  edgeCount = 10,
  width = 800,
  height = 600,
  repulsion = PHYSICS_PRESETS.balanced.repulsion,
  springLength = PHYSICS_PRESETS.balanced.springLength,
  springStrength = 0.06,
  gravity = PHYSICS_PRESETS.balanced.gravity,
} = {}) {
  const n = Math.max(nodeCount || 0, 1);
  const e = Math.max(edgeCount || 0, 0);

  // Scale adaptation factors
  // 1. Repulsion scaling: Dampens O(N^2) pairwise buildup while preserving user separation intent
  const scaleN = Math.sqrt(15 / Math.max(n, 15));
  const densityFactor = 1 + Math.log10(1 + n / 20) * 0.5;
  const effectiveRepulsion = repulsion * scaleN * densityFactor;

  // 2. Spring length scaling: Prevents graph diameter explosion for high-N while ensuring local clearance
  const lengthScale = Math.max(0.65, Math.min(1.35, 70 / (Math.sqrt(n) + 20)));
  const effectiveSpringLength = springLength * lengthScale;

  // 3. Gravity scaling: Softens central pull on large graphs to prevent dense core collapse
  const gravityScale = Math.max(0.25, Math.min(1.5, 25 / (Math.sqrt(n) + 15)));
  const effectiveGravity = gravity * gravityScale;

  // 4. Spring strength scaling: Scales gently with graph connectivity
  const avgDegree = e / n;
  const strengthScale = Math.max(0.7, Math.min(1.3, 1 + (avgDegree - 2) * 0.05));
  const effectiveSpringStrength = springStrength * strengthScale;

  // 5. Alpha decay: Slightly slower cooling for large graphs to allow topological untangling
  const effectiveAlphaDecay = Math.min(0.985, Math.max(0.965, 0.965 + n / 25000));

  return {
    effectiveRepulsion,
    effectiveSpringLength,
    effectiveSpringStrength,
    effectiveGravity,
    effectiveAlphaDecay,
    collisionStrength: 0.6,
  };
}

/**
 * Calculates collision radius for a given graph node.
 *
 * @param {Object} node
 * @returns {number} Node radius in pixels
 */
export function getNodeCollisionRadius(node) {
  if (!node) return 7;
  if (node.type === "post") return 7;
  if (node.type === "topic") return Math.min(9 + (node.count || 1) * 1.5, 22);
  if (node.type === "author") return Math.min(8 + (node.count || 1) * 1.5, 19);
  return 7;
}

export class ForceLayout {
  constructor(options = {}) {
    this.repulsion = options.repulsion ?? PHYSICS_PRESETS.balanced.repulsion;
    this.springLength = options.springLength ?? PHYSICS_PRESETS.balanced.springLength;
    this.springStrength = options.springStrength ?? 0.06;
    this.gravity = options.gravity ?? PHYSICS_PRESETS.balanced.gravity;
    this.damping = options.damping ?? 0.85;
    this.alphaDecay = options.alphaDecay ?? 0.97;
    this.alphaMin = 0.005;

    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();
    this.width = 800;
    this.height = 600;
    this.alpha = 1.0;
  }

  /**
   * Updates physics parameters and reheats the simulation.
   *
   * @param {Object} params
   * @param {number} [params.repulsion]
   * @param {number} [params.springLength]
   * @param {number} [params.gravity]
   */
  setPhysics({ repulsion, springLength, gravity } = {}) {
    if (typeof repulsion === "number" && !isNaN(repulsion)) this.repulsion = repulsion;
    if (typeof springLength === "number" && !isNaN(springLength)) this.springLength = springLength;
    if (typeof gravity === "number" && !isNaN(gravity)) this.gravity = gravity;
    this.reheat(0.4);
  }

  /**
   * Applies a named physics preset ('compact' | 'balanced' | 'spread').
   *
   * @param {"compact" | "balanced" | "spread"} presetName
   */
  applyPreset(presetName = "balanced") {
    const p = PHYSICS_PRESETS[presetName.toLowerCase()] || PHYSICS_PRESETS.balanced;
    this.setPhysics(p);
  }

  /**
   * Resets physics to the default balanced preset.
   */
  resetPhysics() {
    this.applyPreset("balanced");
  }

  /**
   * Initializes simulation with deterministic circular node placement.
   *
   * @param {Array<Object>} graphNodes
   * @param {Array<Object>} graphEdges
   * @param {number} width
   * @param {number} height
   */
  init(graphNodes, graphEdges, width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.alpha = 1.0;
    this.nodeMap.clear();

    const cx = width / 2;
    const cy = height / 2;
    const n = graphNodes.length;
    const radius = Math.min(width, height) * 0.28;

    this.nodes = graphNodes.map((node, i) => {
      // Deterministic initial circle placement
      const angle = (2 * Math.PI * i) / Math.max(n, 1);
      const simNode = {
        ...node,
        radius: getNodeCollisionRadius(node),
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        vx: 0,
        vy: 0,
        pinned: false,
      };
      this.nodeMap.set(simNode.id, simNode);
      return simNode;
    });

    this.edges = graphEdges
      .map((edge) => ({
        ...edge,
        sourceNode: this.nodeMap.get(edge.source),
        targetNode: this.nodeMap.get(edge.target),
      }))
      .filter((e) => e.sourceNode && e.targetNode);
  }

  /**
   * Advances simulation by one tick.
   * Returns true if simulation is finished (alpha < alphaMin).
   *
   * @returns {boolean} True if simulation has converged
   */
  tick() {
    if (this.alpha < this.alphaMin || this.nodes.length === 0) {
      return true;
    }

    const n = this.nodes.length;
    const e = this.edges.length;
    const cx = this.width / 2;
    const cy = this.height / 2;

    // Compute scale-adapted physics for current frame
    const {
      effectiveRepulsion,
      effectiveSpringLength,
      effectiveSpringStrength,
      effectiveGravity,
      effectiveAlphaDecay,
      collisionStrength,
    } = computeEffectivePhysics({
      nodeCount: n,
      edgeCount: e,
      width: this.width,
      height: this.height,
      repulsion: this.repulsion,
      springLength: this.springLength,
      springStrength: this.springStrength,
      gravity: this.gravity,
    });

    // 1. Repulsive forces + Collision avoidance between all node pairs
    for (let i = 0; i < n; i++) {
      const u = this.nodes[i];
      const ur = u.radius || 7;
      for (let j = i + 1; j < n; j++) {
        const v = this.nodes[j];
        const vr = v.radius || 7;
        let dx = v.x - u.x;
        let dy = v.y - u.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = 1;
          dy = 0;
          distSq = 1;
        }

        const dist = Math.sqrt(distSq);
        const minDist = ur + vr + 4;

        // Base inverse-square repulsion with distance softening
        let force = (effectiveRepulsion / (distSq + 100)) * this.alpha;

        // Collision restoring force if overlapping
        if (dist < minDist) {
          const overlap = minDist - dist;
          force += overlap * collisionStrength * this.alpha;
        }

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!u.pinned) {
          u.vx -= fx;
          u.vy -= fy;
        }
        if (!v.pinned) {
          v.vx += fx;
          v.vy += fy;
        }
      }
    }

    // 2. Attractive/restoring spring forces along edges (Hooke's Law)
    for (const edge of this.edges) {
      const u = edge.sourceNode;
      const v = edge.targetNode;
      let dx = v.x - u.x;
      let dy = v.y - u.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.1) dist = 0.1;

      // Target rest length: respect effective spring length and combined node radii
      const targetLength = Math.max((u.radius || 7) + (v.radius || 7) + 12, effectiveSpringLength);

      // Displacement from natural spring length
      const displacement = dist - targetLength;
      const force = displacement * effectiveSpringStrength * this.alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      // u moves in direction +fx, +fy (toward v if stretched)
      if (!u.pinned) {
        u.vx += fx;
        u.vy += fy;
      }
      // v moves in opposite direction -fx, -fy (toward u if stretched)
      if (!v.pinned) {
        v.vx -= fx;
        v.vy -= fy;
      }
    }

    // 3. Center gravity, velocity clamping, damping, and position integration
    const maxV = 30 * this.alpha + 6;

    for (const node of this.nodes) {
      if (node.pinned) continue;

      // Center gravity
      node.vx += (cx - node.x) * effectiveGravity * this.alpha;
      node.vy += (cy - node.y) * effectiveGravity * this.alpha;

      // Damping
      node.vx *= this.damping;
      node.vy *= this.damping;

      // Velocity clamping to prevent oscillation and runaway physics
      const vMag = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (vMag > maxV) {
        const scale = maxV / vMag;
        node.vx *= scale;
        node.vy *= scale;
      }

      // Position update
      node.x += node.vx;
      node.y += node.vy;
    }

    this.alpha *= effectiveAlphaDecay;
    return this.alpha < this.alphaMin;
  }

  reheat(newAlpha = 0.4) {
    this.alpha = Math.max(this.alpha, newAlpha);
  }

  setNodePosition(nodeId, x, y, pinned = true) {
    const node = this.nodeMap.get(nodeId);
    if (node) {
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
      node.pinned = pinned;
      this.reheat(0.2);
    }
  }

  releaseNode(nodeId) {
    const node = this.nodeMap.get(nodeId);
    if (node) {
      node.pinned = false;
      this.reheat(0.15);
    }
  }
}
