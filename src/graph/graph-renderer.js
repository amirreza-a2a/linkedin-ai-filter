// src/graph/graph-renderer.js
// High-performance HTML5 Canvas renderer with pan, zoom, hover highlight, node dragging, and Fit Graph.

const NODE_COLORS = {
  post: { fill: "#0a66c2", stroke: "#004182", text: "#191919" },
  topic: { fill: "#10b981", stroke: "#047857", text: "#065f46" },
  author: { fill: "#f59e0b", stroke: "#b45309", text: "#92400e" },
};

const EDGE_COLORS = {
  "has-topic": "#a7f3d0",
  "written-by": "#fde68a",
};

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

    this.dpr = window.devicePixelRatio || 1;
    this.animationFrameId = null;
    this.isRunning = false;

    this.setupEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    this.layout.width = w;
    this.layout.height = h;
    this.requestRender();
  }

  start() {
    this.isRunning = true;
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
    if (this.animationFrameId) {
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
      minX = Math.min(minX, n.x - r);
      maxX = Math.max(maxX, n.x + r);
      minY = Math.min(minY, n.y - r);
      maxY = Math.max(maxY, n.y + r);
    }

    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;

    const graphW = Math.max(maxX - minX, 80);
    const graphH = Math.max(maxY - minY, 80);
    const graphCx = (minX + maxX) / 2;
    const graphCy = (minY + maxY) / 2;

    const availW = Math.max(w - padding * 2, 100);
    const availH = Math.max(h - padding * 2, 100);

    const fitZoom = Math.max(0.2, Math.min(availW / graphW, availH / graphH, 2.0));

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
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.max(0.2, Math.min(this.zoom * zoomFactor, 4.0));

      const rect = c.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;

      this.panX -= (mouseX - this.panX) * (newZoom / this.zoom - 1);
      this.panY -= (mouseY - this.panY) * (newZoom / this.zoom - 1);
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
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

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
    const connectedIds = this.getConnectedNodeIds(activeNode);

    // 1. Draw Edges
    for (const edge of this.layout.edges) {
      const u = edge.sourceNode;
      const v = edge.targetNode;
      if (!u || !v) continue;

      const isConnected = !connectedIds || (connectedIds.has(u.id) && connectedIds.has(v.id));
      ctx.strokeStyle = EDGE_COLORS[edge.type] || "#cbd5e1";
      ctx.lineWidth = isConnected && activeNode ? 2.0 : 1.2;
      ctx.globalAlpha = !activeNode ? 0.7 : isConnected ? 1.0 : 0.12;

      ctx.beginPath();
      ctx.moveTo(u.x, u.y);
      ctx.lineTo(v.x, v.y);
      ctx.stroke();
    }

    // 2. Draw Nodes
    for (const node of this.layout.nodes) {
      const isConnected = !connectedIds || connectedIds.has(node.id);
      const isTarget = activeNode && activeNode.id === node.id;
      const r = this.getNodeRadius(node);
      const colors = NODE_COLORS[node.type] || NODE_COLORS.post;

      ctx.globalAlpha = !activeNode ? 1.0 : isConnected ? 1.0 : 0.15;

      // Outer selection / highlight ring
      if (isTarget) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = colors.fill;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Main Node Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors.fill;
      ctx.fill();
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Node Labels (render for Topic and Author, or for hovered/selected nodes)
      const shouldDrawLabel = node.type !== "post" || isConnected || this.zoom >= 1.4;
      if (shouldDrawLabel) {
        ctx.font = node.type === "topic" ? "bold 11px sans-serif" : "10.5px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        const text = node.label.length > 22 ? `${node.label.slice(0, 22)}…` : node.label;
        const textY = node.y + r + 3;

        // Label background outline for legibility
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.strokeText(text, node.x, textY);

        ctx.fillStyle = colors.text;
        ctx.fillText(text, node.x, textY);
      }
    }

    ctx.restore();
  }
}
