// src/content/debug-overlay.js
// Production Debug Visualization Mode for FeedRule.
// Robust document-level diagnostic layer with explicit positioning safety,
// strict provider attribution, and candidate discovery identity tracing.

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
      positionBadge(badge, el, state);
    }
  }
}

function positionBadge(badge, targetEl, state) {
  if (!badge || !targetEl) return;

  if (!targetEl.isConnected) {
    badge.style.display = "none";
    if (state) {
      state.positionState = "POSITION_FAILED";
      state.positionError = "Target element is disconnected from DOM";
    }
    return;
  }

  try {
    const rect = targetEl.getBoundingClientRect();

    // If candidate has zero dimensions or is unmounted, do not place at origin
    if (rect.width <= 0 || rect.height <= 0 || (rect.top === 0 && rect.left === 0 && rect.width === 0)) {
      badge.style.display = "none";
      if (state) {
        state.positionState = "POSITION_FAILED";
        state.positionError = "Candidate element has zero width/height";
      }
      return;
    }

    const scrollX = (typeof window !== "undefined" ? (window.scrollX || window.pageXOffset) : 0) || (typeof document !== "undefined" ? document.documentElement.scrollLeft : 0) || 0;
    const scrollY = (typeof window !== "undefined" ? (window.scrollY || window.pageYOffset) : 0) || (typeof document !== "undefined" ? document.documentElement.scrollTop : 0) || 0;

    const top = rect.top + scrollY;
    const left = rect.left + scrollX;
    const width = Math.max(rect.width, 320);

    badge.style.top = `${top + 4}px`;
    badge.style.left = `${left + 6}px`;
    badge.style.width = `${Math.min(width - 12, 620)}px`;
    badge.style.display = "block";

    if (state) {
      state.positionState = "POSITION_OK";
      state.positionError = "";
    }
  } catch (err) {
    badge.style.display = "none";
    if (state) {
      state.positionState = "POSITION_FAILED";
      state.positionError = String(err?.message || err);
    }
  }
}

/**
 * Formats explicit provider and model information without guessing "Local".
 */
