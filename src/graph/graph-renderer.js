// src/graph/graph-renderer.js
// High-performance HTML5 Canvas renderer with pan, zoom, hover highlight, node dragging, and Fit Graph.

import { prepareEdgeRouting, computeEdgeGeometry } from "./edge-router.js";

export const NODE_COLORS = {
  post: { fill: "#0a66c2", stroke: "#004182", text: "#191919" },
  topic: { fill: "#10b981", stroke: "#047857", text: "#065f46" },
  author: { fill: "#f59e0b", stroke: "#b45309", text: "#92400e" },
};

export const EDGE_COLORS = {
  "has-topic": "#a7f3d0",
  "written-by": "#fde68a",
};

/**
 * Deterministic label priority policy for Knowledge Graph Canvas nodes.
 *
 * Priority Tiers:
 * 1. Active (selected or hovered) node and directly connected neighbors are ALWAYS visible.
 * 2. Major Topic (count >= 3) and Author (count >= 2) hubs are visible across medium/large views.
 * 3. Standard Topics and Authors adaptively display based on node density and zoom.
 * 4. Post nodes (leaf constellation) display when connected or when zoomed in.
 *
 * @param {Object} node - Graph node { id, type, label, count }
 * @param {Object} [context={}]
 * @param {Object|null} [context.activeNode] - Hovered or selected node
 * @param {Set<string>|null} [context.connectedIds] - IDs of nodes connected to activeNode
 * @param {number} [context.zoom=1.0] - Current canvas zoom level
 * @param {number} [context.totalNodes=10] - Total active node count
 * @returns {boolean} Whether the node's label should be rendered
 */
export function shouldRenderNodeLabel(node, context = {}) {
  if (!node) return false;

  const activeNode = context.activeNode || null;
  const connectedIds = context.connectedIds || null;
  const zoom = typeof context.zoom === "number" ? context.zoom : 1.0;
  const totalNodes = typeof context.totalNodes === "number" ? context.totalNodes : 10;

  // 1. Priority Tier 1: Active node and immediate neighbors are ALWAYS 100% visible
  if (activeNode && activeNode.id === node.id) return true;
  if (connectedIds && connectedIds.has(node.id)) return true;

  // 2. Priority Tier 2: High-Degree Hubs
  const isHighDegreeHub =
    (node.type === "topic" && (node.count || 0) >= 3) ||
    (node.type === "author" && (node.count || 0) >= 2);

  if (isHighDegreeHub) {
    if (totalNodes <= 150) return true;
    return zoom >= 0.55;
  }

  // 3. Priority Tier 3: Standard Topics and Authors
  if (node.type === "topic" || node.type === "author") {
    if (totalNodes <= 60) return true;
    if (totalNodes <= 180) return zoom >= 0.75;
    return zoom >= 0.95;
  }

  // 4. Priority Tier 4: Post nodes (dense leaf constellation)
  if (node.type === "post") {
    if (totalNodes <= 25) return zoom >= 1.05;
    if (totalNodes <= 100) return zoom >= 1.35;
    return zoom >= 1.7;
  }

  return false;
}

export class GraphRenderer {
  constructor(canvas, layout, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = layout;
    this.onNodeClick = options.onNodeClick || (() => {});
    this.onNodeHover = options.onNodeHover || (() => {});

    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;

    this.hoveredNode = null;
    this.selectedNode = null;
    this.draggedNode = null;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.dragDistance = 0;

    this.dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    this.animationFrameId = null;
    this.isRunning = false;

    this.setupEvents();
    this.resize();
  }

  resize() {
    const parent = this.canvas?.parentElement;
    const rect = parent?.getBoundingClientRect ? parent.getBoundingClientRect() : { width: 800, height: 600 };
    const w = rect.width || 800;
    const h = rect.height || 600;

    this.dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    if (this.canvas) {
      this.canvas.width = w * this.dpr;
      this.canvas.height = h * this.dpr;
      if (this.canvas.style) {
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
      }
    }

    this.layout.width = w;
    this.layout.height = h;
    this.requestRender();
  }

