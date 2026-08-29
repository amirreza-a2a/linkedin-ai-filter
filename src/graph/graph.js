// src/graph/graph.js
// Knowledge Graph Visualizer controller for FeedRule Second Brain.

import {
  buildKnowledgeGraph,
  filterGraphByNodeType,
  extractNeighborhood,
  areGraphsEqual,
} from "./graph-builder.js";
import { ForceLayout, PHYSICS_PRESETS, PHYSICS_RANGES } from "./force-layout.js";
import { GraphRenderer } from "./graph-renderer.js";
import { getSavedPosts } from "../storage/saved-posts-store.js";
import { escapeXml } from "../dashboard/charts.js";
import { openExtensionPage } from "../navigation/navigation.js";

// DOM Elements
const canvas = document.getElementById("graphCanvas");
const topicFilterSelect = document.getElementById("topicFilterSelect");
const authorFilterSelect = document.getElementById("authorFilterSelect");
const nodeTypeSelect = document.getElementById("nodeTypeSelect");
const searchInput = document.getElementById("searchGraph");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const fitGraphBtn = document.getElementById("fitGraphBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const focusBanner = document.getElementById("focusBanner");
const focusLabel = document.getElementById("focusLabel");
const exitFocusBtn = document.getElementById("exitFocusBtn");
const emptyState = document.getElementById("emptyState");
const emptyStateDesc = document.getElementById("emptyStateDesc");

// Sidebar & Detail Card
const sidebar = document.getElementById("sidebar");
const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");
const nodeDetailsContent = document.getElementById("nodeDetailsContent");

// Physics Controls Elements
const togglePhysicsBtn = document.getElementById("togglePhysicsBtn");
const physicsPanel = document.getElementById("physicsPanel");
const densitySlider = document.getElementById("densitySlider");
const spacingSlider = document.getElementById("spacingSlider");
const gravitySlider = document.getElementById("gravitySlider");
const resetPhysicsBtn = document.getElementById("resetPhysicsBtn");

// Navigation Links
const openBrainBtn = document.getElementById("openBrainBtn");
const openDashboardBtn = document.getElementById("openDashboardBtn");

// Application State
let allSavedPosts = [];
let activeGraph = { nodes: [], edges: [] };
let focusedNodeId = null;
let layout = null;
let renderer = null;
let searchDebounceTimer = null;

function renderNodeDetails(node) {
  if (!node) {
    nodeDetailsContent.innerHTML = `
      <div class="empty-selection">
        <p>Click on any post, topic, or author node in the graph to inspect its connections.</p>
      </div>
    `;
    return;
  }

  const { id, type, label, data } = node;

  let badgeClass = "badge-post";
  let typeLabel = "Post";
  if (type === "topic") {
    badgeClass = "badge-topic";
    typeLabel = "Topic";
  } else if (type === "author") {
    badgeClass = "badge-author";
    typeLabel = "Author";
  }

  // Find connected edges and neighbors
  const connectedEdges = activeGraph.edges.filter(
    (e) => e.source === id || e.target === id
  );
  const neighborNodeIds = new Set(
    connectedEdges.map((e) => (e.source === id ? e.target : e.source))
  );
  const neighborNodes = activeGraph.nodes.filter((n) => neighborNodeIds.has(n.id));

  let html = `
    <div class="detail-header">
      <span class="detail-badge ${badgeClass}">${typeLabel}</span>
      <h3 class="detail-title">${escapeXml(label)}</h3>
    </div>
  `;

  // Focus Neighborhood Button
  html += `
    <button class="action-btn focus-btn" id="focus-this-node-btn">
      🎯 Focus Neighborhood
    </button>
  `;

  if (type === "post") {
    html += `
      <div class="detail-section">
        <h4>Author</h4>
        <p>${escapeXml(data.author || "Unknown Author")}</p>
        ${
          data.authorUrl
            ? `<a href="${escapeXml(data.authorUrl)}" target="_blank" rel="noopener noreferrer" class="detail-link">View LinkedIn Profile ↗</a>`
            : ""
        }
      </div>
      <div class="detail-section">
        <h4>Topics</h4>
        <div class="detail-tags">
          ${(data.topics || [])
            .map((t) => `<span class="detail-tag">${escapeXml(t)}</span>`)
            .join("")}
        </div>
      </div>
      <div class="detail-section">
        <h4>Post Excerpt</h4>
        <p class="detail-text">${escapeXml(data.text || "")}</p>
      </div>
      ${
        data.postUrl
          ? `
        <div class="detail-section">
          <a href="${escapeXml(data.postUrl)}" target="_blank" rel="noopener noreferrer" class="detail-link permalink">
            Open Original Post on LinkedIn ↗
          </a>
        </div>
      `
          : ""
      }
    `;
  } else if (type === "topic") {
    html += `
      <div class="detail-section">
        <h4>Connected Posts (${neighborNodes.length})</h4>
        <ul class="neighbor-list">
          ${neighborNodes
            .map(
              (n) => `
            <li>
              <button class="neighbor-link" data-node-id="${escapeXml(n.id)}">
                ${escapeXml(n.label)}
              </button>
            </li>
          `
            )
            .join("")}
        </ul>
      </div>
    `;
  } else if (type === "author") {
    html += `
      <div class="detail-section">
        ${
          data.authorUrl
            ? `<a href="${escapeXml(data.authorUrl)}" target="_blank" rel="noopener noreferrer" class="detail-link">View LinkedIn Profile ↗</a>`
            : ""
        }
      </div>
      <div class="detail-section">
        <h4>Authored Posts (${neighborNodes.length})</h4>
        <ul class="neighbor-list">
          ${neighborNodes
            .map(
              (n) => `
            <li>
              <button class="neighbor-link" data-node-id="${escapeXml(n.id)}">
                ${escapeXml(n.label)}
              </button>
            </li>
          `
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  nodeDetailsContent.innerHTML = html;

  // Bind focus button
  const focusBtn = document.getElementById("focus-this-node-btn");
  if (focusBtn) {
    focusBtn.addEventListener("click", () => setFocusNode(id, label));
  }

  // Bind neighbor navigation buttons
  nodeDetailsContent.querySelectorAll(".neighbor-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-node-id");
      const targetNode = activeGraph.nodes.find((n) => n.id === targetId);
      if (targetNode) {
        if (renderer) renderer.selectedNode = targetNode;
        renderNodeDetails(targetNode);
        if (renderer) renderer.requestRender();
      }
    });
  });

  // Open sidebar if closed on mobile/desktop
  sidebar.classList.add("open");
}

function updateFilterDropdowns(posts) {
  const currentTopic = topicFilterSelect.value;
  const currentAuthor = authorFilterSelect.value;

  const topicsSet = new Set();
  const authorsSet = new Set();

  for (const p of posts) {
    for (const t of p.topics || []) if (t) topicsSet.add(t);
    if (p.author) authorsSet.add(p.author);
  }

  const sortedTopics = Array.from(topicsSet).sort((a, b) => a.localeCompare(b));
  const sortedAuthors = Array.from(authorsSet).sort((a, b) => a.localeCompare(b));

  topicFilterSelect.innerHTML =
    `<option value="">All Topics (${sortedTopics.length})</option>` +
    sortedTopics
      .map(
        (t) =>
          `<option value="${escapeXml(t)}" ${t.toLowerCase() === currentTopic.toLowerCase() ? "selected" : ""}>${escapeXml(t)}</option>`
      )
      .join("");

  authorFilterSelect.innerHTML =
    `<option value="">All Authors (${sortedAuthors.length})</option>` +
    sortedAuthors
      .map(
        (a) =>
          `<option value="${escapeXml(a)}" ${a.toLowerCase() === currentAuthor.toLowerCase() ? "selected" : ""}>${escapeXml(a)}</option>`
      )
      .join("");
}

function updateGraph() {
  const selTopic = topicFilterSelect.value.trim().toLowerCase();
  const selAuthor = authorFilterSelect.value.trim().toLowerCase();
  const selNodeType = nodeTypeSelect.value;
  const searchQuery = searchInput.value.trim().toLowerCase();

  // 1. Filter saved posts
  let filteredPosts = allSavedPosts.filter((p) => {
    if (selTopic) {
      const hasTopic = (p.topics || []).some((t) => typeof t === "string" && t.toLowerCase() === selTopic);
      if (!hasTopic) return false;
    }
    if (selAuthor) {
      const matchAuthor = (p.author || "").toLowerCase() === selAuthor;
      if (!matchAuthor) return false;
    }
    if (searchQuery) {
      const matchText = (p.text || "").toLowerCase().includes(searchQuery);
      const matchAuthor = (p.author || "").toLowerCase().includes(searchQuery);
      const matchTopic = (p.topics || []).some((t) => typeof t === "string" && t.toLowerCase().includes(searchQuery));
      if (!matchText && !matchAuthor && !matchTopic) return false;
    }
    return true;
  });

  // 2. Build deterministic base graph
  let graph = buildKnowledgeGraph(filteredPosts);

  // 3. Apply Node Type Filter (discards unselected node types and eliminates dangling edges)
  if (selNodeType !== "all") {
    graph = filterGraphByNodeType(graph, selNodeType);
  }

  // 4. Apply Focus Mode (if active)
  if (focusedNodeId) {
    graph = extractNeighborhood(graph, focusedNodeId);
  }

  // Check if graph structure is unchanged
  const isUnchanged = areGraphsEqual(activeGraph, graph);
  activeGraph = graph;

  console.log("[FeedRule][GRAPH] graph state:", {
    nodes: activeGraph.nodes.length,
    edges: activeGraph.edges.length,
    isUnchanged,
  });

  if (activeGraph.nodes.length === 0) {
    emptyState.style.display = "flex";
    emptyStateDesc.textContent = focusedNodeId || selTopic || selAuthor || searchQuery || selNodeType !== "all"
      ? "No graph nodes match your active filters or focused neighborhood."
      : "Posts saved in your Second Brain will automatically form your Knowledge Graph.";
  } else {
    emptyState.style.display = "none";
  }

  if (isUnchanged) {
    if (renderer) renderer.requestRender();
    return;
  }

  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 600;

  layout.init(activeGraph.nodes, activeGraph.edges, w, h);
  renderer.fitGraph();
}

function setFocusNode(nodeId, nodeLabel) {
  focusedNodeId = nodeId;
  focusBanner.style.display = "flex";
  focusLabel.textContent = `🎯 Focused Neighborhood: ${nodeLabel}`;
  updateGraph();
}

function exitFocus() {
  focusedNodeId = null;
  focusBanner.style.display = "none";
  updateGraph();
}

function clearFilters() {
  topicFilterSelect.value = "";
  authorFilterSelect.value = "";
  nodeTypeSelect.value = "all";
  searchInput.value = "";
  focusedNodeId = null;
  focusBanner.style.display = "none";
  updateGraph();
}

async function init() {
  allSavedPosts = await getSavedPosts();
  console.log("[FeedRule][GRAPH] loaded saved posts count:", allSavedPosts.length);

  updateFilterDropdowns(allSavedPosts);

  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 600;

  layout = new ForceLayout();
  layout.applyPreset("balanced");

  renderer = new GraphRenderer(canvas, layout, {
    onNodeClick: (node) => renderNodeDetails(node),
  });

  updateGraph();
  renderer.start();
}

// Event Listeners for Filters
topicFilterSelect.addEventListener("change", () => {
  focusedNodeId = null;
  focusBanner.style.display = "none";
  updateGraph();
});

authorFilterSelect.addEventListener("change", () => {
  focusedNodeId = null;
  focusBanner.style.display = "none";
  updateGraph();
});

nodeTypeSelect.addEventListener("change", () => {
  updateGraph();
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(updateGraph, 150);
});

clearFiltersBtn.addEventListener("click", clearFilters);
exitFocusBtn.addEventListener("click", exitFocus);

fitGraphBtn.addEventListener("click", () => {
  if (renderer) renderer.fitGraph();
});

resetViewBtn.addEventListener("click", () => {
  if (renderer) renderer.resetView();
});

// Physics Controls
// Initialize slider ranges from canonical physics configuration
densitySlider.min = String(PHYSICS_RANGES.repulsion.min);
densitySlider.max = String(PHYSICS_RANGES.repulsion.max);
densitySlider.step = String(PHYSICS_RANGES.repulsion.step);
densitySlider.value = String(PHYSICS_RANGES.repulsion.default);

spacingSlider.min = String(PHYSICS_RANGES.springLength.min);
spacingSlider.max = String(PHYSICS_RANGES.springLength.max);
spacingSlider.step = String(PHYSICS_RANGES.springLength.step);
spacingSlider.value = String(PHYSICS_RANGES.springLength.default);

gravitySlider.min = String(PHYSICS_RANGES.gravity.sliderMin);
gravitySlider.max = String(PHYSICS_RANGES.gravity.sliderMax);
gravitySlider.step = String(PHYSICS_RANGES.gravity.sliderStep);
gravitySlider.value = String(PHYSICS_RANGES.gravity.sliderDefault);

togglePhysicsBtn.addEventListener("click", () => {
  physicsPanel.classList.toggle("open");
});

function clearActivePresetButtons() {
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
}

densitySlider.addEventListener("input", () => {
  layout.setPhysics({ repulsion: parseInt(densitySlider.value, 10) });
  clearActivePresetButtons();
  if (renderer) renderer.requestRender();
});

spacingSlider.addEventListener("input", () => {
  layout.setPhysics({ springLength: parseInt(spacingSlider.value, 10) });
  clearActivePresetButtons();
  if (renderer) renderer.requestRender();
});

gravitySlider.addEventListener("input", () => {
  layout.setPhysics({ gravity: parseInt(gravitySlider.value, 10) / PHYSICS_RANGES.gravity.sliderScale });
  clearActivePresetButtons();
  if (renderer) renderer.requestRender();
});

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.getAttribute("data-preset");
    layout.applyPreset(preset);
    const p = PHYSICS_PRESETS[preset];
    densitySlider.value = p.repulsion;
    spacingSlider.value = p.springLength;
    gravitySlider.value = Math.round(p.gravity * 1000);
    clearActivePresetButtons();
    btn.classList.add("active");
    if (renderer) renderer.requestRender();
  });
});

resetPhysicsBtn.addEventListener("click", () => {
  layout.resetPhysics();
  const p = PHYSICS_PRESETS.balanced;
  densitySlider.value = p.repulsion;
  spacingSlider.value = p.springLength;
  gravitySlider.value = Math.round(p.gravity * 1000);
  clearActivePresetButtons();
  document.querySelector('.preset-btn[data-preset="balanced"]')?.classList.add("active");
  if (renderer) renderer.requestRender();
});

if (toggleSidebarBtn) {
  toggleSidebarBtn.addEventListener("click", () => {
    sidebar.classList.toggle("open");
  });
}

if (openBrainBtn) {
  console.log("[FeedRule][NAV] listener registered for #openBrainBtn in graph.js");
  openBrainBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[FeedRule][NAV] click intercepted on #openBrainBtn, preventDefault executed");
    await openExtensionPage("saved");
  });
}

if (openDashboardBtn) {
  console.log("[FeedRule][NAV] listener registered for #openDashboardBtn in graph.js");
  openDashboardBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("[FeedRule][NAV] click intercepted on #openDashboardBtn, preventDefault executed");
    await openExtensionPage("dashboard");
  });
}

init();
