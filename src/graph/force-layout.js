// src/graph/force-layout.js
// Lightweight, deterministic spring-embedder force simulation.
// Zero external dependencies. Uses deterministic initial placement.

export const PHYSICS_PRESETS = {
  compact: { repulsion: 800, springLength: 60, gravity: 0.04 },
  balanced: { repulsion: 1400, springLength: 95, gravity: 0.02 },
  spread: { repulsion: 2400, springLength: 150, gravity: 0.01 },
};

export class ForceLayout {
  constructor(options = {}) {
    this.repulsion = options.repulsion ?? PHYSICS_PRESETS.balanced.repulsion;
    this.springLength = options.springLength ?? PHYSICS_PRESETS.balanced.springLength;
    this.springStrength = options.springStrength ?? 0.05;
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
    if (typeof repulsion === "number") this.repulsion = repulsion;
    if (typeof springLength === "number") this.springLength = springLength;
    if (typeof gravity === "number") this.gravity = gravity;
    this.reheat(0.3);
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
    const radius = Math.min(width, height) * 0.35;

    this.nodes = graphNodes.map((node, i) => {
      // Deterministic initial circle placement
      const angle = (2 * Math.PI * i) / Math.max(n, 1);
      const simNode = {
        ...node,
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
    const cx = this.width / 2;
    const cy = this.height / 2;

    // 1. Repulsive forces between all node pairs
    for (let i = 0; i < n; i++) {
      const u = this.nodes[i];
      for (let j = i + 1; j < n; j++) {
        const v = this.nodes[j];
        let dx = v.x - u.x;
        let dy = v.y - u.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = 1;
          dy = 0;
          distSq = 1;
        }

        const dist = Math.sqrt(distSq);
        const force = (this.repulsion / (distSq + 100)) * this.alpha;
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

    // 2. Attractive spring forces along edges
    for (const edge of this.edges) {
      const u = edge.sourceNode;
      const v = edge.targetNode;
      let dx = v.x - u.x;
      let dy = v.y - u.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.1) dist = 0.1;

      const displacement = dist - this.springLength;
      const force = displacement * this.springStrength * this.alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!u.pinned) {
        u.vx += fx;
        u.vy += fy;
      }
      if (!v.pinned) {
        v.vx += fx;
        v.vy += fy;
      }
    }

    // 3. Center gravity and position integration
    for (const node of this.nodes) {
      if (node.pinned) continue;

      // Center gravity
      node.vx += (cx - node.x) * this.gravity * this.alpha;
      node.vy += (cy - node.y) * this.gravity * this.alpha;

      // Damping and position update
      node.vx *= this.damping;
      node.vy *= this.damping;
      node.x += node.vx;
      node.y += node.vy;
    }

    this.alpha *= this.alphaDecay;
    return this.alpha < this.alphaMin;
  }

  reheat(newAlpha = 0.3) {
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
      this.reheat(0.15);
    }
  }

  releaseNode(nodeId) {
    const node = this.nodeMap.get(nodeId);
    if (node) {
      node.pinned = false;
      this.reheat(0.1);
    }
  }
}