  start() {
    this.isRunning = true;
    if (typeof requestAnimationFrame === "undefined") {
      this.draw();
      return;
    }
    const loop = () => {
      if (!this.isRunning) return;
      const isDone = this.layout.tick();
      this.draw();
      if (!isDone || this.draggedNode || this.isPanning) {
        this.animationFrameId = requestAnimationFrame(loop);
      } else {
        this.animationFrameId = null;
      }
    };
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(loop);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  requestRender() {
    if (!this.animationFrameId) {
      this.start();
    }
  }

  resetView() {
    this.panX = 0;
    this.panY = 0;
    this.zoom = 1.0;
    this.layout.reheat(0.3);
    this.requestRender();
  }

  /**
   * Automatically calculates bounding box of active nodes, centering and framing the visible graph.
   *
   * @param {number} [padding=60]
   */
  fitGraph(padding = 60) {
    const nodes = this.layout.nodes;
    if (!nodes || nodes.length === 0) {
      this.resetView();
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of nodes) {
      const r = this.getNodeRadius(n);
      const nx = typeof n.x === "number" && !isNaN(n.x) ? n.x : 0;
      const ny = typeof n.y === "number" && !isNaN(n.y) ? n.y : 0;
      minX = Math.min(minX, nx - r);
      maxX = Math.max(maxX, nx + r);
      minY = Math.min(minY, ny - r);
      maxY = Math.max(maxY, ny + r);
    }

    const rect = this.canvas?.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 800, height: 600 };
    const w = rect.width || 800;
    const h = rect.height || 600;

    const graphW = Math.max(maxX - minX, 100);
    const graphH = Math.max(maxY - minY, 100);
    const graphCx = (minX + maxX) / 2;
    const graphCy = (minY + maxY) / 2;

    const availW = Math.max(w - padding * 2, 100);
    const availH = Math.max(h - padding * 2, 100);

    // Bounded fit zoom: 0.15 to 1.8 (capping small graphs at 1.15 to prevent over-magnification)
    const fitZoom = Math.max(0.15, Math.min(availW / graphW, availH / graphH, nodes.length <= 3 ? 1.15 : 1.8));

    this.zoom = fitZoom;
    this.panX = (w / 2 - graphCx) * fitZoom;
    this.panY = (h / 2 - graphCy) * fitZoom;

    this.layout.reheat(0.15);
    this.requestRender();
  }

  screenToWorld(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = screenX - rect.left;
    const y = screenY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const wx = (x - cx - this.panX) / this.zoom + cx;
    const wy = (y - cy - this.panY) / this.zoom + cy;
    return { x: wx, y: wy };
  }

  getNodeRadius(node) {
    if (node.type === "post") return 6.5;
    if (node.type === "topic") return Math.min(9 + (node.count || 1) * 1.5, 22);
    if (node.type === "author") return Math.min(8 + (node.count || 1) * 1.5, 19);
    return 7;
  }

  findNodeAt(screenX, screenY) {
    const { x, y } = this.screenToWorld(screenX, screenY);
    for (let i = this.layout.nodes.length - 1; i >= 0; i--) {
      const node = this.layout.nodes[i];
      const r = this.getNodeRadius(node) + 4; // click tolerance
      const dx = node.x - x;
      const dy = node.y - y;
      if (dx * dx + dy * dy <= r * r) {
        return node;
      }
    }
    return null;
  }

  setupEvents() {
    if (typeof window === "undefined" || !this.canvas?.addEventListener) return;
    const c = this.canvas;

    c.addEventListener("mousedown", (e) => {
      this.mouseDownX = e.clientX;
      this.mouseDownY = e.clientY;
      this.dragDistance = 0;

      const hit = this.findNodeAt(e.clientX, e.clientY);
      if (hit) {
        this.draggedNode = hit;
        this.layout.setNodePosition(hit.id, hit.x, hit.y, true);
      } else {
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
      }
      this.requestRender();
    });

    window.addEventListener("mousemove", (e) => {
      const dx = e.clientX - this.mouseDownX;
      const dy = e.clientY - this.mouseDownY;
      this.dragDistance = Math.sqrt(dx * dx + dy * dy);

      if (this.draggedNode) {
        const { x, y } = this.screenToWorld(e.clientX, e.clientY);
        this.layout.setNodePosition(this.draggedNode.id, x, y, true);
        this.requestRender();
      } else if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.requestRender();
      } else {
        const hit = this.findNodeAt(e.clientX, e.clientY);
        if (hit !== this.hoveredNode) {
          this.hoveredNode = hit;
          c.style.cursor = hit ? "pointer" : "default";
          this.onNodeHover(hit);
          this.requestRender();
        }
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this.draggedNode) {
        this.layout.releaseNode(this.draggedNode.id);
        this.draggedNode = null;
        this.requestRender();
      }
      if (this.isPanning) {
        this.isPanning = false;
        this.requestRender();
      }
    });

