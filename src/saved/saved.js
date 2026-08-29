// src/saved/saved.js
import { getSavedPosts, unsavePost } from "../storage/saved-posts-store.js";
import { exportToMarkdown, exportToJson } from "../export/export-helper.js";
import { openExtensionPage } from "../navigation/navigation.js";
import { logger } from "../utils/logger.js";

export const PAGE_STATE = {
  LOADING: "loading",
  READY: "ready",
  EMPTY: "empty",
  ERROR: "error",
};

const searchInput = typeof document !== "undefined" ? document.getElementById("searchInput") : null;
const topicSelect = typeof document !== "undefined" ? document.getElementById("topicSelect") : null;
const statsBar = typeof document !== "undefined" ? document.getElementById("statsBar") : null;
const postsList = typeof document !== "undefined" ? document.getElementById("postsList") : null;
const exportMdBtn = typeof document !== "undefined" ? document.getElementById("exportMdBtn") : null;
const exportJsonBtn = typeof document !== "undefined" ? document.getElementById("exportJsonBtn") : null;
const openGraphBtn = typeof document !== "undefined" ? document.getElementById("openGraphBtn") : null;

let allPosts = [];
let currentPageState = PAGE_STATE.LOADING;
const inFlightUnsaves = new Set();

export function escapeHtml(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function setPageState(state, errorMessage = "") {
  currentPageState = state;
  if (!statsBar) return;

  if (state === PAGE_STATE.LOADING) {
    statsBar.textContent = "Loading saved posts...";
  } else if (state === PAGE_STATE.ERROR) {
    statsBar.textContent = errorMessage || "Error loading saved posts from storage.";
    if (postsList) {
      postsList.innerHTML = `
        <div class="empty-state">
          <h3 style="color:#d11;">Failed to load saved posts</h3>
          <p>${escapeHtml(errorMessage || "An unexpected error occurred while retrieving saved posts. Please try reloading.")}</p>
        </div>
      `;
    }
  }
}

export function renderStats(filteredPosts, totalCount) {
  if (!statsBar) return;
  const uniqueTopics = new Set();
  for (const p of filteredPosts) {
    for (const t of p.topics || []) {
      if (typeof t === "string" && t.trim()) uniqueTopics.add(t.trim());
    }
  }

  if (totalCount === 0) {
    statsBar.textContent = "0 posts saved";
  } else if (filteredPosts.length === totalCount) {
    statsBar.textContent = `${totalCount} ${totalCount === 1 ? "post" : "posts"} saved (${uniqueTopics.size} unique topics)`;
  } else {
    statsBar.textContent = `${filteredPosts.length} of ${totalCount} ${totalCount === 1 ? "post" : "posts"} displayed (${uniqueTopics.size} unique topics)`;
  }
}

export function updateTopicDropdown(posts) {
  if (!topicSelect) return;
  const currentVal = topicSelect.value ? topicSelect.value.trim().toLowerCase() : "";
  const topicsSet = new Set();
  for (const p of posts) {
    for (const t of p.topics || []) {
      if (typeof t === "string" && t.trim()) {
        topicsSet.add(t.trim());
      }
    }
  }

  const sortedTopics = Array.from(topicsSet).sort((a, b) => a.localeCompare(b));
  const isCurrentStillValid = currentVal && sortedTopics.some((t) => t.toLowerCase() === currentVal);
  const selectedTopic = isCurrentStillValid ? currentVal : "";

  topicSelect.innerHTML =
    `<option value="">All Topics (${sortedTopics.length})</option>` +
    sortedTopics
      .map((t) => {
        const isSelected = t.toLowerCase() === selectedTopic;
        return `<option value="${escapeHtml(t)}" ${isSelected ? "selected" : ""}>${escapeHtml(t)}</option>`;
      })
      .join("");
}

export async function handleUnsave(postId, btnElement) {
  if (!postId || inFlightUnsaves.has(postId)) return;

  inFlightUnsaves.add(postId);
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.textContent = "Unsaving...";
  }

  try {
    const success = await unsavePost(postId);
    if (!success) {
      logger.warn("SAVED", `Storage unsave was unsuccessful for post ${postId}`);
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.textContent = "Unsave";
      }
      alert("Could not remove post from storage. Please try again.");
      return;
    }

    // Strictly only on confirmed persistent storage success:
    allPosts = allPosts.filter((p) => p.id !== postId);

    // Update topic dropdown to reflect any pruned topics
    updateTopicDropdown(allPosts);

    // Re-filter and re-render preserving search and topic filters
    filterAndRender();
  } catch (err) {
    logger.error("SAVED", `Failed to unsave post ${postId}:`, err);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = "Unsave";
    }
    alert("Failed to unsave post. Please try again.");
  } finally {
    inFlightUnsaves.delete(postId);
  }
}

