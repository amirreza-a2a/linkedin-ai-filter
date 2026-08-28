// src/saved/saved.js
import { getSavedPosts, unsavePost } from "../storage/saved-posts-store.js";
import { exportToMarkdown, exportToJson } from "../export/export-helper.js";

const searchInput = document.getElementById("searchInput");
const topicSelect = document.getElementById("topicSelect");
const statsBar = document.getElementById("statsBar");
const postsList = document.getElementById("postsList");
const exportMdBtn = document.getElementById("exportMdBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const openGraphBtn = document.getElementById("openGraphBtn");

let allPosts = [];

function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderStats(posts, totalCount) {
  const uniqueTopics = new Set();
  for (const p of posts) {
    for (const t of p.topics || []) uniqueTopics.add(t);
  }
  statsBar.textContent = `${posts.length} ${posts.length === 1 ? "post" : "posts"} displayed (${uniqueTopics.size} unique topics) • Total saved: ${totalCount}`;
}

function updateTopicDropdown(posts) {
  const currentVal = topicSelect.value;
  const topicsSet = new Set();
  for (const p of posts) {
    for (const t of p.topics || []) topicsSet.add(t);
  }

  const sortedTopics = Array.from(topicsSet).sort((a, b) => a.localeCompare(b));
  topicSelect.innerHTML = `<option value="">All Topics (${sortedTopics.length})</option>` +
    sortedTopics.map((t) => `<option value="${escapeHtml(t)}" ${t === currentVal ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");
}

function renderPosts(posts) {
  if (posts.length === 0) {
    postsList.innerHTML = `
      <div class="empty-state">
        <h3>No saved posts found</h3>
        <p>Posts matching your auto-save rules or saved manually will appear here.</p>
      </div>
    `;
    return;
  }

  postsList.innerHTML = posts
    .map((p) => {
      const dateStr = p.savedAt ? new Date(p.savedAt).toLocaleString() : "";
      const authorHtml = p.authorUrl
        ? `<a class="author-name" href="${escapeHtml(p.authorUrl)}" target="_blank" rel="noopener">${escapeHtml(p.author || "LinkedIn Author")}</a>`
        : `<span class="author-name">${escapeHtml(p.author || "LinkedIn Author")}</span>`;

      const linkHtml = p.postUrl
        ? `<a class="permalink" href="${escapeHtml(p.postUrl)}" target="_blank" rel="noopener">Open on LinkedIn ↗</a>`
        : `<span></span>`;

      const reasonBadge = p.saveReason
        ? `<span class="badge badge-reason">${escapeHtml(p.saveReason)}</span>`
        : "";

      const topicBadges = (p.topics || [])
        .map((t) => `<span class="badge badge-topic">#${escapeHtml(t)}</span>`)
        .join("");

      return `
        <div class="post-card" data-id="${escapeHtml(p.id)}">
          <div class="card-header">
            <div class="author-info">
              ${authorHtml}
              <span class="post-date">Saved on ${escapeHtml(dateStr)}</span>
            </div>
            <div class="meta-badges">
              ${reasonBadge}
              ${topicBadges}
            </div>
          </div>
          <div class="post-text">${escapeHtml(p.text)}</div>
          <div class="card-footer">
            ${linkHtml}
            <button class="btn btn-danger unsave-btn" data-id="${escapeHtml(p.id)}">Unsave</button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach unsave listeners
  const buttons = postsList.querySelectorAll(".unsave-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      if (!id) return;
      await unsavePost(id);
      await load();
    });
  });
}

function filterAndRender() {
  const q = searchInput.value.trim().toLowerCase();
  const selTopic = topicSelect.value.trim().toLowerCase();

  const filtered = allPosts.filter((p) => {
    if (selTopic) {
      const hasTopic = (p.topics || []).some((t) => t.toLowerCase() === selTopic);
      if (!hasTopic) return false;
    }
    if (q) {
      const matchText = (p.text || "").toLowerCase().includes(q);
      const matchAuthor = (p.author || "").toLowerCase().includes(q);
      const matchReason = (p.saveReason || "").toLowerCase().includes(q);
      const matchTopic = (p.topics || []).some((t) => t.toLowerCase().includes(q));
      if (!matchText && !matchAuthor && !matchReason && !matchTopic) return false;
    }
    return true;
  });

  renderStats(filtered, allPosts.length);
  renderPosts(filtered);
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

exportMdBtn.addEventListener("click", () => {
  const md = exportToMarkdown(allPosts);
  const filename = `linkedin-second-brain-${new Date().toISOString().slice(0, 10)}.md`;
  downloadFile(filename, md, "text/markdown;charset=utf-8");
});

exportJsonBtn.addEventListener("click", () => {
  const json = exportToJson(allPosts);
  const filename = `linkedin-second-brain-${new Date().toISOString().slice(0, 10)}.json`;
  downloadFile(filename, json, "application/json;charset=utf-8");
});

if (openGraphBtn) {
  openGraphBtn.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("src/graph/graph.html") });
  });
}

searchInput.addEventListener("input", filterAndRender);
topicSelect.addEventListener("change", filterAndRender);

async function load() {
  allPosts = await getSavedPosts();
  updateTopicDropdown(allPosts);
  filterAndRender();
}

load();
