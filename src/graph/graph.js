// src/graph/graph.js
// Knowledge Graph Visualizer controller for FeedRule Second Brain.

import {
  buildKnowledgeGraph,
  filterPostsByTopics,
  filterPostsByAuthors,
  filterGraphByNodeTypes,
  filterGraphByNodeType,
  extractNeighborhood,
  areGraphsEqual,
} from "./graph-builder.js";
import { ForceLayout, PHYSICS_PRESETS, PHYSICS_RANGES } from "./force-layout.js";
import { GraphRenderer } from "./graph-renderer.js";
import { getSavedPosts } from "../storage/saved-posts-store.js";
import { escapeXml } from "../dashboard/charts.js";
import { openExtensionPage } from "../navigation/navigation.js";
import { logger } from "../utils/logger.js";

// DOM Elements
const canvas = document.getElementById("graphCanvas");

// Filter Controls Elements
const nodeTypeDropdown = document.getElementById("nodeTypeDropdown");
const nodeTypeTrigger = document.getElementById("nodeTypeTrigger");
const nodeTypeSummary = document.getElementById("nodeTypeSummary");
const nodeTypeOptions = document.getElementById("nodeTypeOptions");
const nodeTypeSelectAll = document.getElementById("nodeTypeSelectAll");
const nodeTypeClear = document.getElementById("nodeTypeClear");

const topicDropdown = document.getElementById("topicDropdown");
const topicTrigger = document.getElementById("topicTrigger");
const topicSummary = document.getElementById("topicSummary");
const topicPopover = document.getElementById("topicPopover");
const topicSearchInput = document.getElementById("topicSearchInput");
const topicOptions = document.getElementById("topicOptions");
const topicSelectAll = document.getElementById("topicSelectAll");
const topicClear = document.getElementById("topicClear");

const authorDropdown = document.getElementById("authorDropdown");
const authorTrigger = document.getElementById("authorTrigger");
const authorSummary = document.getElementById("authorSummary");
const authorPopover = document.getElementById("authorPopover");
const authorSearchInput = document.getElementById("authorSearchInput");
const authorOptions = document.getElementById("authorOptions");
const authorSelectAll = document.getElementById("authorSelectAll");
const authorClear = document.getElementById("authorClear");

