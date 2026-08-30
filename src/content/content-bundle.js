// src/content/content-bundle.js
// AUTO-GENERATED BUNDLE FOR CHROME MV3 CONTENT SCRIPT EXECUTION
// Do not edit directly; modify source files in src/content/ and run `node scripts/bundle-content.js`.

(() => {
  "use strict";

  // --- 1. Logger Subsystem ---
  // src/utils/logger.js
  // Centralized diagnostic logger with runtime debug gating.
  
  const isDebugEnabled = () => {
    if (typeof window !== "undefined" && Boolean(window.__FEEDRULE_DEBUG__)) return true;
    if (typeof globalThis !== "undefined" && Boolean(globalThis.__FEEDRULE_DEBUG__)) return true;
    if (typeof process !== "undefined" && Boolean(process.env?.FEEDRULE_DEBUG)) return true;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("FEEDRULE_DEBUG") === "1") return true;
      if (typeof localStorage !== "undefined" && localStorage.getItem("FEEDRULE_DEBUG") === "1") return true;
    } catch {}
    return false;
  };
  
  const logger = {
    debug: (tag, ...args) => {
      if (isDebugEnabled()) {
        console.log(`[FeedRule][${tag}]`, ...args);
      }
    },
    trace: (stage, details = "") => {
      if (isDebugEnabled()) {
        console.log(`[FeedRule][TRACE] ${stage} ${details}`.trim());
      }
    },
    info: (tag, ...args) => {
      if (isDebugEnabled()) {
        console.info(`[FeedRule][${tag}]`, ...args);
      }
    },
    warn: (tag, ...args) => {
      console.warn(`[FeedRule][${tag}]`, ...args);
    },
    error: (tag, ...args) => {
      console.error(`[FeedRule][${tag}]`, ...args);
    },
  };

  // --- 2. URL Sanitization Helper ---
  function sanitizeUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string") return "";
    const trimmed = rawUrl.trim();
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      // Strip query parameters and hash fragments
      parsed.search = "";
      parsed.hash = "";
      // Normalize hostname (lowercase and remove www. prefix)
      parsed.hostname = parsed.hostname.toLowerCase();
      if (parsed.hostname.startsWith("www.")) {
        parsed.hostname = parsed.hostname.slice(4);
      }
      // Normalize trailing slash on path (e.g. /in/alice/ -> /in/alice)
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString();
    } catch {
      return "";
    }
  }

  // --- 3. Diagnostic Overlay Subsystem ---
  // src/content/debug-overlay.js
  // Production Debug Visualization Mode for FeedRule.
  // Robust document-level diagnostic layer with explicit positioning safety,
  // strict provider attribution, and candidate discovery identity tracing.
  
  function isDiagnosticModeEnabled() {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1") return true;
      if (typeof localStorage !== "undefined" && localStorage.getItem("FEEDRULE_DIAGNOSTIC") === "1") return true;
    } catch {}
    if (typeof window !== "undefined" && window.__FEEDRULE_DIAGNOSTIC__ === true) return true;
    return false;
  }
  
  function getDiagnosticStatus() {
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
  
  function updateAllBadgePositions() {
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
  function formatProviderInfo(state = {}) {
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
  function updateDiagnosticOverlay(el, data = {}) {
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
  
  function getAllDiagnosticStates() {
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

  // --- 4. Post Container Qualifier ---
  // src/content/post-qualifier.js
  // Conservative Two-Stage Post Container Qualification Layer for LinkedIn DOM.
  // Balances strict negative protection (composers, carousels, comments)
  // with weighted positive evidence and an AMBIGUOUS path to prevent false negatives.
  
  const DISQUALIFIED_COMPOSER_SELECTORS = [
    "[data-testid='share-box']",
    "[data-testid='share-box-feed-entry']",
    ".share-box-feed-entry__wrapper",
    ".share-box-feed-entry",
    ".feed-shared-creator-v2",
    "[aria-label*='Start a post']",
    "[aria-label*='Create a post']",
    ".share-creation-state",
    ".share-box__input",
    "a[href*='/article/new/']",
    "a[href*='/article/edit/']",
    "#shareboxProfilePictureComponentRef",
    "#draft-text-replaceable-component",
    "[componentkey*='sharebox']",
    "[componentkey*='draft-text']",
  ];
  
  const DISQUALIFIED_RECS_SELECTORS = [
    ".feed-shared-recon-entity",
    ".feed-shared-pymk-list",
    ".feed-shared-carousel",
    ".feed-shared-actor-recommendation",
    "[data-testid*='recs-list']",
  ];
  
  const ACCEPT_THRESHOLD = 40;
  const AMBIGUOUS_THRESHOLD = 15;
  
  /**
   * Evaluates candidate container and returns deterministic qualification decision:
   * - "ACCEPT": Strong evidence of genuine post
   * - "AMBIGUOUS": Partial signals; delegated to extractPost() to inspect text/ID
   * - "REJECT": Obvious non-post UI or insufficient evidence
   *
   * @param {Element|Object} el
   * @returns {{
   *   qualified: boolean,
   *   decision: "ACCEPT" | "AMBIGUOUS" | "REJECT",
   *   score: number,
   *   signals: Record<string, boolean>,
   *   reason: string
   * }}
   */
  function isLikelyPostContainer(el) {
    if (!el || typeof el.querySelector !== "function") {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: {},
        reason: "invalid-element",
      };
    }
  
    // =========================================================================
    // STAGE 1: HARD NEGATIVE REJECTIONS (Obvious Non-Post UI Components)
    // =========================================================================
  
    // Evaluate genuine post boundary invariants to shield real posts from descendant false negatives
    const hasInitialPostUrn = Boolean(
      (el.getAttribute?.("data-urn") || "").includes("activity:") ||
      (el.getAttribute?.("data-urn") || "").includes("ugcPost:") ||
      (el.getAttribute?.("data-urn") || "").includes("sponsoredUpdate:") ||
      (el.getAttribute?.("data-id") || "").includes("activity:")
    );
    const hasInitialSocialActions = Boolean(
      el.querySelector?.(
        ".feed-shared-social-actions, .feed-shared-social-action-bar, .feed-shared-social-action-bar__action-button, button[aria-label*='React Like'], button[aria-label*='Comment on']"
      )
    );
    const hasInitialPostTimestamp = Boolean(
      el.querySelector?.("time, .update-components-actor__sub-description, .feed-shared-actor__sub-description, time[datetime]")
    );
    const hasInitialControlMenu = Boolean(
      el.querySelector?.(".feed-shared-control-menu, button[aria-label*='open control menu'], button[aria-label*='More options for post'], button[aria-label*='post by '], button[aria-label*='Post by ']")
    );
    const hasInitialPostBody = Boolean(
      el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description")
    );
  
    const isGenuinePostStructure = hasInitialPostUrn || hasInitialSocialActions || hasInitialPostTimestamp || (hasInitialControlMenu && hasInitialPostBody);
  
    // 1. "Start a post" / Composer UI
    // Path 1A: Container itself is explicitly a composer boundary
    for (const sel of DISQUALIFIED_COMPOSER_SELECTORS) {
      if (el.matches?.(sel) || el.classList?.contains?.(sel.replace(/^\./, ""))) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { composer: true },
          reason: "composer",
        };
      }
    }
  
    // Path 1B: Candidate lacks genuine post structure and contains internal composer structural markers
    if (!isGenuinePostStructure) {
      for (const sel of DISQUALIFIED_COMPOSER_SELECTORS) {
        if (el.querySelector?.(sel)) {
          return {
            qualified: false,
            decision: "REJECT",
            score: 0,
            signals: { composer: true },
            reason: "composer",
          };
        }
      }
  
      // Path 1C: Exact action combination heuristic on non-post container
      const rawText = (el.innerText || el.textContent || "").trim();
      const rawLower = rawText.toLowerCase();
      if (
        rawLower.includes("start a post") &&
        (rawLower.includes("write article") || (rawLower.includes("video") && rawLower.includes("photo")))
      ) {
        if (!hasInitialPostBody || rawText.length < 120) {
          return {
            qualified: false,
            decision: "REJECT",
            score: 0,
            signals: { composer: true },
            reason: "composer",
          };
        }
      }
    }
  
    // 2. "Recommended for you" / Follow recommendation carousels / PYMK lists
    for (const sel of DISQUALIFIED_RECS_SELECTORS) {
      if (el.matches?.(sel) || el.classList?.contains?.(sel.replace(/^\./, "")) || el.querySelector?.(sel)) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { recommendation: true },
          reason: "recommendation-card",
        };
      }
    }
  
    // Multiple entity cards / follow buttons with no genuine post text
    const followButtons = el.querySelectorAll?.("button[aria-label*='Follow'], .feed-shared-actor-recommendation button");
    const profileLinks = el.querySelectorAll?.("a[href*='/in/'], a[href*='/company/']");
    if (followButtons?.length >= 3 && profileLinks?.length >= 3) {
      const hasPostText = Boolean(
        el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text")
      );
      if (!hasPostText) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { recommendation: true },
          reason: "recommendation-card",
        };
      }
    }
  
    // Check recommendation headers (e.g. "Recommended for you", "People you may know")
    const headerText = (
      el.querySelector?.(".feed-shared-header, h2, h3, .update-components-header")?.textContent || ""
    ).toLowerCase();
    if (
      headerText.includes("recommended for you") ||
      headerText.includes("people you may know") ||
      headerText.includes("suggested for you") ||
      headerText.includes("recommended pages")
    ) {
      const hasPostText = Boolean(
        el.querySelector?.(".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text")
      );
      if (!hasPostText) {
        return {
          qualified: false,
          decision: "REJECT",
          score: 0,
          signals: { recommendation: true },
          reason: "recommendation-card",
        };
      }
    }
  
    // 3. Comments-only container
    if (
      el.classList?.contains?.("comments-comments-list") ||
      el.classList?.contains?.("comments-comment-item") ||
      (el.querySelector?.(".comments-comment-item") && !el.querySelector?.(".update-components-actor, .feed-shared-actor, [data-urn*='activity:']"))
    ) {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: { comments: true },
        reason: "comments-container",
      };
    }
  
    // 4. Social-action-only containers
    if (
      el.classList?.contains?.("feed-shared-social-actions") ||
      el.classList?.contains?.("feed-shared-social-action-bar")
    ) {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: { socialActionsOnly: true },
        reason: "social-action-only",
      };
    }
  
    // 5. Feed controls ("Sort by", "New posts", "Load more" pills/buttons)
    const textRaw = (el.innerText || el.textContent || "").trim().toLowerCase();
    if (
      textRaw.startsWith("sort by:") ||
      textRaw === "sort by" ||
      textRaw === "new posts" ||
      textRaw === "load more" ||
      textRaw === "show more results"
    ) {
      return {
        qualified: false,
        decision: "REJECT",
        score: 0,
        signals: { controls: true },
        reason: "feed-control-ui",
      };
    }
  
    // =========================================================================
    // STAGE 2: WEIGHTED POSITIVE EVIDENCE SCORING
    // =========================================================================
  
    const urn =
      el.getAttribute?.("data-urn") ||
      el.getAttribute?.("data-id") ||
      el.querySelector?.("[data-urn*='activity:'], [data-urn*='ugcPost:'], [data-urn*='sponsoredUpdate:']")?.getAttribute?.("data-urn") ||
      "";
  
    const hasValidPostUrn = /^urn:li:(?:activity|ugcPost|sponsoredUpdate):\d+$/i.test(urn);
  
    const hasPostPermalink = Boolean(
      el.querySelector?.(
        "a[href*='/feed/update/urn:li:activity:'], a[href*='/feed/update/urn:li:ugcPost:'], a[href*='/posts/'], a.update-components-actor__sub-description-link[href*='/feed/update/']"
      )
    );
  
    const hasUpdateClass =
      el.classList?.contains?.("feed-shared-update-v2") ||
      Boolean(el.querySelector?.(".feed-shared-update-v2")) ||
      Boolean(el.getAttribute?.("data-testid")?.includes("feed-update"));
  
    const hasActorStructure = Boolean(
      el.querySelector?.(".update-components-actor, .feed-shared-actor, [data-testid='actor-container'], .feed-shared-actor__container-link")
    );
  
    const hasPostTextStructure = Boolean(
      el.querySelector?.(
        ".update-components-text, [data-testid='expandable-text-box'], .feed-shared-update-v2__description, .feed-shared-text, .feed-shared-inline-show-more-text"
      )
    );
  
    const hasTimestamp = Boolean(
      el.querySelector?.(".update-components-actor__sub-description, .feed-shared-actor__sub-description, time, a[href*='/feed/update/']")
    );
  
    const hasControlMenu = Boolean(
      el.querySelector?.(".feed-shared-control-menu, button[aria-label*='post by '], button[aria-label*='Post by '], button[aria-label*='update by ']")
    );
  
    const hasAuthorLink = Boolean(
      el.querySelector?.("a[href*='/in/'], a[href*='/company/'], a[href*='/school/'], a[href*='/showcase/']")
    );
  
    const hasLazyMount = Boolean(
      el.getAttribute?.("data-lazy-mount-id") || el.querySelector?.("[data-lazy-mount-id]")
    );
  
    const hasSocialActions = Boolean(
      el.querySelector?.(".feed-shared-social-actions, .feed-shared-social-action-bar, button[aria-label*='React Like'], button[aria-label*='Comment']")
    );
  
    // Compute weighted score
    let score = 0;
    if (hasValidPostUrn) score += 40;
    if (hasPostPermalink) score += 35;
    if (hasUpdateClass) score += 25;
    if (hasActorStructure) score += 25;
    if (hasPostTextStructure) score += 25;
    if (hasLazyMount) score += 25;
    if (hasTimestamp) score += 20;
    if (hasControlMenu) score += 20;
    if (hasAuthorLink) score += 15;
    if (hasSocialActions) score += 10;
  
    const signals = {
      urn: hasValidPostUrn,
      permalink: hasPostPermalink,
      updateClass: hasUpdateClass,
      actor: hasActorStructure,
      lazyMount: hasLazyMount,
      text: hasPostTextStructure,
      timestamp: hasTimestamp,
      controlMenu: hasControlMenu,
      authorLink: hasAuthorLink,
      socialActions: hasSocialActions,
    };
  
    // =========================================================================
    // STAGE 3: CLASSIFICATION DECISION
    // =========================================================================
  
    if (score >= ACCEPT_THRESHOLD) {
      return {
        qualified: true,
        decision: "ACCEPT",
        score,
        signals,
        reason: hasValidPostUrn ? "activity-urn-and-content" : "strong-post-structure",
      };
    }
  
    if (score >= AMBIGUOUS_THRESHOLD) {
      return {
        qualified: true,
        decision: "AMBIGUOUS",
        score,
        signals,
        reason: "partial-signals-delegated-to-extractPost",
      };
    }
  
    return {
      qualified: false,
      decision: "REJECT",
      score,
      signals,
      reason: "insufficient-signals",
    };
  }

  // --- 5. Author Extractor ---
  // src/content/author-extractor.js
  // Ranked candidate-selection author identity extractor for LinkedIn posts.
  // Supports personal (/in/), company (/company/), school (/school/), and showcase (/showcase/) profiles.
  //
  // CORE INVARIANT:
  // `author` and `authorUrl` must ALWAYS originate from the exact same winning identity candidate / subtree.
  // Explicit metadata or headers from one actor MUST NEVER be paired with a profile URL of another actor.
  
  
  const VALID_AUTHOR_PATH_REGEX = /\/(in|company|school|showcase)\/[a-zA-Z0-9_\-%]+/i;
  const INVALID_AUTHOR_PATH_REGEX = /\/(feed\/update|posts|messaging|jobs|notifications)\b/i;
  
  const SOCIAL_CONTEXT_PATTERNS = [
    /\blikes\s+this\b/i,
    /\bliked\s+this\b/i,
    /\bcommented\s+on\s+this\b/i,
    /\breposted\s+this\b/i,
    /\bshared\s+this\b/i,
    /\bfollows\s+this\b/i,
    /\bpromoted\b/i,
    /\bsuggested\b/i,
  ];
  
  const DISQUALIFIED_CONTAINER_SELECTORS = [
    ".update-components-header",
    ".feed-shared-header",
    ".feed-shared-update-v2__header",
    ".update-components-social-activity",
    "[data-testid*='social-activity']",
    ".comments-comments-list",
    ".comments-comment-item",
    ".comments-post-meta",
    ".feed-shared-social-actions",
    ".feed-shared-social-action-bar",
    ".social-details-reactors-facepile",
    ".artdeco-button",
  ];
  
  const COMBINED_PROFILE_LINK_SELECTOR = [
    "a.update-components-actor__image[href]",
    "a.feed-shared-actor__container-link[href]",
    "a.update-components-actor__container-link[href]",
    "a.app-aware-link[href*='/in/']",
    "a.app-aware-link[href*='/company/']",
    "a.app-aware-link[href*='/school/']",
    "a.app-aware-link[href*='/showcase/']",
    "a[href*='/in/']",
    "a[href*='/company/']",
    "a[href*='/school/']",
    "a[href*='/showcase/']",
  ].join(", ");
  
  /**
   * Verifies that a URL points to a legitimate LinkedIn actor identity destination.
   *
   * @param {string} url
   * @returns {boolean}
   */
  function isValidAuthorUrl(url) {
    if (typeof url !== "string" || !url.trim()) return false;
    if (INVALID_AUTHOR_PATH_REGEX.test(url)) return false;
    return VALID_AUTHOR_PATH_REGEX.test(url);
  }
  
  /**
   * Conservatively sanitizes an extracted author name by removing known LinkedIn UI badges and noise.
   * Never applies broad NLP heuristics that could alter legitimate names or titles.
   *
   * @param {string} rawName
   * @returns {string}
   */
  function cleanAuthorName(rawName) {
    if (typeof rawName !== "string" || !rawName.trim()) return "";
  
    // 1. If multiline, filter out lines that are purely "View ... profile" accessibility text
    const lines = rawName
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^View\s+.+?['’]s\s+(profile|page|company\s+page)$/i.test(l));
  
    let name = lines.length > 0 ? lines[0] : rawName.trim();
  
    // 2. Remove accessibility prefixes if inline: "View Alice's profile" -> "Alice"
    name = name.replace(/^View\s+(.+?)['’]s\s+(?:profile|page|company\s+page)$/i, "$1");
  
    // 3. Remove connection degree badges ("• 1st", "• 2nd", "• 3rd+", "Following", "You", "Premium")
    name = name.replace(/\s*[•·]\s*(1st|2nd|3rd\+?|Following|You|Premium)\b.*/i, "");
  
    // 4. Remove social context phrases (reposted this, liked this, Promoted, Suggested)
    name = name.replace(/\s+(reposted|shared|liked|commented\s+on|likes|follows)\s+this.*$/i, "");
    name = name.replace(/^(Promoted|Suggested\s+for\s+you|Suggested)\b.*/i, "");
  
    // 5. Clean extra bullet artifacts and whitespace
    name = name.replace(/^[•·\s-]+|[•·\s-]+$/g, "").trim();
    name = name.replace(/\s+/g, " ");
  
    return name;
  }
  
  /**
   * Checks whether an element is inside an excluded social-context or comments region.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function isDisqualifiedElement(el) {
    if (!el) return true;
  
    // 1. Explicit disqualification selectors (headers, likers, comments, social actions)
    for (const sel of DISQUALIFIED_CONTAINER_SELECTORS) {
      if (el.closest?.(sel)) return true;
    }
  
    // 2. Check surrounding text for social context indicators ("likes this", "commented on this")
    const parentText = (el.parentElement?.textContent || "").toLowerCase();
    for (const pattern of SOCIAL_CONTEXT_PATTERNS) {
      if (pattern.test(parentText)) return true;
    }
  
    return false;
  }
  
  /**
   * Checks whether a candidate anchor's subtree matches a target author name.
   * Prevents cross-contamination where explicit post metadata of Actor A is applied to Actor B's URL.
   *
   * @param {Element} anchor
   * @param {string} authorUrl
   * @param {string} explicitName
   * @returns {boolean}
   */
  function doesCandidateMatchExplicitName(anchor, authorUrl, explicitName) {
    if (!explicitName || typeof explicitName !== "string") return false;
    const target = explicitName.trim().toLowerCase();
    if (!target) return false;
  
    const aria = cleanAuthorName(anchor.getAttribute?.("aria-label") || "").toLowerCase();
    if (aria === target) return true;
  
    const text = cleanAuthorName(anchor.textContent || "").toLowerCase();
    if (text === target) return true;
  
    const scope = anchor.closest?.(".update-components-actor, .feed-shared-actor") || anchor;
    const nameEl =
      scope.querySelector?.(".update-components-actor__name") ||
      scope.querySelector?.(".feed-shared-actor__name") ||
      scope.querySelector?.("span[dir='ltr']");
    const scopeName = cleanAuthorName(nameEl?.innerText || nameEl?.textContent || "").toLowerCase();
    if (scopeName === target) return true;
  
    const img = anchor.querySelector?.("img[alt]");
    const alt = cleanAuthorName(img?.getAttribute?.("alt") || "").toLowerCase();
    if (alt === target) return true;
  
    // Check URL slug (e.g. "https://linkedin.com/in/armindaraei" matches "Armin Daraei")
    const targetSlug = target.replace(/[^a-z0-9]/g, "");
    const urlSlug = (authorUrl || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (targetSlug.length >= 4 && urlSlug.includes(targetSlug)) return true;
  
    return false;
  }
  
  /**
   * Extracts explicit post author metadata from container accessibility labels if present.
   * Covers:
   * - aria-label="Open control menu for post by Armin Daraei"
   * - aria-label="Hide post by Armin Daraei"
   * - aria-label="Feed post by Armin Daraei"
   * - aria-label="Post by Armin Daraei"
   * - aria-label="Update by Armin Daraei"
   *
   * @param {Element} root
   * @returns {string} Clean author name from metadata or ""
   */
  function extractExplicitAuthorMetadata(root) {
    if (!root || typeof root.getAttribute !== "function") return "";
  
    const ariaLabels = [];
    const rootAria = root.getAttribute("aria-label");
    if (rootAria) ariaLabels.push(rootAria);
  
    if (typeof root.querySelectorAll === "function") {
      const labelled = root.querySelectorAll("[aria-label*='post by '], [aria-label*='Post by '], [aria-label*='update by '], [aria-label*='Update by ']");
      for (const l of labelled) {
        const a = l.getAttribute("aria-label");
        if (a) ariaLabels.push(a);
      }
    }
  
    for (const label of ariaLabels) {
      const match = label.match(/\b(?:post|update)\s+by\s+([^,.;\n]+)/i);
      if (match && match[1]) {
        const clean = cleanAuthorName(match[1]);
        if (clean) return clean;
      }
    }
  
    return "";
  }
  
  /**
   * Extracts author identity from a post container using a ranked candidate-selection pipeline.
   *
   * RANKING PRIORITY:
   * 1. Explicit post-author accessibility labels (e.g. "Open control menu for post by <Author>")
   * 2. Anchors inside primary post-header actor containers (.update-components-actor, .feed-shared-actor)
   * 3. Anchors with specific actor markup classes
   * 4. General identity links (/in/, /company/, /school/, /showcase/)
   *
   * STRICT INVARIANT:
   * `author` and `authorUrl` MUST originate from the same winning identity candidate / subtree.
   *
   * @param {Element} el Post container element
   * @param {Function} [sanitizeUrlFn=sanitizeUrl] Canonical URL sanitizer
   * @returns {{ author: string, authorUrl: string }}
   */
  function extractAuthor(el, sanitizeUrlFn = sanitizeUrl) {
    if (!el || typeof el.querySelector !== "function") {
      return { author: "", authorUrl: "" };
    }
  
    // 1. Extract explicit metadata signal if present (e.g. control menu / post label)
    const explicitAuthorName = extractExplicitAuthorMetadata(el);
  
    // 2. Locate and rank all candidate profile anchors in the post in a single query pass
    const candidateAnchors = [];
    const seenUrls = new Set();
  
    const matches = Array.from(el.querySelectorAll(COMBINED_PROFILE_LINK_SELECTOR));
    for (const a of matches) {
      const rawHref = a.getAttribute("href") || a.href || "";
      if (!isValidAuthorUrl(rawHref)) continue;
  
      const sanitizedHref = sanitizeUrlFn(rawHref);
      if (!isValidAuthorUrl(sanitizedHref)) continue;
  
      if (seenUrls.has(sanitizedHref)) continue;
      seenUrls.add(sanitizedHref);
  
      // Check disqualification (social headers, comments, etc.)
      if (isDisqualifiedElement(a)) continue;
  
      // Score this candidate
      let score = 10; // Base score for valid profile link outside disqualified containers
  
      const inActorContainer = Boolean(
        a.closest?.(".update-components-actor") ||
        a.closest?.(".feed-shared-actor") ||
        a.closest?.("[data-testid='actor-container']")
      );
      if (inActorContainer) score += 100;
  
      const inActorMeta = Boolean(
        a.closest?.(".update-components-actor__meta") ||
        a.closest?.(".update-components-actor__title") ||
        a.closest?.(".feed-shared-actor__title") ||
        a.closest?.(".update-components-actor__container")
      );
      if (inActorMeta) score += 50;
  
      if (
        a.classList?.contains?.("update-components-actor__image") ||
        a.classList?.contains?.("feed-shared-actor__container-link") ||
        a.classList?.contains?.("update-components-actor__container-link")
      ) {
        score += 40;
      }
  
      // Check for explicit name match
      const ariaLabel = a.getAttribute("aria-label") || "";
      const text = a.textContent || "";
      const cleanAria = cleanAuthorName(ariaLabel);
      const cleanText = cleanAuthorName(text);
  
      if (explicitAuthorName && doesCandidateMatchExplicitName(a, sanitizedHref, explicitAuthorName)) {
        score += 200;
      }
  
      if (cleanAria || cleanText) score += 20;
  
      candidateAnchors.push({
        anchor: a,
        authorUrl: sanitizedHref,
        score,
        inActorContainer,
      });
    }
  
    // Sort candidates by score descending
    candidateAnchors.sort((a, b) => b.score - a.score);
  
    if (candidateAnchors.length > 0 && candidateAnchors[0].score > 0) {
      const winner = candidateAnchors[0];
      const anchor = winner.anchor;
      const authorUrl = winner.authorUrl;
  
      // CORE INVARIANT: author and authorUrl must always originate from the same winning identity subtree.
      let rawAuthor = "";
  
      // If explicit metadata exists and genuinely matches this winning candidate subtree, use explicit name
      if (explicitAuthorName && doesCandidateMatchExplicitName(anchor, authorUrl, explicitAuthorName)) {
        rawAuthor = explicitAuthorName;
      }
  
      // Priority 1: aria-label on anchor
      if (!rawAuthor) {
        const ariaLabel = anchor.getAttribute("aria-label");
        if (ariaLabel && cleanAuthorName(ariaLabel)) {
          rawAuthor = ariaLabel;
        }
      }
  
      // Priority 2: semantic name element within the winner's actor scope
      if (!rawAuthor) {
        const scope = anchor.closest?.(".update-components-actor, .feed-shared-actor") || anchor;
        const nameEl =
          scope.querySelector(".update-components-actor__name") ||
          scope.querySelector(".feed-shared-actor__name") ||
          scope.querySelector("span[dir='ltr']");
        if (nameEl?.innerText?.trim()) {
          rawAuthor = nameEl.innerText.trim();
        } else if (nameEl?.textContent?.trim()) {
          rawAuthor = nameEl.textContent.trim();
        }
      }
  
      // Priority 3: text content of the anchor
      if (!rawAuthor && anchor.textContent?.trim()) {
        rawAuthor = anchor.textContent.trim();
      }
  
      // Priority 4: image alt
      if (!rawAuthor) {
        const img = anchor.querySelector("img[alt]");
        if (img?.getAttribute("alt")?.trim()) {
          rawAuthor = img.getAttribute("alt").trim();
        }
      }
  
      const author = cleanAuthorName(rawAuthor);
      return { author, authorUrl };
    }
  
    // 3. Fallback: Semantic Name Element without Link (outside social context)
    const nameEl =
      el.querySelector(".update-components-actor__name") ||
      el.querySelector(".feed-shared-actor__name") ||
      el.querySelector("span.update-components-actor__title span[dir='ltr']");
  
    if (nameEl && !isDisqualifiedElement(nameEl)) {
      const rawAuthor = (nameEl.innerText || nameEl.textContent || "").trim();
      const cleanName = cleanAuthorName(rawAuthor);
      return {
        author: cleanName,
        authorUrl: "",
      };
    }
  
    // If explicit metadata was on the container but no links found
    if (explicitAuthorName) {
      return {
        author: explicitAuthorName,
        authorUrl: "",
      };
    }
  
    return { author: "", authorUrl: "" };
  }

  // --- 6. Content Script Core Pipeline ---
  // src/content/content-index.js
  // Feed watcher & DOM filter for LinkedIn feed using standard ES modules.
  // Identity-aware incremental reprocessing for initial load, Load More, container reuse, and video autoplay.
  // High-performance architecture: non-feed fast rejection, scoped mutation routing, cached video state, and 0 in-flight memory leaks.
  
  
  
  
  
  logger.debug("CONTENT", "content script module loaded on", typeof location !== "undefined" ? location.href : "");
  
  try {
    const runtimeApi =
      typeof globalThis.browser !== "undefined" && globalThis.browser?.runtime
        ? globalThis.browser.runtime
        : typeof globalThis.chrome !== "undefined"
        ? globalThis.chrome?.runtime
        : null;
    if (runtimeApi?.getURL && typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute("data-feedrule-extension-url", runtimeApi.getURL(""));
    }
    if (typeof window !== "undefined") {
      window.addEventListener("__feedrule_test_message", (event) => {
        const payload = event.detail;
        if (!payload || !runtimeApi?.sendMessage) return;
        runtimeApi.sendMessage(payload, (response) => {
          window.dispatchEvent(
            new CustomEvent("__feedrule_test_response", {
              detail: { response, lastError: runtimeApi.lastError?.message },
            })
          );
        });
      });
    }
  } catch {}
  
  const HIDDEN_CLASS = "feedrule-hidden";
  
  const COMBINED_CONTAINER_SELECTOR = [
    "div.feed-shared-update-v2",
    "div.occludable-update",
    "div[data-lazy-mount-id]",
    "div[data-urn*='activity:']",
    "div[data-urn*='ugcPost:']",
    "div[data-urn*='sponsoredUpdate:']",
    "div[data-id*='activity:']",
    'div[data-testid="mainFeed"] div[role="listitem"]',
    'div[role="listitem"]',
    'div[role="list"] > div',
  ].join(", ");
  
  const NON_FEED_ANCESTOR_SELECTOR = [
    "#global-nav",
    ".global-nav",
    "header.global-nav",
    ".msg-overlay-container",
    ".msg-overlay-list-bubble",
    ".scaffold-layout__aside",
    "#artdeco-toasts__wormhole",
    ".feed-follows-module",
    "footer.global-footer",
  ].join(", ");
  
  const FEED_ROOT_SELECTORS = [
    "main#workspace",
    "main.scaffold-layout__main",
    "div[data-testid='mainFeed']",
    ".scaffold-finite-scroll__content",
    ".scaffold-finite-scroll",
    "main#workspace section",
    "main#workspace section div[role='list']",
    "div.core-rail",
    "main[role='main']",
  ];
  
  const TEXT_CANDIDATES = [
    '[data-testid="expandable-text-box"]',
    ".feed-shared-update-v2__description",
    ".update-components-text",
    ".feed-shared-text",
    ".feed-shared-inline-show-more-text",
  ];
  
  const POST_LINK_CANDIDATES = [
    "a.update-components-actor__sub-description-link[href*='/feed/update/']",
    "a.update-components-actor__sub-description-link[href*='/posts/']",
    "a.update-components-actor__sub-description a[href*='/feed/update/']",
    "a.feed-shared-actor__sub-description a[href*='/feed/update/']",
    "a[href*='/feed/update/urn:li:activity:']",
    "a[href*='/feed/update/urn:li:ugcPost:']",
    "a.app-aware-link[href*='/feed/update/']",
    "a.app-aware-link[href*='/posts/']",
  ];
  
  // Production performance metrics
  const performanceStats = {
    mutationCallbacks: 0,
    childListMutations: 0,
    attributeMutations: 0,
    classMutations: 0,
    identityMutations: 0,
    ignoredMutations: 0,
    relevantMutations: 0,
    mutationQueueMaxSize: 0,
    mutationQueueFlushes: 0,
    scanCalls: 0,
    querySelectorAllCalls: 0,
    videoPauseTraversals: 0,
    videosPaused: 0,
    classificationDispatches: 0,
    inFlightElementMaxSize: 0,
    observerAttachCount: 0,
    observerDisconnectCount: 0,
    currentObserverAttached: 0,
    feedRootChanges: 0,
    feedRootResolutionAttempts: 0,
    mutationProcessingTimeMs: 0,
    maxMutationProcessingTimeMs: 0,
    scanProcessingTimeMs: 0,
    maxScanProcessingTimeMs: 0,
    startTime: typeof performance !== "undefined" && performance.now ? performance.now() : Date.now(),
  };
  
  function resetPerformanceStats() {
    performanceStats.mutationCallbacks = 0;
    performanceStats.childListMutations = 0;
    performanceStats.attributeMutations = 0;
    performanceStats.classMutations = 0;
    performanceStats.identityMutations = 0;
    performanceStats.ignoredMutations = 0;
    performanceStats.relevantMutations = 0;
    performanceStats.mutationQueueMaxSize = 0;
    performanceStats.mutationQueueFlushes = 0;
    performanceStats.scanCalls = 0;
    performanceStats.querySelectorAllCalls = 0;
    performanceStats.videoPauseTraversals = 0;
    performanceStats.videosPaused = 0;
    performanceStats.classificationDispatches = 0;
    performanceStats.inFlightElementMaxSize = 0;
    performanceStats.observerAttachCount = 0;
    performanceStats.observerDisconnectCount = 0;
    performanceStats.currentObserverAttached = 0;
    performanceStats.feedRootChanges = 0;
    performanceStats.feedRootResolutionAttempts = 0;
    performanceStats.mutationProcessingTimeMs = 0;
    performanceStats.maxMutationProcessingTimeMs = 0;
    performanceStats.scanProcessingTimeMs = 0;
    performanceStats.maxScanProcessingTimeMs = 0;
    performanceStats.startTime = Date.now();
  }
  
  function getContentPerformanceStats() {
    return {
      ...performanceStats,
      mutationQueueSize: mutationQueue.size,
      cachedDecisionsCount: decisionsById.size,
      userRevealedCount: userRevealedPostIds.size,
      inFlightCount: inFlightPostIds.size,
      inFlightElementCount: elementById.size,
      uptimeMs: Date.now() - performanceStats.startTime,
    };
  }
  
  // Simple non-cryptographic hash (djb2) for fallback fingerprinting
  function hashText(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return "t" + (hash >>> 0).toString(36);
  }
  
  // Track processed / paused video elements to prevent repeat full-subtree traversals
  const processedVideos = new WeakSet();
  
  /**
   * Helper to pause any active video playback within a container.
   * Uses WeakSet caching to avoid repeated calls on already-paused video elements.
   *
   * @param {Element|Object} container
   */
  function pauseVideosInContainer(container) {
    if (!container || typeof container.querySelectorAll !== "function") return;
    performanceStats.videoPauseTraversals++;
    try {
      const videos = container.querySelectorAll("video");
      performanceStats.querySelectorAllCalls++;
      for (const v of videos) {
        if (v && !processedVideos.has(v)) {
          processedVideos.add(v);
          if (typeof v.pause === "function" && !v.paused) {
            v.pause();
            performanceStats.videosPaused++;
          }
        }
      }
    } catch {}
  }
  
  function pauseSingleVideo(videoNode) {
    if (!videoNode || processedVideos.has(videoNode)) return;
    processedVideos.add(videoNode);
    try {
      if (typeof videoNode.pause === "function" && !videoNode.paused) {
        videoNode.pause();
        performanceStats.videosPaused++;
      }
    } catch {}
  }
  
  /**
   * Evaluates whether a DOM node is within the relevant LinkedIn feed scope.
   * Drops mutations from chat drawer, top navigation, sidebars, and ads in a single check.
   *
   * @param {Element|Object} node
   * @returns {boolean}
   */
  function isRelevantFeedScope(node) {
    if (!node || node.nodeType !== 1) return false;
  
    // Extension-injected UI is never an unclassified post container
    if (
      node.classList?.contains?.("feedrule-placeholder") ||
      node.classList?.contains?.("feedrule-show-btn") ||
      node.classList?.contains?.("feedrule-debug-overlay") ||
      node.classList?.contains?.("feedrule-debug-badge")
    ) {
      return false;
    }
  
    // Reject non-feed regions (Messaging, Global Nav, Rail, Modals)
    if (node.closest?.(NON_FEED_ANCESTOR_SELECTOR)) {
      return false;
    }
  
    return true;
  }
  
  function isFeedContainerRoot(node) {
    if (!node || node.nodeType !== 1) return false;
    return Boolean(
      node.classList?.contains?.("scaffold-finite-scroll__content") ||
      node.classList?.contains?.("scaffold-finite-scroll") ||
      node.getAttribute?.("data-testid") === "mainFeed" ||
      node.classList?.contains?.("core-rail")
    );
  }
  
  function findFeedRoot(doc = typeof document !== "undefined" ? document : null) {
    if (!doc || typeof doc.querySelector !== "function") return null;
    for (const sel of FEED_ROOT_SELECTORS) {
      const root = doc.querySelector(sel);
      if (root && isRelevantFeedScope(root) && !root.closest?.("aside, .scaffold-layout__aside")) {
        logger.trace("FEED_ROOT_FOUND", `selector=${sel}`);
        return root;
      }
    }
    return null;
  }
  
  /**
   * Extracts normalized post data from a LinkedIn post container.
   * Uses the dedicated extractAuthor helper as the single source of truth for author identity.
   *
   * @param {Element|Object} el
   * @returns {{ id: string, text: string, author: string, authorUrl: string, postUrl: string, el: Element|Object } | null}
   */
  function extractPost(el) {
    if (!el || typeof el.querySelector !== "function") return null;
  
    let text = "";
    for (const sel of TEXT_CANDIDATES) {
      const textEl = el.querySelector(sel);
      if (textEl?.innerText?.trim()) {
        text = textEl.innerText.trim();
        break;
      }
    }
    if (!text) text = (el.innerText || el.textContent || "").trim();
    text = text.slice(0, 4000);
  
    if (!text || text.length < 5) {
      return null; // ads/empty spacers etc.
    }
  
    // 1. Single Source of Truth: Coupled Author & Author Profile URL Extraction
    const { author, authorUrl } = extractAuthor(el);
  
    // 2. Post Permalink (Direct Header / Timestamp anchor)
    let postUrl = "";
    for (const sel of POST_LINK_CANDIDATES) {
      const linkEl = el.querySelector(sel);
      if (linkEl?.href) {
        postUrl = linkEl.href.split("?")[0];
        break;
      }
    }
  
    // 3. Stable 3-level Post ID Strategy
    // Level 1: Direct activity or UGC URN attribute on container or children
    let id =
      el.getAttribute?.("data-urn") ||
      el.getAttribute?.("data-id") ||
      el.getAttribute?.("data-chameleon-urn") ||
      el.getAttribute?.("data-lazy-mount-id") ||
      el.closest?.("div[data-lazy-mount-id]")?.getAttribute?.("data-lazy-mount-id") ||
      el.querySelector?.("[data-urn*='activity:']")?.getAttribute?.("data-urn") ||
      el.querySelector?.("[data-urn*='ugcPost:']")?.getAttribute?.("data-urn") ||
      el.querySelector?.("[data-lazy-mount-id]")?.getAttribute?.("data-lazy-mount-id") ||
      "";
  
    // Level 2: Extract verified URN from permalink if available
    if (!id && postUrl) {
      const urnMatch = postUrl.match(/urn:li:(?:activity|ugcPost):\d+/);
      if (urnMatch) id = urnMatch[0];
    }
  
    // Level 3: Deterministic fallback fingerprint (author + text snippet)
    if (!id) {
      id = hashText(`${author}::${text.slice(0, 500)}`);
    }
  
    // If postUrl was not found from anchors but container has a verified activity/ugcPost URN, construct canonical URL
    if (!postUrl && id && /^urn:li:(?:activity|ugcPost):\d+$/.test(id)) {
      postUrl = `https://www.linkedin.com/feed/update/${id}`;
    }
  
    return { id, text, author, authorUrl, postUrl, el };
  }
  
  function getMatchedSelector(node) {
    if (!node || typeof node.matches !== "function") return "unknown";
    const selectors = [
      "div[data-lazy-mount-id]",
      "div.feed-shared-update-v2",
      "div.occludable-update",
      "div[data-urn*='activity:']",
      "div[data-urn*='ugcPost:']",
      "div[data-urn*='sponsoredUpdate:']",
      "div[data-id*='activity:']",
      'div[data-testid="mainFeed"] div[role="listitem"]',
      'div[role="listitem"]',
      'div[role="list"] > div',
    ];
    for (const s of selectors) {
      try {
        if (node.matches(s)) return s;
      } catch {}
    }
    return "custom-candidate";
  }
  
  /**
   * Finds candidate container elements with deduplication favoring canonical inner update nodes.
   * Optimized with fast-path return when root is already a resolved post container.
   *
   * @param {Element|Object} root
   * @returns {Array<Element|Object>}
   */
  function findContainers(root) {
    if (!root || typeof root.querySelectorAll !== "function") return [];
    performanceStats.findContainersCalls++;
  
    // Fast Path: If root is already a leaf post container, return immediately without subtree query
    if (
      root.classList?.contains?.("feed-shared-update-v2") &&
      root.getAttribute?.("role") !== "listitem"
    ) {
      return [root];
    }
  
    const enclosingPost = root.closest?.("div[data-lazy-mount-id], div.feed-shared-update-v2");
    if (enclosingPost && enclosingPost !== root) {
      return [enclosingPost];
    }
  
    const rawCandidates = [];
    if (root.matches?.(COMBINED_CONTAINER_SELECTOR)) {
      rawCandidates.push(root);
    }
    const found = root.querySelectorAll(COMBINED_CONTAINER_SELECTOR) || [];
    performanceStats.querySelectorAllCalls++;
    for (const node of found) {
      rawCandidates.push(node);
    }
  
    // Deduplicate and filter out redundant outer wrappers when an inner canonical update exists
    const uniqueNodes = new Set();
    const canonicalNodes = [];
  
    for (const node of rawCandidates) {
      if (uniqueNodes.has(node)) continue;
      uniqueNodes.add(node);
  
      // If this is a generic outer container that wraps an inner canonical update, prefer the inner container
      if (
        (node.getAttribute?.("role") === "listitem" || !node.classList?.contains?.("feed-shared-update-v2")) &&
        !node.getAttribute?.("data-lazy-mount-id")
      ) {
        const innerUpdate = node.querySelector?.("div[data-lazy-mount-id], .feed-shared-update-v2, [data-urn*='activity:']");
        if (innerUpdate) {
          if (!uniqueNodes.has(innerUpdate)) {
            uniqueNodes.add(innerUpdate);
            canonicalNodes.push(innerUpdate);
          }
          continue;
        }
      }
  
      canonicalNodes.push(node);
    }
  
    // Discard redundant inner descendants when an outer canonical post container is already selected
    const filteredNodes = [];
    for (const node of canonicalNodes) {
      const parentContainer = node.parentElement?.closest?.("div[data-lazy-mount-id], div.feed-shared-update-v2");
      if (parentContainer && uniqueNodes.has(parentContainer)) {
        continue;
      }
      filteredNodes.push(node);
    }
  
    logger.trace("CONTAINERS_FOUND", `count=${filteredNodes.length}`);
    if (isDiagnosticModeEnabled()) {
      const feedRootId = root ? `${root.tagName || "ROOT"}${root.id ? "#" + root.id : ""}${root.className && typeof root.className === "string" ? "." + root.className.split(/\s+/).slice(0, 2).join(".") : ""}` : "UNKNOWN";
      for (const node of filteredNodes) {
        updateDiagnosticOverlay(node, {
          stage: "DISCOVERED",
          terminal: "DISCOVERED",
          postId: node.getAttribute("data-lazy-mount-id") || node.getAttribute("data-urn") || "unknown",
          matchedSelector: getMatchedSelector(node),
          feedRootIdentity: feedRootId,
        });
      }
    }
    return filteredNodes;
  }
  
  // --- DOM filtering & Bounded Caches ----------------------------------
  const MAX_CACHED_DECISIONS = 2000;
  const MAX_USER_REVEALED = 500;
  
  const decisionsById = new Map(); // postId -> decision object (bounded LRU)
  const userRevealedPostIds = new Set(); // postId user explicitly revealed via "Show anyway"
  
  function cacheDecision(postId, decision) {
    if (!postId || !decision) return;
    if (decisionsById.size >= MAX_CACHED_DECISIONS) {
      const oldestKey = decisionsById.keys().next().value;
      if (oldestKey) decisionsById.delete(oldestKey);
    }
    decisionsById.set(postId, decision);
  }
  
  function markPostUserRevealed(postId) {
    if (!postId) return;
    if (userRevealedPostIds.size >= MAX_USER_REVEALED) {
      const oldest = userRevealedPostIds.keys().next().value;
      if (oldest) userRevealedPostIds.delete(oldest);
    }
    userRevealedPostIds.add(postId);
  }
  
  function applyDecision(el, decision) {
    if (!el || !decision) return;
  
    logger.trace("DECISION_APPLIED", `id=${decision.id} hide=${decision.hide} reason="${decision.reason || ""}"`);
  
    cacheDecision(decision.id, decision);
    inFlightPostIds.delete(decision.id);
    elementById.delete(decision.id);
  
    // Stale selection protection: if el is currently bound to a different post, do not touch this element
    const currentPostOnNode = nodeToPostId.get(el);
    if (currentPostOnNode && currentPostOnNode !== decision.id) {
      updateDiagnosticOverlay(el, {
        stage: "STALE_CHECK",
        terminal: "STALE_RESPONSE_DISCARDED",
        reason: `Stale node recycled (node has ${currentPostOnNode}, response for ${decision.id})`,
        domState: "DISCARDED (STALE RECYCLE)",
      });
      return;
    }
  
    // If user previously clicked "Show anyway" on this post identity, preserve user reveal
    if (userRevealedPostIds.has(decision.id) || el.dataset?.feedruleUserRevealed === "1") {
      el.classList?.remove?.(HIDDEN_CLASS);
      el.removeAttribute?.("data-feedrule-hidden");
      if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
      updateDiagnosticOverlay(el, {
        stage: "DOM_APPLIED",
        hide: false,
        reason: "User explicitly revealed via 'Show anyway'",
      });
      return;
    }
  
    if (!decision.hide) {
      el.classList?.remove?.(HIDDEN_CLASS);
      el.removeAttribute?.("data-feedrule-hidden");
      if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
      if (el.dataset?.feedruleWrapped) {
        delete el.dataset.feedruleWrapped;
        const placeholder = el.querySelector?.(".feedrule-placeholder");
        if (placeholder?.remove) placeholder.remove();
      }
      updateDiagnosticOverlay(el, {
        stage: "DOM_APPLIED",
        hide: false,
        reason: decision.reason,
      });
      return;
    }
  
    // Authoritative hidden state application
    el.classList?.add?.(HIDDEN_CLASS);
    el.setAttribute?.("data-feedrule-hidden", "true");
    if (el.dataset) el.dataset.feedruleHidden = "true";
  
    // Pause any autoplaying videos inside the hidden post
    pauseVideosInContainer(el);
  
    if (!el.dataset?.feedruleWrapped || !el.querySelector?.(".feedrule-placeholder")) {
      if (typeof document !== "undefined") {
        if (el.dataset) el.dataset.feedruleWrapped = "1";
        let placeholder = el.querySelector?.(".feedrule-placeholder");
        if (!placeholder) {
          placeholder = document.createElement("div");
          placeholder.className = "feedrule-placeholder";
  
          const label = document.createElement("span");
          label.textContent = decision.reason
            ? `Hidden by your filter: ${decision.reason}`
            : "Hidden by your FeedRule AI filter";
  
          const showBtn = document.createElement("button");
          showBtn.type = "button";
          showBtn.className = "feedrule-show-btn";
          showBtn.textContent = "Show anyway";
          if (typeof showBtn.addEventListener === "function") {
            showBtn.addEventListener("click", (e) => {
              if (e && typeof e.stopPropagation === "function") e.stopPropagation();
              if (e && typeof e.preventDefault === "function") e.preventDefault();
              markPostUserRevealed(decision.id);
              if (el.dataset) el.dataset.feedruleUserRevealed = "1";
              if (placeholder.remove) placeholder.remove();
              el.classList?.remove?.(HIDDEN_CLASS);
              el.removeAttribute?.("data-feedrule-hidden");
              if (el.dataset?.feedruleHidden) delete el.dataset.feedruleHidden;
              updateDiagnosticOverlay(el, {
                stage: "DOM_APPLIED",
                hide: false,
                reason: "User clicked 'Show anyway'",
              });
            });
          }
  
          placeholder.appendChild(label);
          placeholder.appendChild(showBtn);
          if (el.prepend) {
            el.prepend(placeholder);
          } else if (el.insertBefore && el.firstChild) {
            el.insertBefore(placeholder, el.firstChild);
          } else if (el.appendChild) {
            el.appendChild(placeholder);
          }
        }
      }
    }
  
    // Final Real DOM Verification
    updateDiagnosticOverlay(el, {
      stage: "DOM_APPLIED",
      hide: true,
      reason: decision.reason,
    });
  }
  
  // --- Feed watcher & Request Queue --------------------------------------
  const elementById = new Map(); // postId -> Element (in-flight only, bounded to active batch)
  const nodeToPostId = new WeakMap(); // Element -> postId (tracks current post on this DOM node)
  const inFlightPostIds = new Set(); // postId currently queued in pending or batchQueue
  let pending = [];
  let flushTimer = null;
  const DEBOUNCE_MS = 150;
  const BATCH_SIZE = 8;
  
  function scheduleFlush(delay = DEBOUNCE_MS) {
    if (pending.length === 0) return;
    if (!flushTimer) {
      flushTimer = setTimeout(flush, delay);
    }
  }
  
  const batchQueue = [];
  let isProcessingQueue = false;
  
  // Inspection helpers for unit/regression testing
  function getPendingPosts() { return [...pending]; }
  function getCachedDecisions() { return new Map(decisionsById); }
  function getInFlightPostIds() { return new Set(inFlightPostIds); }
  function getUserRevealedPostIds() { return new Set(userRevealedPostIds); }
  function getInFlightElementCount() { return elementById.size; }
  
  function resetContentState() {
    elementById.clear();
    decisionsById.clear();
    userRevealedPostIds.clear();
    inFlightPostIds.clear();
    pending = [];
    batchQueue.length = 0;
    isProcessingQueue = false;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = null;
    mutationQueue.clear();
    resetPerformanceStats();
  }
  
  function sendBatchMessage(batch, callback) {
    if (!batch || batch.length === 0) {
      callback();
      return;
    }
    performanceStats.classificationDispatches++;
    logger.trace("CLASSIFY_DISPATCH", `count=${batch.length} ids=${JSON.stringify(batch.map((p) => p.id))}`);
  
    for (const post of batch) {
      elementById.set(post.id, post.el);
      if (post.el) {
        updateDiagnosticOverlay(post.el, {
          stage: "DISPATCHED",
          terminal: "DISPATCHED",
          postId: post.id,
        });
      }
    }
  
    if (elementById.size > performanceStats.inFlightElementMaxSize) {
      performanceStats.inFlightElementMaxSize = elementById.size;
    }
  
    const payload = {
      type: "CLASSIFY_POSTS",
      posts: batch.map((p) => ({
        id: p.id,
        text: p.text,
        author: p.author,
        authorUrl: p.authorUrl,
        postUrl: p.postUrl,
      })),
    };
  
    let handled = false;
    const handleResponse = (response, errorMsg) => {
      if (handled) return;
      handled = true;
  
      if (errorMsg) {
        logger.warn(
          "CONTENT",
          "background message status:",
          errorMsg
        );
        for (const post of batch) {
          const el = post.el || elementById.get(post.id);
          if (el) {
            updateDiagnosticOverlay(el, {
              stage: "RESPONSE_RECEIVED",
              terminal: "API_ERROR",
              error: errorMsg,
              domState: "VISIBLE (FAIL-OPEN)",
            });
          }
          inFlightPostIds.delete(post.id);
          elementById.delete(post.id);
        }
        callback();
        return;
      }
  
      logger.debug("CONTENT", "got response from background:", response);
      const results = response?.results || [];
      logger.trace("CLASSIFY_RESPONSE", `count=${results.length}`);
  
      for (const decision of results) {
        cacheDecision(decision.id, decision);
        inFlightPostIds.delete(decision.id);
  
        const el = elementById.get(decision.id);
        elementById.delete(decision.id); // Immediate release of DOM reference for garbage collection
  
        if (el) {
          updateDiagnosticOverlay(el, {
            stage: "RESPONSE_RECEIVED",
            terminal: decision.hide ? "API_SUCCESS_HIDE" : "API_SUCCESS_SHOW",
            hide: decision.hide,
            reason: decision.reason,
            provider: response?.provider || "",
            model: response?.model || "",
            isCustomEndpoint: response?.isCustomEndpoint === true,
            error: decision.error || "",
          });
  
          // Stale selection protection: verify DOM element has not been recycled for a different post
          if (nodeToPostId.get(el) !== decision.id) {
            updateDiagnosticOverlay(el, {
              stage: "STALE_CHECK",
              terminal: "STALE_RESPONSE_DISCARDED",
              reason: `Stale node recycled (node has ${nodeToPostId.get(el)}, response for ${decision.id})`,
              domState: "DISCARDED (STALE RECYCLE)",
            });
          } else {
            applyDecision(el, decision);
          }
        }
      }
  
      // Defensive invariant: ensure every item in the batch is released even if response was truncated
      for (const post of batch) {
        inFlightPostIds.delete(post.id);
        elementById.delete(post.id);
      }
      callback();
    };
  
    try {
      const runtimeApi =
        (typeof globalThis.browser !== "undefined" && globalThis.browser?.runtime)
          ? globalThis.browser.runtime
          : (typeof globalThis.chrome !== "undefined" ? globalThis.chrome?.runtime : null);
  
      if (!runtimeApi || typeof runtimeApi.sendMessage !== "function") {
        throw new Error("Extension runtime unavailable");
      }
  
      const sendPromise = runtimeApi.sendMessage(payload, (cbRes) => {
        const lastErr = runtimeApi.lastError || (typeof chrome !== "undefined" && chrome?.runtime?.lastError);
        if (lastErr) {
          handleResponse(null, lastErr.message || "runtime message error");
        } else {
          handleResponse(cbRes, null);
        }
      });
  
      if (sendPromise && typeof sendPromise.then === "function") {
        sendPromise
          .then((res) => handleResponse(res, null))
          .catch((err) => handleResponse(null, err?.message || "runtime promise rejection"));
      }
    } catch (err) {
      logger.warn("CONTENT", "extension context disconnected:", err);
      handleResponse(null, err?.message || "extension context disconnected");
    }
  }
  
  async function processQueue() {
    if (isProcessingQueue || batchQueue.length === 0) return;
    isProcessingQueue = true;
  
    try {
      while (batchQueue.length > 0) {
        const nextBatch = batchQueue.shift();
        await new Promise((resolve) => {
          try {
            sendBatchMessage(nextBatch, resolve);
          } catch (sendErr) {
            logger.error("CONTENT", "sendBatchMessage failed:", sendErr);
            resolve();
          }
        });
      }
    } catch (err) {
      logger.error("CONTENT", "unexpected error in processQueue:", err);
    } finally {
      isProcessingQueue = false;
      if (batchQueue.length > 0) {
        setTimeout(processQueue, 0);
      }
    }
  }
  
  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pending.length === 0) return;
    const batch = pending.splice(0, pending.length);
    logger.trace("FLUSH", `count=${batch.length}`);
    for (let i = 0; i < batch.length; i += BATCH_SIZE) {
      batchQueue.push(batch.slice(i, i + BATCH_SIZE));
    }
    processQueue();
  }
  
  /**
   * Scans a DOM root or subtree for candidate posts.
   * Utilizes identity-aware deduplication to support initial load, Load More, and container reuse.
   *
   * @param {Element|Object} root
   */
  function scan(root) {
    const scanStart = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    performanceStats.scanCalls++;
    const nodes = findContainers(root);
  
    if (isDebugEnabled()) {
      logger.debug(
        "CONTENT",
        `[SCAN] root=${root?.tagName || "UNKNOWN"} containersFound=${nodes.length}`
      );
    }
  
    for (const node of nodes) {
      // Two-Stage Post Qualification Layer
      const qual = isLikelyPostContainer(node);
  
      logger.trace("QUALIFICATION", `decision=${qual.decision} score=${qual.score} reason=${qual.reason}`);
  
      const sigs = qual.signals || {};
      const signalsSummary = Object.entries(sigs)
        .filter(([_, v]) => v)
        .map(([k]) => k)
        .join(", ") || "none";
  
      updateDiagnosticOverlay(node, {
        stage: "QUALIFIED",
        terminal: qual.qualified
          ? "QUALIFIED"
          : qual.reason === "composer"
          ? "REJECTED_COMPOSER"
          : "REJECTED_NOT_POST",
        qualified: qual.qualified,
        score: qual.score,
        reason: qual.reason,
        qualificationSignals: `${signalsSummary} (Score: ${qual.score})`,
        rejectionReason: qual.qualified ? "" : qual.reason,
      });
  
      if (isDebugEnabled()) {
        const sigs = qual.signals || {};
        logger.debug(
          "CONTENT",
          `CANDIDATE\n` +
            `class=${node.getAttribute?.("class") || ""}\n` +
            `urn=${Boolean(sigs.urn)} permalink=${Boolean(sigs.permalink)} actor=${Boolean(sigs.actor)} text=${Boolean(sigs.text)} authorLink=${Boolean(sigs.authorLink)}\n` +
            `score=${qual.score} decision=${qual.decision} reason=${qual.reason}`
        );
      }
  
      if (qual.decision === "REJECT") {
        continue;
      }
  
      // Process ACCEPT and AMBIGUOUS candidates through extractPost
      const post = extractPost(node);
      if (!post) {
        updateDiagnosticOverlay(node, {
          stage: "EXTRACTED",
          terminal: "EXTRACTION_FAILED",
          error: "extractPost returned null",
        });
        if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
          logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> REJECTED (no valid text or ID extracted)`);
        }
        continue;
      }
  
      updateDiagnosticOverlay(node, {
        stage: "EXTRACTED",
        postId: post.id,
        author: post.author,
      });
  
      logger.trace("POST_EXTRACTED", `id=${post.id} author="${post.author}"`);
  
      if (isDebugEnabled() && qual.decision === "AMBIGUOUS") {
        logger.debug("CONTENT", `AMBIGUOUS RESOLVED -> ACCEPTED (${post.id})`);
      }
  
      const prevPostIdOnNode = nodeToPostId.get(node);
  
      // If node was previously used for a different post (DOM reuse), clean up previous state
      if (prevPostIdOnNode && prevPostIdOnNode !== post.id) {
        node.classList?.remove?.(HIDDEN_CLASS);
        node.removeAttribute?.("data-feedrule-hidden");
        if (node.dataset?.feedruleHidden) delete node.dataset.feedruleHidden;
        if (node.dataset?.feedruleWrapped) {
          delete node.dataset.feedruleWrapped;
          const oldPlaceholder = node.querySelector?.(".feedrule-placeholder");
          if (oldPlaceholder?.remove) oldPlaceholder.remove();
        }
        if (node.dataset?.feedruleUserRevealed) {
          delete node.dataset.feedruleUserRevealed;
        }
      }
  
      // Associate current post ID with this DOM node
      nodeToPostId.set(node, post.id);
  
      // 1. Check if we already have a cached classification decision for this post identity
      if (decisionsById.has(post.id)) {
        const cachedDecision = decisionsById.get(post.id);
        if (isDebugEnabled()) {
          logger.debug(
            "CONTENT",
            `[POST] id=${post.id} decision=${cachedDecision.hide ? "HIDE" : "SHOW"} alreadyProcessed=true (cached)`
          );
        }
        updateDiagnosticOverlay(node, {
          stage: "DOM_APPLIED",
          terminal: cachedDecision.hide ? "DOM_HIDDEN" : "DOM_VISIBLE",
          hide: cachedDecision.hide,
          reason: cachedDecision.reason,
          domState: cachedDecision.hide ? "HIDDEN (CACHED)" : "VISIBLE (CACHED)",
        });
        applyDecision(node, cachedDecision);
        continue;
      }
  
      // 2. Check if this post is already in-flight (queued in pending or batchQueue)
      if (inFlightPostIds.has(post.id)) {
        if (isDebugEnabled()) {
          logger.debug(
            "CONTENT",
            `[POST] id=${post.id} decision=PENDING alreadyProcessed=true (in-flight)`
          );
        }
        updateDiagnosticOverlay(node, {
          stage: "QUEUED",
          terminal: "QUEUED",
          postId: post.id,
          author: post.author,
        });
        // Update element mapping in case node reference changed
        elementById.set(post.id, node);
        continue;
      }
  
      // 3. Genuinely new post identity: queue for classification
      logger.trace("POST_QUEUED", `id=${post.id}`);
      if (isDebugEnabled()) {
        logger.debug("CONTENT", `[POST] id=${post.id} decision=UNPROCESSED alreadyProcessed=false`);
      }
  
      updateDiagnosticOverlay(node, {
        stage: "QUEUED",
        terminal: "QUEUED",
        postId: post.id,
        author: post.author,
      });
  
      inFlightPostIds.add(post.id);
      elementById.set(post.id, node);
      pending.push(post);
    }
  
    if (pending.length > 0) {
      scheduleFlush();
    }
  
    const scanElapsed = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - scanStart;
    performanceStats.scanProcessingTimeMs += scanElapsed;
    if (scanElapsed > performanceStats.maxScanProcessingTimeMs) {
      performanceStats.maxScanProcessingTimeMs = scanElapsed;
    }
  }
  
  // --- Coalesced MutationObserver Processing ---------------------------
  let mutationTimer = null;
  const mutationQueue = new Set();
  const MUTATION_BUFFER_MS = 50;
  
  function processMutationQueue() {
    if (mutationQueue.size === 0) return;
  
    const rootsToScan = [];
    for (const node of mutationQueue) {
      let isChild = false;
      let parent = node.parentElement;
      while (parent) {
        if (mutationQueue.has(parent)) {
          isChild = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!isChild) {
        rootsToScan.push(node);
      }
    }
    mutationQueue.clear();
  
    for (const root of rootsToScan) {
      scan(root);
    }
  
    if (pending.length > 0) {
      scheduleFlush();
    }
  }
  
  /**
   * Centralized MutationObserver handler.
   * High-performance 3-way routed pipeline:
   * 1. Scope filter drops non-feed mutations (chat, nav, sidebars) immediately.
   * 2. Class mutations on hidden posts trigger synchronous presentation enforcement without full-container video queries or queueing.
   * 3. Identity mutations (data-urn) trigger post container recycling / re-evaluation.
   * 4. Child additions queue only verified post containers or feed sections, and pause newly added videos directly.
   *
   * @param {MutationRecord[]} mutations
   */
  function handleMutations(mutations) {
    const mutStart = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    performanceStats.mutationCallbacks++;
    let sawAdditions = false;
  
    for (const m of mutations || []) {
      const target = m.target;
      if (!target || target.nodeType !== 1) continue;
  
      // Fast Non-Feed Scope Filter (drops chat, nav, notifications in 1 check)
      if (!isRelevantFeedScope(target)) {
        performanceStats.ignoredMutations++;
        continue;
      }
  
      // BRANCH 1: Presentation Attribute (class)
      if (m.type === "attributes") {
        performanceStats.attributeMutations++;
        const attrName = m.attributeName;
  
        if (attrName === "class") {
          performanceStats.classMutations++;
          // Resolve enclosing container
          const enclosing = target.closest?.(COMBINED_CONTAINER_SELECTOR) || (target.matches?.(COMBINED_CONTAINER_SELECTOR) ? target : null);
          if (!enclosing) {
            performanceStats.ignoredMutations++;
            continue;
          }
  
          const currentPostId = nodeToPostId.get(enclosing);
          if (currentPostId && decisionsById.has(currentPostId)) {
            const decision = decisionsById.get(currentPostId);
            if (
              decision?.hide &&
              !userRevealedPostIds.has(currentPostId) &&
              enclosing.dataset?.feedruleUserRevealed !== "1"
            ) {
              // Synchronously re-assert hidden state if stripped by LinkedIn video playback
              if (!enclosing.classList?.contains?.(HIDDEN_CLASS)) {
                enclosing.classList?.add?.(HIDDEN_CLASS);
              }
              if (enclosing.getAttribute?.("data-feedrule-hidden") !== "true") {
                enclosing.setAttribute?.("data-feedrule-hidden", "true");
              }
              // Invariant: Do NOT execute pauseVideosInContainer on class mutations (zero full-tree traversals)
            }
            // Class mutation on an already-classified post never triggers a scan
            performanceStats.ignoredMutations++;
            continue;
          }
  
          // Class mutations on unclassified nodes do not trigger scans
          performanceStats.ignoredMutations++;
          continue;
        }
  
        // BRANCH 2: Identity Attributes (data-urn, data-id, data-chameleon-urn, data-lazy-mount-id)
        if (
          attrName === "data-urn" ||
          attrName === "data-id" ||
          attrName === "data-chameleon-urn" ||
          attrName === "data-lazy-mount-id"
        ) {
          performanceStats.identityMutations++;
          const enclosing = target.closest?.(COMBINED_CONTAINER_SELECTOR) || target;
          if (enclosing) {
            mutationQueue.add(enclosing);
            sawAdditions = true;
            performanceStats.relevantMutations++;
          }
          continue;
        }
  
        performanceStats.ignoredMutations++;
        continue;
      }
  
      // BRANCH 3: ChildList Mutations
      if (m.type === "childList") {
        performanceStats.childListMutations++;
        for (const node of m.addedNodes || []) {
          if (!node || node.nodeType !== 1) continue;
  
          if (!isRelevantFeedScope(node)) {
            performanceStats.ignoredMutations++;
            continue;
          }
  
          // Check if added node is inside an existing post container
          const enclosing = node.closest?.("div[data-lazy-mount-id], div.feed-shared-update-v2, div[data-urn*='activity:']") || node.closest?.(COMBINED_CONTAINER_SELECTOR);
          if (enclosing) {
            const currentPostId = nodeToPostId.get(enclosing);
            if (currentPostId && decisionsById.has(currentPostId)) {
              const decision = decisionsById.get(currentPostId);
              if (
                decision?.hide &&
                !userRevealedPostIds.has(currentPostId) &&
                enclosing.dataset?.feedruleUserRevealed !== "1"
              ) {
                // Synchronously maintain hidden attributes
                if (!enclosing.classList?.contains?.(HIDDEN_CLASS)) {
                  enclosing.classList?.add?.(HIDDEN_CLASS);
                }
                if (enclosing.getAttribute?.("data-feedrule-hidden") !== "true") {
                  enclosing.setAttribute?.("data-feedrule-hidden", "true");
                }
                // Localized video pause: only inspect newly inserted node/subtree, NEVER whole post container!
                if (node.tagName === "VIDEO") {
                  pauseSingleVideo(node);
                } else if (typeof node.querySelectorAll === "function") {
                  pauseVideosInContainer(node);
                }
                performanceStats.ignoredMutations++;
                continue; // Do NOT queue already-hidden post
              }
            }
            // Unclassified enclosing post container
            mutationQueue.add(enclosing);
            sawAdditions = true;
            performanceStats.relevantMutations++;
            continue;
          }
  
          // Node is NOT inside an existing post container. Is it a post container candidate or feed root?
          if (node.matches?.(COMBINED_CONTAINER_SELECTOR) || isFeedContainerRoot(node)) {
            mutationQueue.add(node);
            sawAdditions = true;
            performanceStats.relevantMutations++;
          } else {
            // Check if it contains candidate post containers
            const hasPosts = node.querySelector?.(COMBINED_CONTAINER_SELECTOR);
            if (hasPosts) {
              mutationQueue.add(node);
              sawAdditions = true;
              performanceStats.relevantMutations++;
            } else {
              performanceStats.ignoredMutations++;
            }
          }
        }
      }
    }
  
    if (mutationQueue.size > performanceStats.mutationQueueMaxSize) {
      performanceStats.mutationQueueMaxSize = mutationQueue.size;
    }
  
    const mutElapsed = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - mutStart;
    performanceStats.mutationProcessingTimeMs += mutElapsed;
    if (mutElapsed > performanceStats.maxMutationProcessingTimeMs) {
      performanceStats.maxMutationProcessingTimeMs = mutElapsed;
    }
  
    if (sawAdditions) {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(processMutationQueue, MUTATION_BUFFER_MS);
    }
  }
  
  // --- Observer Lifecycle Management (Dynamic feed root & SPA replacement) ---
  let currentFeedObserver = null;
  let currentObservedFeedRoot = null;
  let feedRootPollTimer = null;
  
  let feedScrollScanAttached = false;
  let feedScrollScanTimer = null;
  
  function ensureScrollListener() {
    if (feedScrollScanAttached || typeof window === "undefined") return;
    feedScrollScanAttached = true;
    window.addEventListener(
      "scroll",
      () => {
        if (!feedScrollScanTimer) {
          feedScrollScanTimer = setTimeout(() => {
            feedScrollScanTimer = null;
            const root = currentObservedFeedRoot || (typeof document !== "undefined" ? findFeedRoot(document) : null);
            if (root) {
              scan(root);
            }
          }, 300);
        }
      },
      { capture: true, passive: true }
    );
  }
  
  function attachFeedObserver(feedRoot) {
    if (!feedRoot) return false;
    performanceStats.feedRootResolutionAttempts++;
  
    // If already observing this exact feed root, do not duplicate
    if (currentObservedFeedRoot === feedRoot && currentFeedObserver) {
      return true;
    }
  
    // If observing a different root, disconnect it first (feed root replacement in SPA)
    if (currentFeedObserver) {
      currentFeedObserver.disconnect();
      performanceStats.observerDisconnectCount++;
      performanceStats.currentObserverAttached = 0;
      performanceStats.feedRootChanges++;
      currentFeedObserver = null;
      currentObservedFeedRoot = null;
    }
  
    try {
      currentFeedObserver = new MutationObserver(handleMutations);
      currentFeedObserver.observe(feedRoot, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-urn", "data-id", "data-chameleon-urn", "data-lazy-mount-id", "class"],
      });
  
      currentObservedFeedRoot = feedRoot;
      performanceStats.observerAttachCount++;
      performanceStats.currentObserverAttached = 1;
  
      logger.trace("OBSERVER_ATTACHED", `root=${feedRoot.tagName || "ROOT"}`);
  
      ensureScrollListener();
  
      // Scan initial posts in this feed root
      logger.trace("INITIAL_SCAN", `root=${feedRoot.tagName || "ROOT"}`);
      scan(feedRoot);
      if (pending.length > 0) {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 0);
      }
  
      // Follow-up scans for lazy-hydrated React subtrees
      setTimeout(() => {
        if (currentObservedFeedRoot === feedRoot) {
          scan(feedRoot);
        }
      }, 500);
      setTimeout(() => {
        if (currentObservedFeedRoot === feedRoot) {
          scan(feedRoot);
        }
      }, 1200);
      setTimeout(() => {
        if (currentObservedFeedRoot === feedRoot) {
          scan(feedRoot);
        }
      }, 2500);
      setTimeout(() => {
        if (currentObservedFeedRoot === feedRoot) {
          scan(feedRoot);
        }
      }, 4000);
  
      return true;
    } catch (err) {
      logger.warn("CONTENT", "failed to attach feed observer:", err);
      return false;
    }
  }
  
  function disconnectFeedObserver() {
    if (currentFeedObserver) {
      currentFeedObserver.disconnect();
      performanceStats.observerDisconnectCount++;
      performanceStats.currentObserverAttached = 0;
      currentFeedObserver = null;
      currentObservedFeedRoot = null;
    }
    if (feedRootPollTimer) {
      clearInterval(feedRootPollTimer);
      feedRootPollTimer = null;
    }
  }
  
  function dumpFeedRuleRuntimeState() {
    const root = currentObservedFeedRoot;
    const rootDesc = root
      ? `${root.tagName?.toLowerCase() || "unknown"}${root.id ? "#" + root.id : ""}${root.className ? "." + String(root.className).split(" ").slice(0, 2).join(".") : ""}`
      : "null";
  
    return `
  FeedRule Runtime State
  ────────────────────────
  feedRoot: ${rootDesc}
  observer: ${currentFeedObserver ? "attached" : "not attached"}
  pending: ${pending.length}
  inFlight: ${inFlightPostIds.size}
  decisionCache: ${decisionsById.size}
  revealedCount: ${userRevealedPostIds.size}
  currentObserverAttached: ${performanceStats.currentObserverAttached}
  observerAttachCount: ${performanceStats.observerAttachCount}
  observerDisconnectCount: ${performanceStats.observerDisconnectCount}
  scanCalls: ${performanceStats.scanCalls}
  classificationDispatches: ${performanceStats.classificationDispatches}
  `.trim();
  }
  
  function initFeedObserver(doc = typeof document !== "undefined" ? document : null) {
    if (!doc) return;
  
    const root = findFeedRoot(doc);
    if (root) {
      attachFeedObserver(root);
      return;
    }
  
    // Bounded retry polling (check every 250ms up to 20 times = 5s)
    let attempts = 0;
    const maxAttempts = 20;
    if (feedRootPollTimer) clearInterval(feedRootPollTimer);
  
    feedRootPollTimer = setInterval(() => {
      attempts++;
      performanceStats.feedRootResolutionAttempts++;
      const found = findFeedRoot(doc);
      if (found) {
        clearInterval(feedRootPollTimer);
        feedRootPollTimer = null;
        attachFeedObserver(found);
      } else if (attempts >= maxAttempts) {
        clearInterval(feedRootPollTimer);
        feedRootPollTimer = null;
        logger.debug("CONTENT", "feed root not found within bounded initialization window");
      }
    }, 250);
  }
  
  if (typeof window !== "undefined") {
    window.__dumpFeedRuleState = () => console.log(dumpFeedRuleRuntimeState());
    window.__getFeedRuleState = dumpFeedRuleRuntimeState;
    window.findContainers = findContainers;
    window.isLikelyPostContainer = isLikelyPostContainer;
    window.extractPost = extractPost;
    window.scan = scan;
    window.isDiagnosticModeEnabled = isDiagnosticModeEnabled;
    window.updateDiagnosticOverlay = updateDiagnosticOverlay;
    window.getAllDiagnosticStates = getAllDiagnosticStates;
    window.__getFeedRuleDiagnosticStates = getAllDiagnosticStates;
    window.addEventListener("popstate", () => initFeedObserver(document));
  }
  
  if (typeof document !== "undefined") {
    initFeedObserver(document);
  }
})();
