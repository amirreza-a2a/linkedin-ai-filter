// test/debug-overlay.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { 
  updateDiagnosticOverlay, 
  isDiagnosticModeEnabled, 
  getDiagnosticStatus, 
  getAllDiagnosticStates,
  updateAllBadgePositions 
} from "../src/content/debug-overlay.js";

function createMockElement(tag = "DIV", attrs = {}) {
  const classListSet = new Set();
  const rawClass = attrs.class || "";
  if (rawClass) {
    rawClass.split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
  }

  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    isConnected: true,
    id: attrs.id || "",
    style: {},
    dataset: {},
    attributes: { ...attrs },
    children: [],
    firstChild: null,
    parentElement: null,
    parentNode: null,
    getBoundingClientRect() {
      return { top: 100, left: 200, width: 500, height: 400, bottom: 500, right: 700 };
    },
    classList: {
      add: (cls) => classListSet.add(cls),
      remove: (cls) => classListSet.delete(cls),
      contains: (cls) => classListSet.has(cls),
      get length() { return classListSet.size; }
    },
    getAttribute(name) {
      if (name === "class") return Array.from(classListSet).join(" ");
      return this.attributes[name] || null;
    },
    setAttribute(name, val) {
      this.attributes[name] = String(val);
      if (name === "id") this.id = String(val);
      if (name === "class") {
        classListSet.clear();
        String(val).split(/\s+/).filter(Boolean).forEach(c => classListSet.add(c));
      }
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === "class") classListSet.clear();
      if (name === "id") this.id = "";
    },
    hasAttribute(name) { return name in this.attributes; },
    querySelector(sel) {
      if (sel.includes("feedrule-target-id")) {
        const match = sel.match(/data-feedrule-target-id="([^"]+)"/);
        const targetId = match ? match[1] : "";
        return this.children.find(c => c.getAttribute("data-feedrule-target-id") === targetId) || null;
      }
      if (sel === ".feedrule-debug-overlay") {
        return this.children.find(c => c.className === "feedrule-debug-overlay") || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      return [];
    },
    insertBefore(newChild, ref) {
      this.children.unshift(newChild);
      newChild.parentElement = this;
      newChild.parentNode = this;
      this.firstChild = this.children[0];
      return newChild;
    },
    appendChild(child) {
      this.children.push(child);
      child.parentElement = this;
      child.parentNode = this;
      this.firstChild = this.children[0];
      return child;
    },
    remove() {
      if (this.parentNode) {
        this.parentNode.children = this.parentNode.children.filter(c => c !== this);
        this.parentNode = null;
        this.parentElement = null;
      }
    }
  };
  return el;
}

function setupMockDOM() {
  const body = createMockElement("BODY");
  const doc = {
    body,
    documentElement: body,
    createElement(tag) { return createMockElement(tag); },
    getElementById(id) {
      if (id === "feedrule-diagnostic-layer") {
        return body.children.find(c => c.id === "feedrule-diagnostic-layer") || null;
      }
      return null;
    }
  };
  globalThis.document = doc;
  globalThis.window = {
    __FEEDRULE_DIAGNOSTIC__: true,
    scrollX: 0,
    scrollY: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  return { doc, body };
}

test("1. Diagnostic Activation: Controlled authoritatively by sessionStorage", () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  try {
    assert.equal(isDiagnosticModeEnabled(), false);
    assert.equal(getDiagnosticStatus().active, false);

    // Turn ON via sessionStorage
    sessionStorage.setItem("FEEDRULE_DIAGNOSTIC", "1");
    assert.equal(isDiagnosticModeEnabled(), true);
    assert.equal(getDiagnosticStatus().active, true);
    assert.equal(getDiagnosticStatus().source, "sessionStorage");

    // Turn OFF via sessionStorage.removeItem
    sessionStorage.removeItem("FEEDRULE_DIAGNOSTIC");
    assert.equal(isDiagnosticModeEnabled(), false);
    assert.equal(getDiagnosticStatus().active, false);
  } finally {
    delete globalThis.sessionStorage;
  }
});

