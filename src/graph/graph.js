// src/graph/graph.js
import { getSavedPosts } from "../storage/saved-posts-store.js";
import { buildKnowledgeGraph } from "./graph-builder.js";
import { ForceLayout } from "./force-layout.js";
import { GraphRenderer } from "./graph-renderer.js";
import { escapeXml } from "../dashboard/charts.js";

const canvas = document.getElementById("graphCanvas");
const sidebar = document.getElementById("sidebar");
const searchInput = document.getElementById("searchGraph");
const resetViewBtn = document.getElementById("resetViewBtn");
const emptyState = document.getElementById("emptyState");
const openBrainBtn = document.getElementById("openBrainBtn");
const openDashboardBtn = document.getElementById("openDashboardBtn");

let layout = null;
let renderer = null;
let graphData = null;
let allSavedPosts = [];

function renderNodeDetails(node) {
  if (!node) {
    sidebar.innerHTML = `
      <div class="empty-prompt">
        <p>💡 Click any node on the graph to inspect its relationships and details.</p>
      </div>
    `;
    return;
  }

  if (node.type === "post") {
    const p = node.data || {};
    const dateStr = p.savedAt ? new Date(p.savedAt).toLocaleString() : "Unknown";
    const authorLink = p.authorUrl
      ? `<a class="link" href="${escapeXml(p.authorUrl)}" target="_blank" rel="noopener">${escapeXml(p.author || "LinkedIn Author")}</a>`
      : escapeXml(p.author || "LinkedIn Author");

    const postLink = p.postUrl
      ? `<p><a class="link" href="${escapeXml(p.postUrl)}" target="_blank" rel="noopener">Open Original on LinkedIn ↗</a></p>`
      : "";

    const topicBadges = (p.topics || [])
      .map((t) => `<span class="badge badge-topic">#${escapeXml(t)}</span>`)
      .join("");

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <span class="badge badge-post" style="background:#e8f3ff; color:#0a66c2; border:1px solid #b3d7ff;">Saved Post</span>
      </div>
      <div class="detail-card">
        <p><strong>Author:</strong> ${authorLink}</p>
        <p><strong>Saved:</strong> ${escapeXml(dateStr)}</p>
        <p><strong>Reason:</strong> ${escapeXml(p.saveReason || "Manual save")}</p>
        <p style="margin-top:6px;"><strong>Topics:</strong><br>${topicBadges || "—"}</p>
        ${postLink}
      </div>
      <div class="detail-card">
        <strong>Content:</strong>
        <div class="detail-text">${escapeXml(p.text || "")}</div>
      </div>
    `;
  } else if (node.type === "topic") {
    // Find all posts with this topic
    const connectedPostIds = new Set(
      graphData.edges
        .filter((e) => e.target === node.id && e.type === "has-topic")
        .map((e) => e.source)
    );

    const matchingPosts = allSavedPosts.filter((p) => connectedPostIds.has(`post:${p.id}`));

    const postsHtml = matchingPosts
      .map((p) => {
        const textExcerpt = (p.text || "").slice(0, 100);
        return `
          <div class="connected-item" data-post-id="${escapeXml(p.id)}">
            <div style="font-weight:600; color:#334155; margin-bottom:2px;">${escapeXml(p.author || "LinkedIn Author")}</div>
            <div style="color:#64748b;">${escapeXml(textExcerpt)}${textExcerpt.length >= 100 ? "…" : ""}</div>
          </div>
        `;
      })
      .join("");

    sidebar.innerHTML = `
      <div class="sidebar-header">
        <span class="badge badge-topic">#${escapeXml(node.label)}</span>
        <span style="font-size:12px; color:#64748b; font-weight:normal;">(${matchingPosts.length} saved posts)</span>
      </div>
      <p style="font-size:12.5px; color:#475569; margin-bottom:10px;">All saved posts tagged with this topic:</p>
      <div class="connected-list">${postsHtml || "<p style='color:#94a3b8; font-size:12px;'>No posts connected.</p>"}</div>
    `;

    // Click on connected post in sidebar focuses the post node
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
    // Find all posts written by this author
    const connectedPostIds = new Set(
      graphData.edges
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
        <span class="badge badge-author">👤 ${escapeXml(node.label)}</span>
        <span style="font-size:12px; color:#64748b; font-weight:normal;">(${matchingPosts.length} posts)</span>
      </div>
      <div style="margin-bottom:12px;">${profileLink}</div>
      <p style="font-size:12.5px; color:#475569; margin-bottom:10px;">Saved posts written by this author:</p>
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
}

async function init() {
  allSavedPosts = await getSavedPosts();

  if (allSavedPosts.length === 0) {
    emptyState.style.display = "flex";
    return;
  }
  emptyState.style.display = "none";

  graphData = buildKnowledgeGraph(allSavedPosts);

  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width || 800;
  const h = rect.height || 600;

  layout = new ForceLayout({
    repulsion: 1400,
    springLength: 95,
    springStrength: 0.04,
    gravity: 0.02,
  });
  layout.init(graphData.nodes, graphData.edges, w, h);

  renderer = new GraphRenderer(canvas, layout, {
    onNodeClick: (node) => renderNodeDetails(node),
    onNodeHover: (node) => {
      // Optional status feedback if needed
    },
  });

  renderer.start();
}

resetViewBtn.addEventListener("click", () => {
  if (renderer) renderer.resetView();
});

searchInput.addEventListener("input", () => {
  const q = searchInput.value.trim().toLowerCase();
  if (!q || !layout) return;

  const found = layout.nodes.find((n) => n.label.toLowerCase().includes(q));
  if (found) {
    renderer.selectedNode = found;
    renderNodeDetails(found);
    renderer.requestRender();
  }
});

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
