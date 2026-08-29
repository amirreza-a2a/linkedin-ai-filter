// src/dashboard/dashboard.js
import { getLogEntries, clearLog } from "../storage/log-store.js";
import { getSettings } from "../storage/rules-store.js";
import { computeDashboardAnalytics } from "../analytics/dashboard-analytics.js";
import { renderTrendChart, renderTopicBarChart, escapeXml } from "./charts.js";
import { openExtensionPage } from "../navigation/navigation.js";

const statsGrid = document.getElementById("statsGrid");
const trendChartContainer = document.getElementById("trendChartContainer");
const topicChartContainer = document.getElementById("topicChartContainer");
const topicRows = document.getElementById("topicRows");
const topicEmptyState = document.getElementById("topicEmptyState");
const decisionRows = document.getElementById("decisionRows");
const decisionEmptyState = document.getElementById("decisionEmptyState");

const dateRangeSelect = document.getElementById("dateRangeSelect");
const statusSelect = document.getElementById("statusSelect");
const topicSelect = document.getElementById("topicSelect");
const providerSelect = document.getElementById("providerSelect");
const searchInput = document.getElementById("searchInput");
const clearBtn = document.getElementById("clearBtn");
const openBrainBtn = document.getElementById("openBrainBtn");
const openGraphBtn = document.getElementById("openGraphBtn");

let allLogs = [];
let activeSettings = {};

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderKpis(kpis) {
  const activeProv = activeSettings.provider || "openai";
  const activeModel = activeSettings.model?.[activeProv] || "default";

  statsGrid.innerHTML = `
    <div class="stat-card">
      <div class="num">${kpis.total}</div>
      <div class="label">Retained Decisions</div>
    </div>
    <div class="stat-card">
      <div class="num">${kpis.hidden}</div>
      <div class="sub-num">${kpis.hideRate}% hide rate</div>
      <div class="label">Hidden</div>
    </div>
    <div class="stat-card">
      <div class="num">${kpis.kept}</div>
      <div class="label">Kept</div>
    </div>
    <div class="stat-card">
      <div class="num">${kpis.saved}</div>
      <div class="sub-num">${kpis.saveRate}% save rate</div>
      <div class="label">Saved to Brain</div>
    </div>
    <div class="stat-card">
      <div class="num">${kpis.uniqueTopicsCount}</div>
      <div class="label">Unique Topics</div>
    </div>
    <div class="stat-card">
      <div class="num" style="font-size:16px; font-weight:600;">${escapeXml(activeProv)}</div>
      <div class="sub-num">${escapeXml(activeModel)}</div>
      <div class="label">Active Engine</div>
    </div>
  `;
}

function renderTopicTable(topicStats) {
  if (topicStats.length === 0) {
    topicRows.innerHTML = "";
    topicEmptyState.style.display = "block";
    return;
  }
  topicEmptyState.style.display = "none";
  topicRows.innerHTML = topicStats
    .slice(0, 10)
    .map(
      (t) => `
      <tr>
        <td><strong>#${escapeXml(t.topic)}</strong></td>
        <td>${t.count}</td>
        <td><span class="badge ${t.hideRate > 50 ? "hidden" : "kept"}">${t.hideRate}%</span></td>
        <td><span class="badge ${t.saveRate > 0 ? "saved" : "kept"}">${t.saveRate}%</span></td>
      </tr>
    `
    )
    .join("");
}

function renderDecisionTable(records) {
  if (records.length === 0) {
    decisionRows.innerHTML = "";
    decisionEmptyState.style.display = "block";
    return;
  }
  decisionEmptyState.style.display = "none";
  decisionRows.innerHTML = records
    .map((r) => {
      const topicBadges = (r.topics || [])
        .map((t) => `<span class="badge topic-tag">#${escapeXml(t)}</span>`)
        .join("");

      return `
        <tr>
          <td><span class="badge ${r.hide ? "hidden" : "kept"}">${r.hide ? "Hidden" : "Kept"}</span></td>
          <td class="snippet">${escapeXml(r.textSnippet)}${r.textSnippet.length >= 200 ? "…" : ""}</td>
          <td>${topicBadges || "<span style='color:#aaa;'>—</span>"}</td>
          <td class="reason">${escapeXml(r.reason || "")}</td>
          <td>${r.saved ? `<span class="badge saved">Saved</span>` : "<span style='color:#aaa;'>No</span>"}</td>
          <td class="ts">${formatTime(r.ts)}</td>
        </tr>
      `;
    })
    .join("");
}

function updateTopicDropdown(logs) {
  const currentVal = topicSelect.value;
  const topicsSet = new Set();
  for (const l of logs) {
    for (const t of l.topics || []) topicsSet.add(t);
  }

  const sortedTopics = Array.from(topicsSet).sort((a, b) => a.localeCompare(b));
  topicSelect.innerHTML =
    `<option value="">All Topics (${sortedTopics.length})</option>` +
    sortedTopics
      .map(
        (t) =>
          `<option value="${escapeXml(t)}" ${t.toLowerCase() === currentVal.toLowerCase() ? "selected" : ""}>${escapeXml(t)}</option>`
      )
      .join("");
}

function refreshDashboard() {
  const filters = {
    dateRange: dateRangeSelect.value,
    status: statusSelect.value,
    topic: topicSelect.value,
    provider: providerSelect.value,
    search: searchInput.value,
  };

  const analytics = computeDashboardAnalytics(allLogs, filters);

  renderKpis(analytics.kpis);
  trendChartContainer.innerHTML = renderTrendChart(analytics.timeBuckets);
  topicChartContainer.innerHTML = renderTopicBarChart(analytics.topicStats);
  renderTopicTable(analytics.topicStats);
  renderDecisionTable(analytics.filteredRecords);
}

async function load() {
  const [logs, settings] = await Promise.all([getLogEntries(), getSettings()]);
  allLogs = logs;
  activeSettings = settings;

  updateTopicDropdown(allLogs);
  refreshDashboard();
}

dateRangeSelect.addEventListener("change", refreshDashboard);
statusSelect.addEventListener("change", refreshDashboard);
topicSelect.addEventListener("change", refreshDashboard);
providerSelect.addEventListener("change", refreshDashboard);
searchInput.addEventListener("input", refreshDashboard);

clearBtn.addEventListener("click", async () => {
  if (!confirm("Clear the entire filter decision log? This cannot be undone.")) return;
  await clearLog();
  await load();
});

if (openBrainBtn) {
  openBrainBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openExtensionPage("saved");
  });
}

if (openGraphBtn) {
  openGraphBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openExtensionPage("graph");
  });
}

load();
