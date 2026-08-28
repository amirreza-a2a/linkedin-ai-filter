import { getLogEntries, clearLog } from "../storage/log-store.js";

const statsEl = document.getElementById("stats");
const rowsEl = document.getElementById("rows");
const emptyEl = document.getElementById("emptyState");
const filterSelect = document.getElementById("filterSelect");
const searchInput = document.getElementById("search");

let allEntries = [];

function statCard(num, label) {
  return `<div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>`;
}

function renderStats(entries) {
  const hidden = entries.filter((e) => e.hide).length;
  const kept = entries.length - hidden;
  const rate = entries.length ? Math.round((hidden / entries.length) * 100) : 0;
  statsEl.innerHTML = [
    statCard(entries.length, "Posts seen"),
    statCard(hidden, "Hidden"),
    statCard(kept, "Kept"),
    statCard(`${rate}%`, "Hide rate"),
  ].join("");
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function renderRows() {
  const filter = filterSelect.value;
  const q = searchInput.value.trim().toLowerCase();

  const filtered = allEntries.filter((e) => {
    if (filter === "hidden" && !e.hide) return false;
    if (filter === "kept" && e.hide) return false;
    if (q && !e.textSnippet.toLowerCase().includes(q) && !(e.reason || "").toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  emptyEl.style.display = filtered.length ? "none" : "block";

  rowsEl.innerHTML = filtered
    .map(
      (e) => `
    <tr>
      <td><span class="badge ${e.hide ? "hidden" : "kept"}">${e.hide ? "Hidden" : "Kept"}</span></td>
      <td class="snippet">${escapeHtml(e.textSnippet)}${e.textSnippet.length >= 200 ? "…" : ""}</td>
      <td class="reason">${escapeHtml(e.reason || "")}</td>
      <td class="ts">${formatTime(e.ts)}</td>
    </tr>`
    )
    .join("");
}

async function load() {
  allEntries = await getLogEntries();
  renderStats(allEntries);
  renderRows();
}

filterSelect.addEventListener("change", renderRows);
searchInput.addEventListener("input", renderRows);
document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!confirm("Clear the entire filter log? This can't be undone.")) return;
  await clearLog();
  await load();
});

load();