test("2. No Diagnostic DOM mutations when diagnostic mode is disabled", () => {
  const { doc, body } = setupMockDOM();
  globalThis.window.__FEEDRULE_DIAGNOSTIC__ = false;

  try {
    const el = createMockElement("DIV", { "data-lazy-mount-id": "clean_post" });
    updateDiagnosticOverlay(el, { stage: "DISCOVERED" });
    assert.equal(el.hasAttribute("data-feedrule-debug"), false);
    assert.equal(doc.getElementById("feedrule-diagnostic-layer"), null);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("3. Document-Level Layer & Real-DOM Verification: DOM_HIDDEN verified in external layer", () => {
  const { doc, body } = setupMockDOM();

  try {
    const postEl = createMockElement("DIV", { "data-lazy-mount-id": "post_robotics" });
    body.appendChild(postEl);

    // Simulate applyDecision hide = true
    postEl.classList.add("feedrule-hidden");
    postEl.setAttribute("data-feedrule-hidden", "true");

    updateDiagnosticOverlay(postEl, {
      stage: "DOM_APPLIED",
      hide: true,
      reason: "Robotics post",
    });

    assert.equal(postEl.getAttribute("data-feedrule-stage"), "DOM_APPLIED");
    assert.equal(postEl.getAttribute("data-feedrule-terminal"), "DOM_HIDDEN");
    assert.equal(postEl.getAttribute("data-feedrule-verified"), "true");

    const layer = doc.getElementById("feedrule-diagnostic-layer");
    assert.ok(layer, "Diagnostic layer mounted in document");

    const badge = layer.querySelector('[data-feedrule-target-id="post_robotics"]');
    assert.ok(badge, "Badge rendered inside document-level diagnostic layer");
    assert.ok(badge.innerHTML.includes("DOM_HIDDEN"), "Badge shows DOM_HIDDEN");
    assert.ok(badge.innerHTML.includes("ACTUALLY HIDDEN"), "Badge confirms verified hidden");

    const states = getAllDiagnosticStates();
    assert.equal(states.length, 1);
    assert.equal(states[0].postId, "post_robotics");
    assert.equal(states[0].terminal, "DOM_HIDDEN");
    assert.equal(states[0].domState.verified, true);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("4. Real-DOM Verification: DOM_APPLY_FAILED when hidden class/attribute is missing", () => {
  const { doc, body } = setupMockDOM();

  try {
    const postEl = createMockElement("DIV", { "data-lazy-mount-id": "post_failed" });
    body.appendChild(postEl);

    updateDiagnosticOverlay(postEl, {
      stage: "DOM_APPLIED",
      hide: true,
      reason: "Should hide",
    });

    assert.equal(postEl.getAttribute("data-feedrule-terminal"), "DOM_APPLY_FAILED");
    assert.equal(postEl.getAttribute("data-feedrule-verified"), "false");

    const layer = doc.getElementById("feedrule-diagnostic-layer");
    const badge = layer.querySelector('[data-feedrule-target-id="post_failed"]');
    assert.ok(badge.innerHTML.includes("DOM_APPLY_FAILED"), "Badge shows DOM_APPLY_FAILED");
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("5. Stale Response Protection: STALE_RESPONSE_DISCARDED recorded when node is recycled", () => {
  const { doc, body } = setupMockDOM();

  try {
    const recycledNode = createMockElement("DIV", { "data-lazy-mount-id": "post_new_b" });
    body.appendChild(recycledNode);

    updateDiagnosticOverlay(recycledNode, {
      stage: "STALE_CHECK",
      terminal: "STALE_RESPONSE_DISCARDED",
      reason: "Stale node recycled (node has post_new_b, response for post_old_a)",
      domState: "DISCARDED (STALE RECYCLE)"
    });

    assert.equal(recycledNode.getAttribute("data-feedrule-terminal"), "STALE_RESPONSE_DISCARDED");
    const layer = doc.getElementById("feedrule-diagnostic-layer");
    const badge = layer.querySelector('[data-feedrule-target-id="post_new_b"]');
    assert.ok(badge.innerHTML.includes("STALE_RESPONSE_DISCARDED"));
    assert.ok(badge.innerHTML.includes("[FR:STALE]"));
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});

test("6. API Gateway Lifecycle: API_TIMEOUT, API_SUCCESS_HIDE, API_SUCCESS_SHOW", () => {
  const { doc, body } = setupMockDOM();

  try {
    const elTimeout = createMockElement("DIV", { "data-lazy-mount-id": "p_timeout" });
    body.appendChild(elTimeout);
    updateDiagnosticOverlay(elTimeout, {
      stage: "RESPONSE_RECEIVED",
      terminal: "API_TIMEOUT",
      error: "Gateway request timed out (15000ms)"
    });
    assert.equal(elTimeout.getAttribute("data-feedrule-terminal"), "API_TIMEOUT");

    const elSuccessHide = createMockElement("DIV", { "data-lazy-mount-id": "p_hide" });
    body.appendChild(elSuccessHide);
    updateDiagnosticOverlay(elSuccessHide, {
      stage: "RESPONSE_RECEIVED",
      terminal: "API_SUCCESS_HIDE",
      hide: true,
      reason: "Robotics keyword match",
      provider: "Gemini",
      model: "gemini-2.5-flash"
    });
    assert.equal(elSuccessHide.getAttribute("data-feedrule-terminal"), "API_SUCCESS_HIDE");
    const layer = doc.getElementById("feedrule-diagnostic-layer");
    const badgeHide = layer.querySelector('[data-feedrule-target-id="p_hide"]');
    assert.ok(badgeHide.innerHTML.includes("Gemini (gemini-2.5-flash)"));

    const elSuccessShow = createMockElement("DIV", { "data-lazy-mount-id": "p_show" });
    body.appendChild(elSuccessShow);
    updateDiagnosticOverlay(elSuccessShow, {
      stage: "RESPONSE_RECEIVED",
      terminal: "API_SUCCESS_SHOW",
      hide: false,
      reason: "Neutral career post"
    });
    assert.equal(elSuccessShow.getAttribute("data-feedrule-terminal"), "API_SUCCESS_SHOW");
  } finally {
    delete globalThis.document;
    delete globalThis.window;
  }
});
