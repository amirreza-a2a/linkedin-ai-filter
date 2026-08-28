// src/graph/graph.js
import { getSavedPosts } from "../storage/saved-posts-store.js";
import {
  buildKnowledgeGraph,
  filterGraphByNodeType,
  extractNeighborhood,
} from "./graph-builder.js";
import { ForceLayout, PHYSICS_PRESETS } from "./force-layout.js";
import { GraphRenderer } from "./graph-renderer.js";
import { escapeXml } from "../dashboard/charts.js";

const canvas = document.getElementById("graphCanvas");
const sidebar = document.getElementById("sidebar");
const searchInput = document.getElementById("searchGraph");
const topicFilterSelect = document.getElementById("topicFilterSelect");
const authorFilterSelect = document.getElementById("authorFilterSelect");
const nodeTypeSelect = document.getElementById("nodeTypeSelect");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");

const focusBanner = document.getElementById("focusBanner");
const focusLabel = document.getElementById("focusLabel");
const exitFocusBtn = document.getElementById("exitFocusBtn");

const fitGraphBtn = document.getElementById("fitGraphBtn");
const resetViewBtn = document.getElementById("resetViewBtn");
const togglePhysicsBtn = document.getElementById("togglePhysicsBtn");
const physicsPanel = document.getElementById("physicsPanel");
const densitySlider = document.getElementById("densitySlider");
const spacingSlider = document.getElementById("spacingSlider");
const gravitySlider = document.getElementById("gravitySlider");
const resetPhysicsBtn = document.getElementById("resetPhysicsBtn");

const emptyState = document.getElementById("emptyState");
const emptyStateDesc = document.getElementById("emptyStateDesc");
const openBrainBtn = document.getElementById("openBrainBtn");
const openDashboardBtn = document.getElementById("openDashboardBtn");
const toggleSidebarBtn = document.getElementById("toggleSidebarBtn");

let layout = null;
let renderer = null;
let activeGraph = { nodes: [], edges: [] };
let allSavedPosts = [];
let focusedNodeId = null;