const searchInput = document.getElementById("searchGraph");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");
const fitGraphBtn = document.getElementById("fitGraphBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const focusBanner = document.getElementById("focusBanner");
const focusLabel = document.getElementById("focusLabel");
const exitFocusBtn = document.getElementById("exitFocusBtn");
const emptyState = document.getElementById("emptyState");
const emptyStateTitle = document.getElementById("emptyStateTitle");
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

// Multi-Select Filter State
const selectedNodeTypes = new Set(["post", "topic", "author"]);
const selectedTopics = new Set();   // Set of lowercase topic names (empty = all)
const selectedAuthors = new Set();  // Set of lowercase author names (empty = all)
let availableTopics = [];           // Array of { name, count, lower }
let availableAuthors = [];          // Array of { name, count, lower }

function closeAllDropdowns() {
  document.querySelectorAll(".multiselect-dropdown").forEach((d) => d.classList.remove("open"));
}

function updateNodeTypeSummary() {
  if (!nodeTypeSummary) return;
  const count = selectedNodeTypes.size;
  if (count === 3 || count === 0) {
    nodeTypeSummary.textContent = "Node Types: All";
  } else if (count === 1) {
    if (selectedNodeTypes.has("post")) nodeTypeSummary.textContent = "Posts only";
    else if (selectedNodeTypes.has("topic")) nodeTypeSummary.textContent = "Topics only";
    else if (selectedNodeTypes.has("author")) nodeTypeSummary.textContent = "Authors only";
  } else {
    nodeTypeSummary.textContent = `${count} types`;
  }
}

function updateTopicSummary() {
  if (!topicSummary) return;
  const count = selectedTopics.size;
  if (count === 0) {
    topicSummary.textContent = "Topics: All";
  } else if (count === 1) {
    const firstLower = Array.from(selectedTopics)[0];
    const match = availableTopics.find((t) => t.lower === firstLower);
    topicSummary.textContent = match ? `Topic: ${match.name}` : `Topics · 1`;
  } else {
    topicSummary.textContent = `Topics · ${count}`;
  }
}

function updateAuthorSummary() {
  if (!authorSummary) return;
  const count = selectedAuthors.size;
  if (count === 0) {
    authorSummary.textContent = "Authors: All";
  } else if (count === 1) {
    const firstLower = Array.from(selectedAuthors)[0];
    const match = availableAuthors.find((a) => a.lower === firstLower);
    authorSummary.textContent = match ? `Author: ${match.name}` : `Authors · 1`;
  } else {
    authorSummary.textContent = `Authors · ${count}`;
  }
}

function populateFilterOptions(posts) {
  const topicCounts = new Map();
  const authorCounts = new Map();
  const canonicalTopicNames = new Map();
  const canonicalAuthorNames = new Map();

  for (const p of posts) {
    for (const t of p.topics || []) {
      if (typeof t === "string" && t.trim()) {
        const clean = t.trim();
        const lower = clean.toLowerCase();
        topicCounts.set(lower, (topicCounts.get(lower) || 0) + 1);
        if (!canonicalTopicNames.has(lower)) {
          canonicalTopicNames.set(lower, clean);
        }
      }
    }
    if (typeof p.author === "string" && p.author.trim()) {
      const clean = p.author.trim();
      const lower = clean.toLowerCase();
      authorCounts.set(lower, (authorCounts.get(lower) || 0) + 1);
      if (!canonicalAuthorNames.has(lower)) {
        canonicalAuthorNames.set(lower, clean);
      }
    }
  }

  availableTopics = Array.from(topicCounts.keys())
    .map((lower) => ({
      name: canonicalTopicNames.get(lower),
      lower,
      count: topicCounts.get(lower),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  availableAuthors = Array.from(authorCounts.keys())
    .map((lower) => ({
      name: canonicalAuthorNames.get(lower),
      lower,
      count: authorCounts.get(lower),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  renderTopicOptionsList();
  renderAuthorOptionsList();
  updateNodeTypeSummary();
  updateTopicSummary();
  updateAuthorSummary();
}

function renderTopicOptionsList(filterQuery = "") {
  if (!topicOptions) return;
  const q = filterQuery.trim().toLowerCase();
  const filtered = q
    ? availableTopics.filter((t) => t.lower.includes(q))
    : availableTopics;

  if (filtered.length === 0) {
    topicOptions.innerHTML = `<div class="multiselect-empty">${availableTopics.length === 0 ? "No topics found" : "No matching topics"}</div>`;
    return;
  }

  topicOptions.innerHTML = filtered
    .map((t) => {
      const isChecked = selectedTopics.has(t.lower);
      return `
        <label class="multiselect-option">
          <input type="checkbox" data-topic="${escapeXml(t.lower)}" ${isChecked ? "checked" : ""} />
          <span class="option-dot dot-topic"></span>
          <span>${escapeXml(t.name)} (${t.count})</span>
        </label>
      `;
    })
    .join("");

  topicOptions.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      const lower = cb.getAttribute("data-topic");
      if (cb.checked) {
        selectedTopics.add(lower);
      } else {
        selectedTopics.delete(lower);
      }
      updateTopicSummary();
      focusedNodeId = null;
      if (focusBanner) focusBanner.style.display = "none";
      updateGraph();
    });
  });
}

function renderAuthorOptionsList(filterQuery = "") {
  if (!authorOptions) return;
  const q = filterQuery.trim().toLowerCase();
  const filtered = q
    ? availableAuthors.filter((a) => a.lower.includes(q))
    : availableAuthors;

  if (filtered.length === 0) {
    authorOptions.innerHTML = `<div class="multiselect-empty">${availableAuthors.length === 0 ? "No authors found" : "No matching authors"}</div>`;
    return;
  }

  authorOptions.innerHTML = filtered
    .map((a) => {
      const isChecked = selectedAuthors.has(a.lower);
      return `
        <label class="multiselect-option">
          <input type="checkbox" data-author="${escapeXml(a.lower)}" ${isChecked ? "checked" : ""} />
          <span class="option-dot dot-author"></span>
          <span>${escapeXml(a.name)} (${a.count})</span>
        </label>
      `;
    })
    .join("");

  authorOptions.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      const lower = cb.getAttribute("data-author");
      if (cb.checked) {
        selectedAuthors.add(lower);
      } else {
        selectedAuthors.delete(lower);
      }
      updateAuthorSummary();
      focusedNodeId = null;
      if (focusBanner) focusBanner.style.display = "none";
      updateGraph();
    });
  });
}

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