export function formatProviderInfo(state = {}) {
  if (state.provider && typeof state.provider === "string" && state.provider.trim()) {
    const raw = state.provider.trim();
    const pLower = raw.toLowerCase();
    let pName = raw;
    if (pLower === "gemini") pName = "Gemini";
    else if (pLower === "openai") pName = "OpenAI";
    else if (pLower === "claude" || pLower === "anthropic") pName = "Anthropic";
    else if (pLower === "local") pName = "Local";

    const modelPart = state.model ? ` (${state.model})` : "";
    if (state.isCustomEndpoint) {
      return `${pName}${modelPart} [Local / Custom]`;
    }
    return `${pName}${modelPart}`;
  }

  if (state.isCustomEndpoint) {
    return "Local / Custom";
  }

  return "Provider: UNKNOWN";
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
 *   isCustomEndpoint: boolean,
 *   matchedSelector: string,
 *   tagName: string,
 *   className: string,
 *   idAttribute: string,
 *   lazyMountId: string,
 *   dataUrn: string,
 *   dataId: string,
 *   parentTag: string,
 *   parentClass: string,
 *   feedRootIdentity: string,
 *   qualificationSignals: string,
 *   rejectionReason: string,
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

  // Extract structural DOM identity metadata directly from element
  const autoMeta = {
    matchedSelector: data.matchedSelector || "",
    tagName: el.tagName || "DIV",
    className: typeof el.className === "string" ? el.className.slice(0, 100) : "",
    idAttribute: el.id || "",
    lazyMountId: el.getAttribute?.("data-lazy-mount-id") || "",
    dataUrn: el.getAttribute?.("data-urn") || "",
    dataId: el.getAttribute?.("data-id") || "",
    parentTag: el.parentElement?.tagName || "",
    parentClass: typeof el.parentElement?.className === "string" ? el.parentElement.className.slice(0, 80) : "",
  };

  const current = elementDiagnosticStates.get(el) || {
    stage: "DISCOVERED",
    terminal: "DISCOVERED",
    postId: el.getAttribute?.("data-lazy-mount-id") || el.getAttribute?.("data-urn") || el.getAttribute?.("data-id") || "unknown",
    author: "Unknown",
    textSnippet: "",
    qualified: null,
    score: null,
    reason: "",
    provider: "",
    model: "",
    isCustomEndpoint: false,
    matchedSelector: "",
    tagName: autoMeta.tagName,
    className: autoMeta.className,
    idAttribute: autoMeta.idAttribute,
    lazyMountId: autoMeta.lazyMountId,
    dataUrn: autoMeta.dataUrn,
    dataId: autoMeta.dataId,
    parentTag: autoMeta.parentTag,
    parentClass: autoMeta.parentClass,
    feedRootIdentity: "",
    qualificationSignals: "",
    rejectionReason: "",
    attempts: 0,
    error: "",
    hide: null,
    domState: "UNTOUCHED",
    domVerified: null,
    classHidden: null,
    dataHidden: null,
    computedDisplay: null,
    positionState: "PENDING",
    positionError: "",
  };

  const updated = { ...current, ...autoMeta, ...data };

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

function getStatusTheme(terminal = "", qualified = null) {
  if (qualified === false) {
    return { 
      border: "#dc2626", 
      bg: "#fef2f2", 
      text: "#7f1d1d", 
      badge: "#dc2626", 
      marker: "[FR:REJECTED]", 
      typeLabel: "REJECTED NON-POST",
      typeColor: "#991b1b"
    };
  }

  switch (terminal) {
    case "DOM_HIDDEN":
    case "API_SUCCESS_HIDE":
      return { 
        border: "#7c3aed", 
        bg: "#f5f3ff", 
        text: "#4c1d95", 
        badge: "#7c3aed", 
        marker: "[FR:HIDDEN]", 
        typeLabel: "QUALIFIED POST",
        typeColor: "#6d28d9"
      };
    case "DOM_VISIBLE":
    case "API_SUCCESS_SHOW":
      return { 
        border: "#16a34a", 
        bg: "#f0fdf4", 
        text: "#14532d", 
        badge: "#16a34a", 
        marker: "[FR:VISIBLE]", 
        typeLabel: "QUALIFIED POST",
        typeColor: "#15803d"
      };
    case "DISPATCHED":
    case "IN_FLIGHT":
      return { 
        border: "#ea580c", 
        bg: "#fff7ed", 
        text: "#7c2d12", 
        badge: "#ea580c", 
        marker: "[FR:DISPATCHED]", 
        typeLabel: "QUALIFIED POST (DISPATCHED)",
        typeColor: "#c2410c"
      };
    case "QUEUED":
      return { 
        border: "#2563eb", 
        bg: "#eff6ff", 
        text: "#1e3a8a", 
        badge: "#2563eb", 
        marker: "[FR:QUEUED]", 
        typeLabel: "QUALIFIED POST (QUEUED)",
        typeColor: "#1d4ed8"
      };
    case "STALE_RESPONSE_DISCARDED":
      return { 
        border: "#d97706", 
        bg: "#fffbeb", 
        text: "#78350f", 
        badge: "#d97706", 
        marker: "[FR:STALE]", 
        typeLabel: "RECYCLED NODE",
        typeColor: "#b45309"
      };
    case "DOM_APPLY_FAILED":
    case "API_TIMEOUT":
    case "API_ERROR":
    case "EXTRACTION_FAILED":
    case "REJECTED_COMPOSER":
    case "REJECTED_NOT_POST":
      return { 
        border: "#dc2626", 
        bg: "#fef2f2", 
        text: "#7f1d1d", 
        badge: "#dc2626", 
        marker: "[FR:REJECTED]", 
        typeLabel: qualified ? "QUALIFIED POST (ERROR)" : "REJECTED NON-POST",
        typeColor: "#991b1b"
      };
    case "DISCOVERED":
    default:
      return { 
        border: "#475569", 
        bg: "#f8fafc", 
        text: "#0f172a", 
        badge: "#475569", 
        marker: "[FR:DISCOVERED]", 
        typeLabel: "DISCOVERED CANDIDATE",
        typeColor: "#334155"
      };
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

  const theme = getStatusTheme(state.terminal, state.qualified);

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
    display: none;
  `;

  // Position badge safely
  positionBadge(badge, el, state);

  const candidateHeader = state.qualified === true
    ? `[POST] ⚙ FEEDRULE DEBUG ${theme.marker}`
    : (state.qualified === false ? `[NON-POST] ⚙ FEEDRULE DEBUG ${theme.marker}` : `[CANDIDATE] ⚙ FEEDRULE DEBUG ${theme.marker}`);

  const qualText = state.qualified === null 
    ? "PENDING" 
    : state.qualified ? `✓ ACCEPT (${state.score ?? 0})` : `✗ REJECT (${state.reason || "unqualified"})`;

  const extractText = state.author !== "Unknown" || (state.postId && state.postId !== "unknown") ? "✓ OK" : "PENDING";

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
  const providerInfo = formatProviderInfo(state);

  badge.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid ${theme.border}; padding-bottom:6px; margin-bottom:6px;">
      <span style="font-weight:bold; font-size:12px; letter-spacing:0.5px;">${candidateHeader}</span>
      <span style="font-size:10px; font-weight:bold; background:${theme.badge}; color:#ffffff; padding:2px 8px; border-radius:4px;">${escapeHtml(state.terminal)}</span>
    </div>
    <div style="font-size:10px; font-weight:bold; color:${theme.typeColor}; margin-bottom:4px; text-transform:uppercase;">
      STATUS: ${escapeHtml(theme.typeLabel)}
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
      <div><strong>Terminal:</strong> <strong>${escapeHtml(state.terminal)}</strong></div>
      <div><strong>Provider:</strong> ${escapeHtml(providerInfo)}</div>
    </div>
    <div style="background:rgba(0,0,0,0.04); padding:6px; border-radius:4px; font-size:10px; border-left:3px solid ${theme.border}; margin-bottom:4px;">
      <div><strong>Decision:</strong> hide = ${state.hide !== null ? state.hide : "pending"} | <strong>Reason:</strong> ${escapeHtml(matchedRuleInfo)}</div>
      ${state.classHidden !== null ? `<div><strong>DOM Check:</strong> classHidden = ${state.classHidden} | dataHidden = ${state.dataHidden} | display = ${state.computedDisplay || "N/A"}</div>` : ""}
    </div>
    <div style="background:rgba(0,0,0,0.02); padding:5px 6px; border-radius:4px; font-size:9.5px; color:#475569; border:1px dashed #cbd5e1;">
      <strong>DISCOVERY & IDENTITY:</strong><br/>
      matchedSelector: <code>${escapeHtml(state.matchedSelector || "N/A")}</code><br/>
      tag: <code>${escapeHtml(state.tagName || "DIV")}</code> | id: <code>${escapeHtml(state.idAttribute || "none")}</code> | class: <code>${escapeHtml(state.className || "none")}</code><br/>
      data-lazy-mount-id: <code>${escapeHtml(state.lazyMountId || "none")}</code> | data-urn: <code>${escapeHtml(state.dataUrn || "none")}</code><br/>
      parent: <code>${escapeHtml(state.parentTag || "none")}.${escapeHtml(state.parentClass || "none")}</code> | feedRoot: <code>${escapeHtml(state.feedRootIdentity || "none")}</code>
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
          ok: state.author !== "Unknown" || (state.postId && state.postId !== "unknown"),
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
          isCustomEndpoint: state.isCustomEndpoint,
          providerFormatted: formatProviderInfo(state),
          error: state.error
        },
        domState: {
          classHidden: state.classHidden ?? el.classList?.contains?.("feedrule-hidden"),
          dataHidden: state.dataHidden ?? (el.getAttribute?.("data-feedrule-hidden") === "true"),
          computedDisplay: state.computedDisplay ?? (typeof getComputedStyle === "function" ? getComputedStyle(el).display : null),
          verified: state.domVerified,
          status: state.domState
        },
        discovery: {
          matchedSelector: state.matchedSelector,
          tagName: state.tagName,
          className: state.className,
          idAttribute: state.idAttribute,
          lazyMountId: state.lazyMountId,
          dataUrn: state.dataUrn,
          dataId: state.dataId,
          parentTag: state.parentTag,
          parentClass: state.parentClass,
          feedRootIdentity: state.feedRootIdentity,
          signals: state.qualificationSignals,
          rejectionReason: state.rejectionReason
        },
        positioning: {
          state: state.positionState,
          error: state.positionError
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