    c.addEventListener("click", (e) => {
      // Ignore click if mouse was dragged more than 4px
      if (this.dragDistance < 5) {
        const hit = this.findNodeAt(e.clientX, e.clientY);
        this.selectedNode = hit;
        this.onNodeClick(hit);
        this.requestRender();
      }
    });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89;
      const newZoom = Math.max(0.15, Math.min(this.zoom * zoomFactor, 5.0));

      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      // Mathematically exact cursor-anchored zoom transform
      this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
      this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
      this.zoom = newZoom;

      this.requestRender();
    });

    window.addEventListener("resize", () => this.resize());
  }

  getConnectedNodeIds(activeNode) {
    if (!activeNode) return null;
    const connected = new Set([activeNode.id]);
    for (const edge of this.layout.edges) {
      if (edge.source === activeNode.id) connected.add(edge.target);
      if (edge.target === activeNode.id) connected.add(edge.source);
    }
    return connected;
  }

  draw() {
    const ctx = this.ctx;
    if (!ctx || typeof ctx.save !== "function") return;

    const rect = this.canvas?.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 800, height: 600 };
    const w = rect.width || 800;
    const h = rect.height || 600;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, h);

    // Coordinate translation for pan and zoom centered on canvas
    const cx = w / 2;
    const cy = h / 2;
    ctx.translate(cx + this.panX, cy + this.panY);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-cx, -cy);

    const activeNode = this.hoveredNode || this.selectedNode;
    const isHoveredOnly = this.hoveredNode && !this.selectedNode;
    const connectedIds = this.getConnectedNodeIds(activeNode);
    const totalNodes = this.layout.nodes.length;

    // Ensure edge routing metadata is indexed for current layout edge set
    if (this.layout.edges && this.layout.edges._routedCount !== this.layout.edges.length) {
      prepareEdgeRouting(this.layout.edges);
      this.layout.edges._routedCount = this.layout.edges.length;
    }

    // 1. Draw Edges (straight, quadratic Bézier, or cubic Bézier loop)
    for (const edge of this.layout.edges) {
      const u = edge.sourceNode;
      const v = edge.targetNode;
      if (!u || !v) continue;

      const isConnected = !connectedIds || (connectedIds.has(u.id) && connectedIds.has(v.id));
      ctx.strokeStyle = EDGE_COLORS[edge.type] || "#cbd5e1";
      ctx.lineWidth = isConnected && activeNode ? 2.2 : 1.2;
      ctx.globalAlpha = !activeNode ? 0.7 : isConnected ? 1.0 : 0.08;

      const geom = computeEdgeGeometry(edge);

      ctx.beginPath();
      if (geom.type === "straight") {
        ctx.moveTo(geom.x1, geom.y1);
        ctx.lineTo(geom.x2, geom.y2);
      } else if (geom.type === "curved") {
        ctx.moveTo(geom.x1, geom.y1);
        ctx.quadraticCurveTo(geom.cx, geom.cy, geom.x2, geom.y2);
      } else if (geom.type === "loop") {
        ctx.moveTo(geom.x1, geom.y1);
        ctx.bezierCurveTo(geom.cp1x, geom.cp1y, geom.cp2x, geom.cp2y, geom.x2, geom.y2);
      }
      ctx.stroke();
    }

    // 2. Draw Nodes
    for (const node of this.layout.nodes) {
      const isConnected = !connectedIds || connectedIds.has(node.id);
      const isSelected = this.selectedNode && this.selectedNode.id === node.id;
      const isHovered = this.hoveredNode && this.hoveredNode.id === node.id;
      const r = this.getNodeRadius(node);
      const colors = NODE_COLORS[node.type] || NODE_COLORS.post;

      ctx.globalAlpha = !activeNode ? 1.0 : isConnected ? 1.0 : 0.18;

      // Outer Selection Ring / Hover Aura
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = colors.fill;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3.5, 0, Math.PI * 2);
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      // Main Node Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = isSelected || isHovered ? 2.0 : 1.5;
      ctx.stroke();

      // Node Labels (rendered adaptively according to deterministic priority model)
      const shouldDrawLabel = shouldRenderNodeLabel(node, {
        activeNode,
        connectedIds,
        zoom: this.zoom,
        totalNodes,
      });

      if (shouldDrawLabel) {
        ctx.font = node.type === "topic" ? "bold 11px sans-serif" : "10.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const maxLen = node.type === "topic" ? 26 : 22;
        const text = node.label.length > maxLen ? `${node.label.slice(0, maxLen)}…` : node.label;
        const textY = node.y + r + 3.5;

        // Label background outline for crisp legibility over intersecting edges
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3.5;
        ctx.strokeText(text, node.x, textY);

        ctx.fillStyle = colors.text;
        ctx.fillText(text, node.x, textY);
      }
    }

    ctx.restore();
  }
}