function updateGraph() {
  const searchQuery = (searchInput ? searchInput.value : "").trim().toLowerCase();

  // 1. Filter saved posts with pure functions
  let filteredPosts = filterPostsByTopics(allSavedPosts, selectedTopics);
  filteredPosts = filterPostsByAuthors(filteredPosts, selectedAuthors);

  if (searchQuery) {
    filteredPosts = filteredPosts.filter((p) => {
      const matchText = (p.text || "").toLowerCase().includes(searchQuery);
      const matchAuthor = (p.author || "").toLowerCase().includes(searchQuery);
      const matchTopic = (p.topics || []).some(
        (t) => typeof t === "string" && t.toLowerCase().includes(searchQuery)
      );
      return matchText || matchAuthor || matchTopic;
    });
  }

  // 2. Build deterministic base graph
  let graph = buildKnowledgeGraph(filteredPosts);

  // 3. Apply Node Types Filter (discards unselected node types and eliminates dangling edges)
  graph = filterGraphByNodeTypes(graph, selectedNodeTypes);

  // 4. Apply Focus Mode (if active)
  if (focusedNodeId) {
    graph = extractNeighborhood(graph, focusedNodeId);
  }

  // Check if graph structure is unchanged
  const isUnchanged = areGraphsEqual(activeGraph, graph);
  activeGraph = graph;

  // Stale Selection Invariant: If selected node is no longer in activeGraph, clear selection and reset sidebar
  if (renderer && renderer.selectedNode) {
    const nodeStillExists = activeGraph.nodes.some((n) => n.id === renderer.selectedNode.id);
    if (!nodeStillExists) {
      renderer.selectedNode = null;
      renderNodeDetails(null);
    }
  }

  // Stale Focus Invariant: If focused node is no longer in activeGraph, clear focus mode
  if (focusedNodeId) {
    const focusNodeStillExists = activeGraph.nodes.some((n) => n.id === focusedNodeId);
    if (!focusNodeStillExists) {
      focusedNodeId = null;
      if (focusBanner) focusBanner.style.display = "none";
    }
  }

  logger.debug("GRAPH", "graph state:", {
    nodes: activeGraph.nodes.length,
    edges: activeGraph.edges.length,
    isUnchanged,
  });

  if (activeGraph.nodes.length === 0) {
    emptyState.style.display = "flex";
    if (allSavedPosts.length === 0) {
      if (emptyStateTitle) emptyStateTitle.textContent = "No Saved Posts Found";
      emptyStateDesc.textContent = "Posts saved in your Second Brain will automatically form your Knowledge Graph.";
    } else if (focusedNodeId) {
      if (emptyStateTitle) emptyStateTitle.textContent = "Empty Focused Neighborhood";
      emptyStateDesc.textContent = "The focused node has no remaining connections under your active filter criteria.";
    } else {
      if (emptyStateTitle) emptyStateTitle.textContent = "No Matching Nodes";
      emptyStateDesc.textContent = "No graph nodes match your active topic, author, node type, or search filters. Try clearing some filters.";
    }
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
  if (focusBanner) focusBanner.style.display = "flex";
  if (focusLabel) focusLabel.textContent = `🎯 Focused Neighborhood: ${nodeLabel}`;
  updateGraph();
}

function exitFocus() {
  focusedNodeId = null;
  if (focusBanner) focusBanner.style.display = "none";
  updateGraph();
}

function clearFilters() {
  selectedNodeTypes.clear();
  selectedNodeTypes.add("post");
  selectedNodeTypes.add("topic");
  selectedNodeTypes.add("author");
  if (nodeTypeOptions) {
    nodeTypeOptions.querySelectorAll("input[type='checkbox']").forEach((cb) => (cb.checked = true));
  }

  selectedTopics.clear();
  selectedAuthors.clear();
  if (searchInput) searchInput.value = "";
  if (topicSearchInput) topicSearchInput.value = "";
  if (authorSearchInput) authorSearchInput.value = "";

  renderTopicOptionsList();
  renderAuthorOptionsList();
  updateNodeTypeSummary();
  updateTopicSummary();
  updateAuthorSummary();

  focusedNodeId = null;
  if (focusBanner) focusBanner.style.display = "none";
  updateGraph();
}

async function init() {
  allSavedPosts = await getSavedPosts();
  logger.debug("GRAPH", "loaded saved posts count:", allSavedPosts.length);

  populateFilterOptions(allSavedPosts);

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

// Multi-Select Dropdown Popover Toggles
if (nodeTypeTrigger) {
  nodeTypeTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = nodeTypeDropdown.classList.contains("open");
    closeAllDropdowns();
    if (!isOpen) nodeTypeDropdown.classList.add("open");
  });
}

