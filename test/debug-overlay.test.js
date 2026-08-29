// test/debug-overlay.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { updateDiagnosticOverlay, isDiagnosticModeEnabled } from "../src/content/debug-overlay.js";

function createMockElement(tag = "DIV", attrs = {}) {
  const el = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    isConnected: true,
    style: {},
    attributes: { ...attrs },
    children: [],
    firstChild: null,
    parentElement: null,
    getAttribute(name) { return this.attributes[name] || null; },
    setAttribute(name, val) { this.attributes[name] = String(val); },
    removeAttribute(name) { delete this.attributes[name]; },
    hasAttribute(name) { return name in this.attributes; },
    querySelector(sel) {
      if (sel === ":scope > .feedrule-debug-overlay" || sel === ".feedrule-debug-overlay") {
        return this.children.find(c => c.className === "feedrule-debug-overlay") || null;
      }
      return null;
    },
    insertBefore(newChild, ref) {
      this.children.unshift(newChild);
      this.firstChild = this.children[0];
      return newChild;
    },
    appendChild(child) {
      this.children.push(child);
      this.firstChild = this.children[0];
      return child;
    }
  };
  return el;
}

test("Debug Overlay: Disabled by default when no flag is set", () => {
  assert.equal(isDiagnosticModeEnabled(), false);
  const el = createMockElement("DIV", { "data-lazy-mount-id": "test_1" });
  updateDiagnosticOverlay(el, { stage: "DISCOVERED" });
  assert.equal(el.hasAttribute("data-feedrule-debug"), false);
});

test("Debug Overlay: Enabled when window.__FEEDRULE_DIAGNOSTIC__ is set", () => {
  globalThis.window = { __FEEDRULE_DIAGNOSTIC__: true };
  globalThis.document = {
    createElement(tag) {
      return createMockElement(tag);
    }
  };

  try {
    assert.equal(isDiagnosticModeEnabled(), true);
    const el = createMockElement("DIV", { "data-lazy-mount-id": "post_100" });
    
    // 1. Stage: DISCOVERED
    updateDiagnosticOverlay(el, { stage: "DISCOVERED", terminal: "DISCOVERED", postId: "post_100" });
    assert.equal(el.getAttribute("data-feedrule-debug"), "true");
    assert.equal(el.getAttribute("data-feedrule-stage"), "DISCOVERED");
    assert.equal(el.getAttribute("data-feedrule-terminal"), "DISCOVERED");
    assert.equal(el.getAttribute("data-feedrule-post-id"), "post_100");

    // 2. Stage: QUALIFIED
    updateDiagnosticOverlay(el, { stage: "QUALIFIED", qualified: true, score: 130, reason: "strong-post-structure" });
    assert.equal(el.getAttribute("data-feedrule-stage"), "QUALIFIED");
    assert.equal(el.getAttribute("data-feedrule-qualified"), "true");
    assert.equal(el.getAttribute("data-feedrule-score"), "130");

    // 3. Stage: DOM_APPLIED (HIDDEN)
    updateDiagnosticOverlay(el, { stage: "DOM_APPLIED", terminal: "DOM_HIDDEN", hide: true, domState: "HIDDEN" });
    assert.equal(el.getAttribute("data-feedrule-stage"), "DOM_APPLIED");
    assert.equal(el.getAttribute("data-feedrule-terminal"), "DOM_HIDDEN");
    assert.equal(el.getAttribute("data-feedrule-hide"), "true");

    const badge = el.querySelector(".feedrule-debug-overlay");
    assert.ok(badge, "Overlay badge must be attached to candidate element");
    assert.ok(badge.innerHTML.includes("DOM_HIDDEN"), "Badge contains terminal state");
    assert.ok(badge.innerHTML.includes("130"), "Badge contains score");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});
