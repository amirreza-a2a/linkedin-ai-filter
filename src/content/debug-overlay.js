// src/content/debug-overlay.js
// Robust Document-Level Production Debug Visualization Mode for FeedRule.
// Renders per-candidate diagnostic overlays inside a dedicated document-level layer
// OUTSIDE the feed post DOM tree, ensuring 100% visibility even when posts are hidden.

export function isDiagnosticModeEnabled() {
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1") return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1") return true;
  } catch {}
  if (typeof window !== "undefined" && window.__FEEDRULE_DIAGNOSTIC__ === true) return true;
  return false;
}

export function getDiagnosticStatus() {
  const enabled = isDiagnosticModeEnabled();
  let source = "disabled";
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1") source = "sessionStorage";
    else if (typeof localStorage !== "undefined" && localStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1") source = "localStorage";
    else if (typeof window !== "undefined" && window.__FEEDRULE_DIAGNOSTIC__ === true) source = "windowFlag";
  } catch {}
  return { active: enabled, source };
}

// Stage Tracker Map for DOM Elements (WeakMap allows automatic GC of unmounted nodes)
const elementDiagnosticStates = new WeakMap();
const candidateElements = new Set();
let diagnosticLayer = null;
let positionUpdateScheduled = false;
let scrollListenerAttached = false;