export function renderPosts(posts) {
  if (!postsList) return;

  if (posts.length === 0) {
    if (allPosts.length === 0) {
      postsList.innerHTML = `
        <div class="empty-state">
          <h3>No saved posts found</h3>
          <p>Posts matching your auto-save rules or saved manually will appear here.</p>
        </div>
      `;
    } else {
      postsList.innerHTML = `
        <div class="empty-state">
          <h3>No matching posts found</h3>
          <p>No saved posts match your active search query or selected topic filter.</p>
        </div>
      `;
    }
    return;
  }

  postsList.innerHTML = posts
    .map((p) => {
      const dateStr = p.savedAt ? new Date(p.savedAt).toLocaleString() : "";
      const authorDisplayName = p.author
        ? escapeHtml(p.author)
        : `<span style="color:#94a3b8; font-style:italic;">Author unavailable</span>`;

      const authorHtml = p.authorUrl
        ? `<a class="author-name" href="${escapeHtml(p.authorUrl)}" target="_blank" rel="noopener">${authorDisplayName}</a>`
        : `<span class="author-name">${authorDisplayName}</span>`;

      const linkHtml = p.postUrl
        ? `<a class="permalink" href="${escapeHtml(p.postUrl)}" target="_blank" rel="noopener">Open on LinkedIn ↗</a>`
        : `<span style="color:#94a3b8; font-size:11.5px; font-style:italic;">Original link unavailable</span>`;

      const reasonBadge = p.saveReason
        ? `<span class="badge badge-reason">${escapeHtml(p.saveReason)}</span>`
        : "";

      const topicBadges = (p.topics || [])
        .map((t) => `<span class="badge badge-topic">#${escapeHtml(t)}</span>`)
        .join("");

      const isUnsaving = inFlightUnsaves.has(p.id);

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
            <button class="btn btn-danger unsave-btn" data-id="${escapeHtml(p.id)}" ${isUnsaving ? "disabled" : ""}>
              ${isUnsaving ? "Unsaving..." : "Unsave"}
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  // Attach unsave listeners
  const buttons = postsList.querySelectorAll(".unsave-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const id = btn.getAttribute("data-id");
      await handleUnsave(id, btn);
    });
  });
}

export function filterAndRender() {
  const q = searchInput ? searchInput.value.trim().toLowerCase() : "";
  const selTopic = topicSelect ? topicSelect.value.trim().toLowerCase() : "";

  const filtered = allPosts.filter((p) => {
    if (selTopic) {
      const hasTopic = (p.topics || []).some(
        (t) => typeof t === "string" && t.trim().toLowerCase() === selTopic
      );
      if (!hasTopic) return false;
    }
    if (q) {
      const matchText = (p.text || "").toLowerCase().includes(q);
      const matchAuthor = (p.author || "").toLowerCase().includes(q);
      const matchReason = (p.saveReason || "").toLowerCase().includes(q);
      const matchTopic = (p.topics || []).some(
        (t) => typeof t === "string" && t.toLowerCase().includes(q)
      );
      if (!matchText && !matchAuthor && !matchReason && !matchTopic) return false;
    }
    return true;
  });

  if (allPosts.length === 0) {
    currentPageState = PAGE_STATE.EMPTY;
  } else {
    currentPageState = PAGE_STATE.READY;
  }

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

if (exportMdBtn) {
  exportMdBtn.addEventListener("click", () => {
    const md = exportToMarkdown(allPosts);
    const filename = `linkedin-second-brain-${new Date().toISOString().slice(0, 10)}.md`;
    downloadFile(filename, md, "text/markdown;charset=utf-8");
  });
}

if (exportJsonBtn) {
  exportJsonBtn.addEventListener("click", () => {
    const json = exportToJson(allPosts);
    const filename = `linkedin-second-brain-${new Date().toISOString().slice(0, 10)}.json`;
    downloadFile(filename, json, "application/json;charset=utf-8");
  });
}

if (openGraphBtn) {
  openGraphBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await openExtensionPage("graph");
  });
}

if (searchInput) searchInput.addEventListener("input", filterAndRender);
if (topicSelect) topicSelect.addEventListener("change", filterAndRender);

export async function load() {
  setPageState(PAGE_STATE.LOADING);
  try {
    allPosts = await getSavedPosts();
    updateTopicDropdown(allPosts);
    filterAndRender();
  } catch (err) {
    logger.error("SAVED", "Failed to load saved posts:", err);
    setPageState(PAGE_STATE.ERROR, "Failed to load saved posts from storage.");
  }
}

// Global accessor helpers for automated testing
export function getAllPosts() {
  return allPosts;
}

export function setAllPosts(posts) {
  allPosts = posts || [];
}

// Auto-initialize in browser environment
if (typeof document !== "undefined" && typeof window !== "undefined") {
  load();
}
