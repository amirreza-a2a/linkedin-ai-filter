// src/content/debug-overlay.js
// Production Debug Visualization Mode for FeedRule LinkedIn Content Script.
// Renders per-candidate diagnostic overlays displaying real pipeline stages,
// qualification score, extraction state, request gateway state, and terminal status.

export function isDiagnosticModeEnabled() {
  if (typeof window === "undefined") return false;
  if (window.__FEEDRULE_DIAGNOSTIC__ === true) return true;
  try {
    return (
      sessionStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1" ||
      localStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1"
    );
  } catch {
    return false;
  }
}

// Stage Tracker Map for DOM Elements (WeakMap allows automatic GC of unmounted nodes)
const elementDiagnosticStates = new WeakMap();

/**
 * Updates diagnostic overlay badge on candidate element.
 *
 * @param {Element} el
 * @param {Partial<{
 *   stage: string,
 *   terminal: string,
 *   postId: string,
 *   author: string,
 *   qualified: boolean,
 *   score: number,
 *   reason: string,
 *   provider: string,
 *   model: string,
 *   attempts: number,
 *   error: string,
 *   hide: boolean,
 *   domState: string
 * }>} data
 */
export function updateDiagnosticOverlay(el, data = {}) {
  if (!el || el.nodeType !== 1 || !isDiagnosticModeEnabled()) return;

  const current = elementDiagnosticStates.get(el) || {
    stage: "DISCOVERED",
    terminal: "DISCOVERED",
    postId: el.getAttribute("data-lazy-mount-id") || el.getAttribute("data-urn") || "unknown",
    author: "Unknown",
    qualified: null,
    score: null,
    reason: "",
    provider: "",
    model: "",
    attempts: 0,
    error: "",
    hide: null,
    domState: "UNTOUCHED"
  };

  const updated = { ...current, ...data };
  elementDiagnosticStates.set(el, updated);

  // Set machine-readable attributes
  try {
    el.setAttribute("data-feedrule-debug", "true");
    if (updated.stage) el.setAttribute("data-feedrule-stage", updated.stage);
    if (updated.terminal) el.setAttribute("data-feedrule-terminal", updated.terminal);
    if (updated.postId) el.setAttribute("data-feedrule-post-id", updated.postId);
    if (updated.qualified !== null) el.setAttribute("data-feedrule-qualified", String(updated.qualified));
    if (updated.score !== null) el.setAttribute("data-feedrule-score", String(updated.score));
    if (updated.hide !== null) el.setAttribute("data-feedrule-hide", String(updated.hide));
    if (updated.error) el.setAttribute("data-feedrule-error", updated.error);
  } catch {}

  // Render or update UI Badge
  renderBadge(el, updated);
}

function getStatusTheme(terminal = "") {
  switch (terminal) {
    case "DOM_HIDDEN":
    case "API_SUCCESS_HIDE":
      return { border: "#8a2be2", bg: "#f3e8ff", text: "#581c87", label: "PURPLE (HIDDEN)" };
    case "DOM_VISIBLE":
    case "API_SUCCESS_SHOW":
      return { border: "#16a34a", bg: "#f0fdf4", text: "#14532d", label: "GREEN (VISIBLE)" };
    case "DISPATCHED":
    case "IN_FLIGHT":
      return { border: "#ea580c", bg: "#fff7ed", text: "#7c2d12", label: "ORANGE (IN FLIGHT)" };
    case "QUEUED":
      return { border: "#2563eb", bg: "#eff6ff", text: "#1e3a8a", label: "BLUE (QUEUED)" };
    case "API_TIMEOUT":
    case "API_ERROR":
    case "EXTRACTION_FAILED":
    case "REJECTED_COMPOSER":
    case "REJECTED_NOT_POST":
      return { border: "#dc2626", bg: "#fef2f2", text: "#7f1d1d", label: "RED (FAILURE/REJECT)" };
    case "DISCOVERED":
    default:
      return { border: "#64748b", bg: "#f8fafc", text: "#0f172a", label: "GRAY (DISCOVERED)" };
  }
}

function renderBadge(el, state) {
  if (typeof document === "undefined" || !el.isConnected) return;

  let badge = el.querySelector(":scope > .feedrule-debug-overlay");
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "feedrule-debug-overlay";
    try {
      el.insertBefore(badge, el.firstChild);
    } catch {
      el.appendChild(badge);
    }
  }

  const theme = getStatusTheme(state.terminal);

  badge.style.cssText = `
    position: relative;
    z-index: 999999;
    margin: 4px 0;
    padding: 8px 12px;
    border-radius: 6px;
    border: 2px solid ${theme.border};
    background: ${theme.bg};
    color: ${theme.text};
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    pointer-events: auto;
    user-select: text;
    display: block !important;
  `;

  const qualText = state.qualified === null 
    ? "PENDING" 
    : state.qualified ? `✓ ACCEPT (${state.score ?? 0})` : `✗ REJECT (${state.reason || "unqualified"})`;

  const queueText = state.stage === "QUEUED" || state.stage === "DISPATCHED" || state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED"
    ? "✓ YES"
    : (state.qualified === false ? "✗ NO (REJECTED)" : "PENDING");

  const dispatchText = state.stage === "DISPATCHED" || state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED"
    ? "✓ YES"
    : (state.stage === "QUEUED" ? "PENDING FLUSH" : "NO");

  const responseText = state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED"
    ? (state.error ? `✗ ${state.error}` : `✓ ${state.hide ? "HIDE" : "SHOW"}`)
    : (state.stage === "DISPATCHED" ? "AWAITING GATEWAY..." : "NONE");

  const domText = state.domState || "UNTOUCHED";

  badge.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid ${theme.border}; padding-bottom:4px; margin-bottom:4px; font-weight:bold;">
      <span>[FeedRule Diagnostic] ID: ${escapeHtml(state.postId)}</span>
      <span style="font-size:10px; background:${theme.border}; color:#fff; padding:2px 6px; border-radius:4px;">${escapeHtml(state.terminal)}</span>
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 4px;">
      <div><strong>Author:</strong> ${escapeHtml(state.author || "Unknown")}</div>
      <div><strong>Score:</strong> ${state.score !== null ? state.score : "N/A"}</div>
      <div><strong>1. DISCOVERED:</strong> ✓</div>
      <div><strong>2. QUALIFY:</strong> ${qualText}</div>
      <div><strong>3. EXTRACT:</strong> ${state.author !== "Unknown" || state.postId ? "✓ OK" : "PENDING"}</div>
      <div><strong>4. QUEUE:</strong> ${queueText}</div>
      <div><strong>5. DISPATCH:</strong> ${dispatchText}</div>
      <div><strong>6. RESPONSE:</strong> ${responseText}</div>
      <div><strong>7. DOM STATE:</strong> <strong>${escapeHtml(domText)}</strong></div>
      <div><strong>Provider/Model:</strong> ${escapeHtml(state.provider || "-")}/${escapeHtml(state.model || "-")}</div>
    </div>
    ${state.error ? `<div style="color:#b91c1c; margin-top:4px; font-weight:bold;">Error: ${escapeHtml(state.error)}</div>` : ""}
  `;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