function ensureDiagnosticLayer() {
  if (typeof document === "undefined") return null;
  if (!isDiagnosticModeEnabled()) {
    if (diagnosticLayer && diagnosticLayer.parentNode) {
      diagnosticLayer.remove();
      diagnosticLayer = null;
    }
    return null;
  }

  const root = document.body || document.documentElement;
  if (!root) return null;

  let existing = document.getElementById("feedrule-diagnostic-layer");
  if (existing) {
    diagnosticLayer = existing;
    return diagnosticLayer;
  }

  diagnosticLayer = document.createElement("div");
  diagnosticLayer.id = "feedrule-diagnostic-layer";
  diagnosticLayer.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483647;
    overflow: visible;
  `;
  try {
    root.appendChild(diagnosticLayer);
  } catch {}

  if (!scrollListenerAttached && typeof window !== "undefined") {
    scrollListenerAttached = true;
    const scheduleUpdate = () => {
      if (!positionUpdateScheduled) {
        positionUpdateScheduled = true;
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            updateAllBadgePositions();
            positionUpdateScheduled = false;
          });
        } else {
          setTimeout(() => {
            updateAllBadgePositions();
            positionUpdateScheduled = false;
          }, 16);
        }
      }
    };
    window.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });
  }

  return diagnosticLayer;
}

export function updateAllBadgePositions() {
  if (!isDiagnosticModeEnabled() || !diagnosticLayer) return;

  for (const el of candidateElements) {
    if (!el || !el.isConnected) {
      candidateElements.delete(el);
      const deadBadge = diagnosticLayer.querySelector(`[data-feedrule-target-id="${el?.getAttribute?.("data-lazy-mount-id") || ""}"]`);
      if (deadBadge) deadBadge.remove();
      continue;
    }

    const state = elementDiagnosticStates.get(el);
    if (!state) continue;

    const badge = diagnosticLayer.querySelector(`[data-feedrule-target-id="${state.postId}"]`);
    if (badge) {
      positionBadge(badge, el);
    }
  }
}

function positionBadge(badge, targetEl) {
  if (!badge || !targetEl || !targetEl.isConnected) return;

  try {
    const rect = targetEl.getBoundingClientRect();
    const scrollX = (typeof window !== "undefined" ? (window.scrollX || window.pageXOffset) : 0) || (typeof document !== "undefined" ? document.documentElement.scrollLeft : 0) || 0;
    const scrollY = (typeof window !== "undefined" ? (window.scrollY || window.pageYOffset) : 0) || (typeof document !== "undefined" ? document.documentElement.scrollTop : 0) || 0;

    const top = rect.top + scrollY;
    const left = rect.left + scrollX;
    const width = Math.max(rect.width, 320);

    badge.style.top = `${top + 4}px`;
    badge.style.left = `${left + 6}px`;
    badge.style.width = `${Math.min(width - 12, 620)}px`;
    badge.style.display = (rect.width > 0 || rect.height > 0 || targetEl.isConnected) ? "block" : "none";
  } catch {}
}

/**
 * Updates diagnostic overlay badge for a candidate element with real DOM verification.
 *
 * @param {Element} el
 * @param {Partial<{
 *   stage: string,
 *   terminal: string,
 *   postId: string,
 *   author: string,
 *   textSnippet: string,
 *   qualified: boolean,
 *   score: number,
 *   reason: string,
 *   provider: string,
 *   model: string,
 *   attempts: number,
 *   error: string,
 *   hide: boolean,
 *   domState: string,
 *   domVerified: boolean,
 *   classHidden: boolean,
 *   dataHidden: boolean,
 *   computedDisplay: string
 * }>} data
 */
export function updateDiagnosticOverlay(el, data = {}) {
  if (!el || el.nodeType !== 1 || !isDiagnosticModeEnabled()) return;

  candidateElements.add(el);

  const current = elementDiagnosticStates.get(el) || {
    stage: "DISCOVERED",
    terminal: "DISCOVERED",
    postId: el.getAttribute("data-lazy-mount-id") || el.getAttribute("data-urn") || "unknown",
    author: "Unknown",
    textSnippet: "",
    qualified: null,
    score: null,
    reason: "",
    provider: "",
    model: "",
    attempts: 0,
    error: "",
    hide: null,
    domState: "UNTOUCHED",
    domVerified: null,
    classHidden: null,
    dataHidden: null,
    computedDisplay: null,
  };

  const updated = { ...current, ...data };

  // Perform Real DOM Verification
  if (data.stage === "DOM_APPLIED" || data.stage === "VERIFY_REAL_DOM_STATE") {
    const classHidden = el.classList?.contains?.("feedrule-hidden") || false;
    const dataHidden = el.getAttribute?.("data-feedrule-hidden") === "true";
    let computedDisplay = null;
    try {
      computedDisplay = typeof getComputedStyle === "function" ? getComputedStyle(el).display : null;
    } catch {}

    updated.classHidden = classHidden;
    updated.dataHidden = dataHidden;
    updated.computedDisplay = computedDisplay;

    if (updated.hide === true) {
      if (classHidden && dataHidden) {
        updated.domVerified = true;
        updated.terminal = "DOM_HIDDEN";
        updated.domState = "ACTUALLY HIDDEN";
      } else {
        updated.domVerified = false;
        updated.terminal = "DOM_APPLY_FAILED";
        updated.domState = "DOM APPLY FAILED (EXPECTED HIDDEN)";
      }
    } else if (updated.hide === false) {
      if (!classHidden && !dataHidden) {
        updated.domVerified = true;
        updated.terminal = "DOM_VISIBLE";
        updated.domState = "ACTUALLY VISIBLE";
      } else {
        updated.domVerified = false;
        updated.terminal = "DOM_APPLY_FAILED";
        updated.domState = "DOM APPLY FAILED (EXPECTED VISIBLE)";
      }
    }
  }

  elementDiagnosticStates.set(el, updated);

  // Set machine-readable attributes on candidate element
  try {
    el.setAttribute("data-feedrule-debug", "true");
    if (updated.stage) el.setAttribute("data-feedrule-stage", updated.stage);
    if (updated.terminal) el.setAttribute("data-feedrule-terminal", updated.terminal);
    if (updated.postId) el.setAttribute("data-feedrule-post-id", updated.postId);
    if (updated.qualified !== null) el.setAttribute("data-feedrule-qualified", String(updated.qualified));
    if (updated.score !== null) el.setAttribute("data-feedrule-score", String(updated.score));
    if (updated.hide !== null) el.setAttribute("data-feedrule-hide", String(updated.hide));
    if (updated.domVerified !== null) el.setAttribute("data-feedrule-verified", String(updated.domVerified));
    if (updated.error) el.setAttribute("data-feedrule-error", updated.error);
  } catch {}

  // Render UI Badge in Document-Level Diagnostic Layer
  renderDocumentLevelBadge(el, updated);
}

function getStatusTheme(terminal = "") {
  switch (terminal) {
    case "DOM_HIDDEN":
    case "API_SUCCESS_HIDE":
      return { border: "#7c3aed", bg: "#f5f3ff", text: "#4c1d95", badge: "#7c3aed", marker: "[FR:HIDDEN]" };
    case "DOM_VISIBLE":
    case "API_SUCCESS_SHOW":
      return { border: "#16a34a", bg: "#f0fdf4", text: "#14532d", badge: "#16a34a", marker: "[FR:VISIBLE]" };
    case "DISPATCHED":
    case "IN_FLIGHT":
      return { border: "#ea580c", bg: "#fff7ed", text: "#7c2d12", badge: "#ea580c", marker: "[FR:DISPATCHED]" };
    case "QUEUED":
      return { border: "#2563eb", bg: "#eff6ff", text: "#1e3a8a", badge: "#2563eb", marker: "[FR:QUEUED]" };
    case "STALE_RESPONSE_DISCARDED":
      return { border: "#d97706", bg: "#fffbeb", text: "#78350f", badge: "#d97706", marker: "[FR:STALE]" };
    case "DOM_APPLY_FAILED":
    case "API_TIMEOUT":
    case "API_ERROR":
    case "EXTRACTION_FAILED":
    case "REJECTED_COMPOSER":
    case "REJECTED_NOT_POST":
      return { border: "#dc2626", bg: "#fef2f2", text: "#7f1d1d", badge: "#dc2626", marker: "[FR:REJECTED]" };
    case "DISCOVERED":
    default:
      return { border: "#475569", bg: "#f8fafc", text: "#0f172a", badge: "#475569", marker: "[FR:DISCOVERED]" };
  }
}

function renderDocumentLevelBadge(el, state) {
  const layer = ensureDiagnosticLayer();
  if (!layer || !el) return;

  const targetId = state.postId || "unknown";
  let badge = layer.querySelector(`[data-feedrule-target-id="${targetId}"]`);
  if (!badge) {
    badge = document.createElement("div");
    badge.className = "feedrule-debug-overlay";
    badge.setAttribute("data-feedrule-target-id", targetId);
    layer.appendChild(badge);
  }

  const theme = getStatusTheme(state.terminal);

  badge.style.cssText = `
    position: absolute;
    pointer-events: auto;
    z-index: 2147483647;
    margin: 0;
    padding: 10px 14px;
    border-radius: 8px;
    border: 2px solid ${theme.border};
    background: ${theme.bg};
    color: ${theme.text};
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    line-height: 1.45;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    user-select: text;
    display: block !important;
  `;

  positionBadge(badge, el);

  const qualText = state.qualified === null 
    ? "PENDING" 
    : state.qualified ? `✓ ACCEPT (${state.score ?? 0})` : `✗ REJECT (${state.reason || "unqualified"})`;

  const extractText = state.author !== "Unknown" || state.postId !== "unknown" ? "✓ OK" : "PENDING";

  const queueText = state.stage === "QUEUED" || state.stage === "DISPATCHED" || state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED" || state.stage === "VERIFY_REAL_DOM_STATE"
    ? "✓ YES"
    : (state.qualified === false ? "✗ NO (REJECTED)" : "PENDING");

  const dispatchText = state.stage === "DISPATCHED" || state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED" || state.stage === "VERIFY_REAL_DOM_STATE"
    ? "✓ YES"
    : (state.stage === "QUEUED" ? "PENDING FLUSH" : "NO");

  let responseText = "NONE";
  if (state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED" || state.stage === "VERIFY_REAL_DOM_STATE") {
    if (state.error) responseText = `✗ ${state.error}`;
    else if (state.hide !== null) responseText = `✓ ${state.hide ? "HIDE" : "SHOW"}`;
  } else if (state.stage === "DISPATCHED") {
    responseText = "AWAITING GATEWAY...";
  }

  const domText = state.domState || "UNTOUCHED";
  const matchedRuleInfo = state.reason || (state.hide ? "Matched active filter rule" : "Neutral / Did not match hide rules");
  const providerInfo = state.provider ? `${state.provider} (${state.model || "default"})` : "Local / Gateway";

  badge.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid ${theme.border}; padding-bottom:6px; margin-bottom:6px;">
      <span style="font-weight:bold; font-size:12px; letter-spacing:0.5px;">⚙ FEEDRULE DEBUG ${theme.marker}</span>
      <span style="font-size:10px; font-weight:bold; background:${theme.badge}; color:#ffffff; padding:2px 8px; border-radius:4px;">${escapeHtml(state.terminal)}</span>
    </div>
    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
      <div><strong>ID:</strong> ${escapeHtml(state.postId)}</div>
      <div><strong>Author:</strong> ${escapeHtml(state.author || "Unknown")}</div>
      <div><strong>Qualification:</strong> ${qualText}</div>
      <div><strong>Extraction:</strong> ${extractText}</div>
      <div><strong>Queue:</strong> ${queueText}</div>
      <div><strong>Dispatch:</strong> ${dispatchText}</div>
      <div><strong>Response:</strong> ${responseText}</div>
      <div><strong>DOM State:</strong> <strong>${escapeHtml(domText)}</strong></div>
      <div><strong>Terminal State:</strong> <strong>${escapeHtml(state.terminal)}</strong></div>
      <div><strong>Provider/Model:</strong> ${escapeHtml(providerInfo)}</div>
    </div>
    <div style="background:rgba(0,0,0,0.04); padding:6px; border-radius:4px; font-size:10px; border-left:3px solid ${theme.border};">
      <div><strong>Decision:</strong> hide = ${state.hide !== null ? state.hide : "pending"} | <strong>Reason:</strong> ${escapeHtml(matchedRuleInfo)}</div>
      ${state.classHidden !== null ? `<div><strong>DOM Check:</strong> classHidden = ${state.classHidden} | dataHidden = ${state.dataHidden} | display = ${state.computedDisplay || "N/A"}</div>` : ""}
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

export function getAllDiagnosticStates() {
  const records = [];
  for (const el of candidateElements) {
    if (!el || !el.isConnected) continue;
    const state = elementDiagnosticStates.get(el);
    if (state) {
      records.push({
        postId: state.postId,
        author: state.author,
        qualification: {
          decision: state.qualified ? "ACCEPT" : (state.qualified === false ? "REJECT" : "PENDING"),
          score: state.score,
          reason: state.reason
        },
        extraction: {
          ok: state.author !== "Unknown" || state.postId !== "unknown",
          author: state.author,
          textSnippet: state.textSnippet
        },
        queue: {
          enqueued: state.stage === "QUEUED" || state.stage === "DISPATCHED" || state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED" || state.stage === "VERIFY_REAL_DOM_STATE"
        },
        dispatch: {
          dispatched: state.stage === "DISPATCHED" || state.stage === "RESPONSE_RECEIVED" || state.stage === "DOM_APPLIED" || state.stage === "VERIFY_REAL_DOM_STATE"
        },
        response: {
          hide: state.hide,
          reason: state.reason,
          provider: state.provider,
          model: state.model,
          error: state.error
        },
        domState: {
          classHidden: state.classHidden ?? el.classList?.contains?.("feedrule-hidden"),
          dataHidden: state.dataHidden ?? (el.getAttribute?.("data-feedrule-hidden") === "true"),
          computedDisplay: state.computedDisplay ?? (typeof getComputedStyle === "function" ? getComputedStyle(el).display : null),
          verified: state.domVerified,
          status: state.domState
        },
        terminal: state.terminal,
        element: el
      });
    }
  }
  return records;
}

if (typeof window !== "undefined") {
  window.__getFeedRuleDiagnosticStates = getAllDiagnosticStates;
  Object.defineProperty(window, "__FEEDRULE_DIAGNOSTIC_STATUS__", {
    get: () => getDiagnosticStatus(),
    configurable: true,
  });
}