if (topicTrigger) {
  topicTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = topicDropdown.classList.contains("open");
    closeAllDropdowns();
    if (!isOpen) {
      topicDropdown.classList.add("open");
      if (topicSearchInput) topicSearchInput.focus();
    }
  });
}

if (authorTrigger) {
  authorTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = authorDropdown.classList.contains("open");
    closeAllDropdowns();
    if (!isOpen) {
      authorDropdown.classList.add("open");
      if (authorSearchInput) authorSearchInput.focus();
    }
  });
}

// Stop popover clicks from bubbling to document
[nodeTypePopover, topicPopover, authorPopover].forEach((popover) => {
  if (popover) {
    popover.addEventListener("click", (e) => e.stopPropagation());
  }
});

// Close popovers on click outside and on Escape key
document.addEventListener("click", (e) => {
  if (!e.target.closest(".multiselect-dropdown")) {
    closeAllDropdowns();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllDropdowns();
  }
});

// Node Type Dropdown Checkbox Controls
if (nodeTypeOptions) {
  nodeTypeOptions.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    cb.addEventListener("change", () => {
      const val = cb.value;
      if (cb.checked) {
        selectedNodeTypes.add(val);
      } else {
        selectedNodeTypes.delete(val);
      }
      updateNodeTypeSummary();
      updateGraph();
    });
  });
}

if (nodeTypeSelectAll) {
  nodeTypeSelectAll.addEventListener("click", () => {
    selectedNodeTypes.add("post");
    selectedNodeTypes.add("topic");
    selectedNodeTypes.add("author");
    if (nodeTypeOptions) {
      nodeTypeOptions.querySelectorAll("input[type='checkbox']").forEach((cb) => (cb.checked = true));
    }
    updateNodeTypeSummary();
    updateGraph();
  });
}

if (nodeTypeClear) {
  nodeTypeClear.addEventListener("click", () => {
    selectedNodeTypes.clear();
    if (nodeTypeOptions) {
      nodeTypeOptions.querySelectorAll("input[type='checkbox']").forEach((cb) => (cb.checked = false));
    }
    updateNodeTypeSummary();
    updateGraph();
  });
}

// Topic Dropdown Controls
if (topicSearchInput) {
  topicSearchInput.addEventListener("input", () => {
    renderTopicOptionsList(topicSearchInput.value);
  });
}

if (topicSelectAll) {
  topicSelectAll.addEventListener("click", () => {
    for (const t of availableTopics) {
      selectedTopics.add(t.lower);
    }
    renderTopicOptionsList(topicSearchInput?.value || "");
    updateTopicSummary();
    updateGraph();
  });
}

if (topicClear) {
  topicClear.addEventListener("click", () => {
    selectedTopics.clear();
    renderTopicOptionsList(topicSearchInput?.value || "");
    updateTopicSummary();
    updateGraph();
  });
}

// Author Dropdown Controls
if (authorSearchInput) {
  authorSearchInput.addEventListener("input", () => {
    renderAuthorOptionsList(authorSearchInput.value);
  });
}

if (authorSelectAll) {
  authorSelectAll.addEventListener("click", () => {
    for (const a of availableAuthors) {
      selectedAuthors.add(a.lower);
    }
    renderAuthorOptionsList(authorSearchInput?.value || "");
    updateAuthorSummary();
    updateGraph();
  });
}

if (authorClear) {
  authorClear.addEventListener("click", () => {
    selectedAuthors.clear();
    renderAuthorOptionsList(authorSearchInput?.value || "");
    updateAuthorSummary();
    updateGraph();
  });
}

// Search and Global Controls
if (searchInput) {
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(updateGraph, 150);
  });
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener("click", clearFilters);
}

if (exitFocusBtn) {
  exitFocusBtn.addEventListener("click", exitFocus);
}

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