function renderNodeDetails(node) {
  if (!node) {
    sidebar.innerHTML = `
      <div class="empty-prompt">
        <p>💡 Click any node on the graph to inspect its relationships and details.</p>
      </div>
    `;
    return;
  }

  // Open sidebar on mobile if collapsed
  sidebar.classList.add("open");

  if (node.type === "post") {
    const p = node.data || {};
    const dateStr = p.savedAt ? new Date(p.savedAt).toLocaleString() : "Unknown";
    const authorDisplayName = p.author
      ? escapeXml(p.author)
      : `<span style="color:#94a3b8; font-style:italic;">Author unavailable</span>`;

    const authorLink = p.authorUrl
      ? `<a class="link" href="${escapeXml(p.authorUrl)}" target="_blank" rel="noopener">${authorDisplayName}</a>`
      : authorDisplayName;

    const postLink = p.postUrl
      ? `<p><a class="link" href="${escapeXml(p.postUrl)}" target="_blank" rel="noopener">Open Original on LinkedIn ↗</a></p>`
      : `<p class="unavailable-link">Original link unavailable</p>`;

    const topicBadges = (p.topics || [])
      .map((t) => `<span class="badge badge-topic">#${escapeXml(t)}</span>`)
      .join("");

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <span class="badge badge-post" style="background:#e8f3ff; color:#0a66c2; border:1px solid #b3d7ff;">Saved Post</span>
        <button class="btn btn-secondary btn-sm" id="focusNodeBtn">🎯 Focus</button>
      </div>
      <div class="detail-card">
        <p><strong>Author:</strong> ${authorLink}</p>
        <p><strong>Saved:</strong> ${escapeXml(dateStr)}</p>
        <p><strong>Reason:</strong> ${escapeXml(p.saveReason || "Manual save")}</p>
        <p style="margin-top:6px;"><strong>Topics:</strong><br>${topicBadges || "—"}</p>
        <div style="margin-top:8px;">${postLink}</div>
      </div>
      <div class="detail-card">
        <strong>Content:</strong>
        <div class="detail-text">${escapeXml(p.text || "")}</div>
      </div>
    `;
  } else if (node.type === "topic") {
    // Find all posts connected to this topic in the active graph
    const connectedPostIds = new Set(
      activeGraph.edges
        .filter((e) => e.target === node.id && e.type === "has-topic")
        .map((e) => e.source)
    );

    const matchingPosts = allSavedPosts.filter((p) => connectedPostIds.has(`post:${p.id}`));

    const postsHtml = matchingPosts
      .map((p) => {
        const textExcerpt = (p.text || "").slice(0, 100);
        return `
          <div class="connected-item" data-post-id="${escapeXml(p.id)}">
            <div style="font-weight:600; color:#334155; margin-bottom:2px;">${escapeXml(p.author || "Author unavailable")}</div>
            <div style="color:#64748b;">${escapeXml(textExcerpt)}${textExcerpt.length >= 100 ? "…" : ""}</div>
          </div>
        `;
      })
      .join("");

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <div>
          <span class="badge badge-topic">#${escapeXml(node.label)}</span>
          <span style="font-size:12px; color:#64748b; font-weight:normal;">(${matchingPosts.length} posts)</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="focusNodeBtn">🎯 Focus</button>
      </div>
      <p style="font-size:12px; color:#475569; margin-bottom:8px;">Saved posts tagged with this topic:</p>
      <div class="connected-list">${postsHtml || "<p style='color:#94a3b8; font-size:12px;'>No posts connected.</p>"}</div>
    `;

    sidebar.querySelectorAll(".connected-item").forEach((el) => {
      el.addEventListener("click", () => {
        const pId = el.getAttribute("data-post-id");
        const targetNode = layout.nodeMap.get(`post:${pId}`);
        if (targetNode) {
          renderer.selectedNode = targetNode;
          renderNodeDetails(targetNode);
          renderer.requestRender();
        }
      });
    });
  } else if (node.type === "author") {
    // Find all posts written by this author in the active graph
    const connectedPostIds = new Set(
      activeGraph.edges
        .filter((e) => e.target === node.id && e.type === "written-by")
        .map((e) => e.source)
    );

    const matchingPosts = allSavedPosts.filter((p) => connectedPostIds.has(`post:${p.id}`));

    const profileLink = node.authorUrl
      ? `<a class="link" href="${escapeXml(node.authorUrl)}" target="_blank" rel="noopener" style="font-size:12px;">View LinkedIn Profile ↗</a>`
      : "";

    const postsHtml = matchingPosts
      .map((p) => {
        const textExcerpt = (p.text || "").slice(0, 100);
        return `
          <div class="connected-item" data-post-id="${escapeXml(p.id)}">
            <div style="color:#64748b;">${escapeXml(textExcerpt)}${textExcerpt.length >= 100 ? "…" : ""}</div>
          </div>
        `;
      })
      .join("");

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <div>
          <span class="badge badge-author">👤 ${escapeXml(node.label)}</span>
          <span style="font-size:12px; color:#64748b; font-weight:normal;">(${matchingPosts.length} posts)</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="focusNodeBtn">🎯 Focus</button>
      </div>
      <div style="margin-bottom:10px;">${profileLink}</div>
      <p style="font-size:12px; color:#475569; margin-bottom:8px;">Saved posts written by this author:</p>
      <div class="connected-list">${postsHtml || "<p style='color:#94a3b8; font-size:12px;'>No posts connected.</p>"}</div>
    `;

    sidebar.querySelectorAll(".connected-item").forEach((el) => {
      el.addEventListener("click", () => {
        const pId = el.getAttribute("data-post-id");
        const targetNode = layout.nodeMap.get(`post:${pId}`);
        if (targetNode) {
          renderer.selectedNode = targetNode;
          renderNodeDetails(targetNode);
          renderer.requestRender();
        }
      });
    });
  }

  // Wire Focus Button
  const focusBtn = sidebar.querySelector("#focusNodeBtn");
  if (focusBtn) {
    focusBtn.addEventListener("click", () => {
      setFocusNode(node.id, node.label);
    });
  }
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

  activeGraph = graph;

  if (activeGraph.nodes.length === 0) {
    emptyState.style.display = "flex";
    emptyStateDesc.textContent = focusedNodeId || selTopic || selAuthor || searchQuery || selNodeType !== "all"
      ? "No graph nodes match your active filters or focused neighborhood."
      : "Posts saved in your Second Brain will automatically form your Knowledge Graph.";
  } else {
    emptyState.style.display = "none";
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
  updateGraph();
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
  layout.setPhysics({ gravity: parseInt(gravitySlider.value, 10) / 1000 });
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
  openBrainBtn.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("src/saved/saved.html") });
  });
}

if (openDashboardBtn) {
  openDashboardBtn.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
  });
}

init();
