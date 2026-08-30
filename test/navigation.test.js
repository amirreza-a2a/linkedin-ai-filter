import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PAGE_PATHS,
  getCanonicalRelativePath,
  getCanonicalExtensionUrl,
  normalizeExtensionPathname,
  isInternalExtensionUrl,
  openExtensionPage,
} from "../src/navigation/navigation.js";

// Mock Chrome Environment Helper
function createMockChrome(initialTabs = []) {
  let nextTabId = 1000;
  const tabs = [...initialTabs];
  const calls = {
    query: [],
    update: [],
    create: [],
    windowsUpdate: [],
  };

  const mock = {
    runtime: {
      getURL(path) {
        const clean = path.replace(/^\//, "");
        return `chrome-extension://feedrule-extension-id/${clean}`;
      },
    },
    tabs: {
      async query(queryInfo) {
        calls.query.push(queryInfo);
        if (queryInfo.url) {
          return tabs.filter((t) => t.url === queryInfo.url);
        }
        return [...tabs];
      },
      async update(tabId, updateProps) {
        calls.update.push({ tabId, updateProps });
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) {
          throw new Error(`No tab with id: ${tabId}`);
        }
        Object.assign(tab, updateProps);
        return tab;
      },
      async create(createProps) {
        calls.create.push(createProps);
        const newTab = {
          id: ++nextTabId,
          url: createProps.url,
          active: true,
          windowId: 1,
        };
        tabs.push(newTab);
        return newTab;
      },
    },
    windows: {
      async update(windowId, updateProps) {
        calls.windowsUpdate.push({ windowId, updateProps });
        return { id: windowId, ...updateProps };
      },
    },
  };

  return { mock, tabs, calls };
}

// =========================================================================
// 1. FILESYSTEM & CANONICAL RESOLUTION VERIFICATION
// =========================================================================

test("Filesystem Audit: Every canonical PAGE_PATH physically exists on disk", () => {
  for (const [key, relPath] of Object.entries(PAGE_PATHS)) {
    const fullPath = path.resolve(relPath);
    assert.ok(
      fs.existsSync(fullPath),
      `Target file for key '${key}' (${relPath}) must exist on disk at ${fullPath}`
    );
  }
});

test("Canonicalization: Page keys and valid aliases map to correct extension paths", () => {
  assert.equal(getCanonicalRelativePath("dashboard"), "src/dashboard/dashboard.html");
  assert.equal(getCanonicalRelativePath("saved"), "src/saved/saved.html");
  assert.equal(getCanonicalRelativePath("brain"), "src/saved/saved.html");
  assert.equal(getCanonicalRelativePath("graph"), "src/graph/graph.html");
  assert.equal(getCanonicalRelativePath("options"), "src/options/options.html");

  // Path inputs
  assert.equal(getCanonicalRelativePath("src/graph/graph.html"), "src/graph/graph.html");
  assert.equal(getCanonicalRelativePath("/src/dashboard/dashboard.html"), "src/dashboard/dashboard.html");
  assert.equal(getCanonicalRelativePath("../saved/saved.html"), "src/saved/saved.html");
});

test("Strict Allowlist: Unknown or malformed page keys return empty string (reject)", () => {
  assert.equal(getCanonicalRelativePath("unknown_key"), "");
  assert.equal(getCanonicalRelativePath("src/graph/graph"), "");
  assert.equal(getCanonicalRelativePath("invalid.html"), "");
  assert.equal(getCanonicalRelativePath(""), "");
  assert.equal(getCanonicalRelativePath(null), "");
});

test("Canonicalization: Query parameters and hash fragments are stripped from identity", () => {
  assert.equal(
    normalizeExtensionPathname("src/dashboard/dashboard.html?topic=ai#top"),
    "src/dashboard/dashboard.html"
  );
  assert.equal(
    normalizeExtensionPathname("chrome-extension://feedrule-id/src/graph/graph.html?search=agent#section"),
    "src/graph/graph.html"
  );
  assert.equal(
    normalizeExtensionPathname("/src/saved/saved.html?filter=test"),
    "src/saved/saved.html"
  );
});

test("Canonical URL Generation: Produces exact chrome-extension:// URLs for all pages", () => {
  const { mock } = createMockChrome([]);
  globalThis.chrome = mock;
  globalThis.browser = undefined;

  assert.equal(
    getCanonicalExtensionUrl("graph"),
    "chrome-extension://feedrule-extension-id/src/graph/graph.html"
  );
  assert.equal(
    getCanonicalExtensionUrl("dashboard"),
    "chrome-extension://feedrule-extension-id/src/dashboard/dashboard.html"
  );
  assert.equal(
    getCanonicalExtensionUrl("saved"),
    "chrome-extension://feedrule-extension-id/src/saved/saved.html"
  );
  assert.equal(
    getCanonicalExtensionUrl("options"),
    "chrome-extension://feedrule-extension-id/src/options/options.html"
  );
  assert.equal(getCanonicalExtensionUrl("unknown"), "");
});

test("Firefox WebExtensions: Normalizes moz-extension:// URLs and reuses open tabs", async () => {
  const mozGraphTab = {
    id: 77,
    url: "moz-extension://b453982e-3367-4a47-8a8b-3fb1c19b02a9/src/graph/graph.html",
    active: false,
    windowId: 3,
  };

  const calls = { query: [], update: [], create: [] };
  const mockBrowser = {
    runtime: {
      getURL(p) {
        return `moz-extension://b453982e-3367-4a47-8a8b-3fb1c19b02a9/${p.replace(/^\//, "")}`;
      },
    },
    tabs: {
      async query(q) {
        calls.query.push(q);
        if (q.url === mozGraphTab.url) return [mozGraphTab];
        return [mozGraphTab];
      },
      async update(id, props) {
        calls.update.push({ id, props });
        return { ...mozGraphTab, ...props };
      },
      async create(props) {
        calls.create.push(props);
        return { id: 78, ...props };
      },
    },
    windows: {
      async update() {},
    },
  };

  const origBrowser = globalThis.browser;
  const origChrome = globalThis.chrome;

  try {
    globalThis.browser = mockBrowser;
    globalThis.chrome = undefined;

    assert.equal(
      normalizeExtensionPathname("moz-extension://b453982e-3367-4a47-8a8b-3fb1c19b02a9/src/graph/graph.html"),
      "src/graph/graph.html"
    );
    assert.equal(
      isInternalExtensionUrl("moz-extension://b453982e-3367-4a47-8a8b-3fb1c19b02a9/src/saved/saved.html"),
      true
    );

    const result = await openExtensionPage("graph");
    assert.equal(result.id, 77);
    assert.equal(calls.create.length, 0);
    assert.equal(calls.update.length, 1);
  } finally {
    globalThis.browser = origBrowser;
    globalThis.chrome = origChrome;
  }
});

test("External Isolation: isInternalExtensionUrl validates internal vs external URLs", () => {
  assert.equal(isInternalExtensionUrl("dashboard"), true);
  assert.equal(isInternalExtensionUrl("src/graph/graph.html"), true);
  assert.equal(isInternalExtensionUrl("chrome-extension://abc/src/saved/saved.html"), true);
  assert.equal(isInternalExtensionUrl("moz-extension://xyz/src/saved/saved.html"), true);

  // External URLs must return false
  assert.equal(isInternalExtensionUrl("https://www.linkedin.com/feed/"), false);
  assert.equal(isInternalExtensionUrl("https://www.linkedin.com/in/armindaraei/"), false);
  assert.equal(isInternalExtensionUrl("https://docs.anthropic.com"), false);
  assert.equal(isInternalExtensionUrl("https://github.com"), false);
});

// =========================================================================
// 2. EXISTING TAB REUSE & CURRENT-TAB OPTIMIZATION
// =========================================================================

test("Tab Reuse: Existing open tab is activated and its window focused without recreation", async () => {
  const existingGraphTab = {
    id: 42,
    url: "chrome-extension://feedrule-extension-id/src/graph/graph.html",
    active: false,
    windowId: 2,
  };
  const { mock, calls } = createMockChrome([existingGraphTab]);
  globalThis.chrome = mock;

  const result = await openExtensionPage("graph");

  assert.equal(result.id, 42);
  assert.equal(calls.create.length, 0); // No new tab created
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].tabId, 42);
  assert.equal(calls.update[0].updateProps.active, true);
  assert.equal(calls.windowsUpdate.length, 1);
  assert.equal(calls.windowsUpdate[0].windowId, 2);
  assert.equal(calls.windowsUpdate[0].updateProps.focused, true);
});

test("Current-Tab Optimization: Navigating to already-active page avoids redundant update() calls", async () => {
  const activeDashboardTab = {
    id: 10,
    url: "chrome-extension://feedrule-extension-id/src/dashboard/dashboard.html",
    active: true,
    windowId: 1,
  };
  const { mock, calls } = createMockChrome([activeDashboardTab]);
  globalThis.chrome = mock;

  const result = await openExtensionPage("dashboard");

  assert.equal(result.id, 10);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.update.length, 0); // Redundant tabs.update skipped
});

test("Tab Creation: Creates exactly 1 tab with verified URL when page is not open", async () => {
  const { mock, calls } = createMockChrome([]);
  globalThis.chrome = mock;

  const result = await openExtensionPage("saved");

  assert.ok(result);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].url, "chrome-extension://feedrule-extension-id/src/saved/saved.html");
});

// =========================================================================
// 3. RACE CONDITIONS & IN-FLIGHT MUTEX
// =========================================================================

test("Race Conditions: Concurrent clicks for the SAME page execute 1 creation", async () => {
  const { mock, calls } = createMockChrome([]);
  globalThis.chrome = mock;

  // Simulate two rapid clicks within milliseconds
  const [res1, res2] = await Promise.all([
    openExtensionPage("graph"),
    openExtensionPage("graph"),
  ]);

  assert.equal(calls.create.length, 1);
  assert.equal(res1.id, res2.id);
});

test("Race Conditions: Concurrent requests for DIFFERENT pages operate independently", async () => {
  const { mock, calls } = createMockChrome([]);
  globalThis.chrome = mock;

  const [resGraph, resDash] = await Promise.all([
    openExtensionPage("graph"),
    openExtensionPage("dashboard"),
  ]);

  assert.equal(calls.create.length, 2);
  assert.notEqual(resGraph.id, resDash.id);
  assert.match(resGraph.url, /graph\.html/);
  assert.match(resDash.url, /dashboard\.html/);
});

test("Stale Tab Recovery: If tab is closed mid-flight, falls back to create", async () => {
  const staleTab = {
    id: 999, // Will fail on update
    url: "chrome-extension://feedrule-extension-id/src/options/options.html",
    active: false,
    windowId: 1,
  };
  const { mock, calls, tabs } = createMockChrome([staleTab]);
  // Remove tab from store before update executes to simulate closure
  const originalUpdate = mock.tabs.update;
  mock.tabs.update = async (tabId, props) => {
    tabs.length = 0; // Tab was closed in browser
    return originalUpdate(tabId, props);
  };
  globalThis.chrome = mock;

  const result = await openExtensionPage("options");

  assert.ok(result);
  assert.notEqual(result.id, 999);
  assert.equal(calls.create.length, 1);
});

// =========================================================================
// 4. EXTERNAL URL ISOLATION
// =========================================================================

test("External Isolation: External URLs bypass singleton mechanism and open normally", async () => {
  const { mock, calls } = createMockChrome([]);
  globalThis.chrome = mock;

  const res = await openExtensionPage("https://www.linkedin.com/in/armindaraei");

  assert.ok(res);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].url, "https://www.linkedin.com/in/armindaraei");
  assert.equal(calls.query.length, 0); // Did not query internal tabs
});

// =========================================================================
// 5. SINGLETON MULTI-PAGE SESSION SEQUENCES
// =========================================================================

test("Singleton Sequence: Dashboard -> Graph -> Dashboard leaves exactly 2 tabs open", async () => {
  const { mock, tabs } = createMockChrome([]);
  globalThis.chrome = mock;

  // 1. Open Dashboard
  const t1 = await openExtensionPage("dashboard");
  assert.equal(tabs.length, 1);

  // 2. Open Graph (deactivates Dashboard in browser)
  t1.active = false;
  const t2 = await openExtensionPage("graph");
  assert.equal(tabs.length, 2);

  // 3. Return to Dashboard (deactivates Graph)
  t2.active = false;
  const t3 = await openExtensionPage("dashboard");

  assert.equal(tabs.length, 2); // Still exactly 2 tabs
  assert.equal(t3.id, t1.id);
  assert.equal(t3.active, true);
});

test("Singleton Sequence: Dashboard -> Graph -> Saved -> Graph -> Saved leaves exactly 3 tabs open", async () => {
  const { mock, tabs } = createMockChrome([]);
  globalThis.chrome = mock;

  // Step 1: Open Dashboard
  const tDash = await openExtensionPage("dashboard");
  assert.equal(tabs.length, 1);

  // Step 2: Open Graph
  tDash.active = false;
  const tGraph = await openExtensionPage("graph");
  assert.equal(tabs.length, 2);

  // Step 3: Open Saved
  tGraph.active = false;
  const tSaved = await openExtensionPage("saved");
  assert.equal(tabs.length, 3);

  // Step 4: Re-open Graph
  tSaved.active = false;
  const tGraph2 = await openExtensionPage("graph");
  assert.equal(tabs.length, 3);
  assert.equal(tGraph2.id, tGraph.id);
  assert.equal(tGraph2.active, true);

  // Step 5: Re-open Saved
  tGraph.active = false;
  const tSaved2 = await openExtensionPage("saved");
  assert.equal(tabs.length, 3);
  assert.equal(tSaved2.id, tSaved.id);
  assert.equal(tSaved2.active, true);
});

// =========================================================================
// 6. DOM & CODEBASE CONTRACT AUDIT
// =========================================================================

test("DOM Contract: Internal navigation controls in HTML files are button elements without native hrefs", () => {
  const htmlFiles = [
    path.resolve("src/dashboard/dashboard.html"),
    path.resolve("src/graph/graph.html"),
    path.resolve("src/saved/saved.html"),
  ];

  for (const file of htmlFiles) {
    const content = fs.readFileSync(file, "utf-8");
    // Ensure no <a ... href="/src/...html"> or <a ... href="src/...html"> exists for internal nav
    assert.ok(
      !/<a\s+[^>]*href=["'][^"']*\.html["'][^>]*id=["']open(Graph|Brain|Dashboard)Btn["']/i.test(content),
      `File ${file} must NOT contain anchor tags with native href pointing to HTML pages for internal navigation`
    );

    // Verify button tags are used for the main nav IDs
    const navBtnMatches = content.match(/<button\s+[^>]*id=["']open(Graph|Brain|Dashboard)Btn["']/gi) || [];
    assert.ok(
      navBtnMatches.length >= 1,
      `File ${file} must contain <button> elements for internal navigation`
    );
  }
});

test("Codebase Contract: UI controllers do NOT call chrome.tabs.create directly for internal pages", () => {
  const controllerFiles = [
    path.resolve("src/dashboard/dashboard.js"),
    path.resolve("src/graph/graph.js"),
    path.resolve("src/saved/saved.js"),
    path.resolve("src/popup/popup.js"),
  ];

  for (const file of controllerFiles) {
    const content = fs.readFileSync(file, "utf-8");
    // Verify no direct chrome.tabs.create({ url: ... .html }) calls exist
    assert.ok(
      !/chrome\.tabs\.create\s*\(\s*{\s*url:\s*chrome\.runtime\.getURL/i.test(content),
      `File ${file} must use openExtensionPage() instead of direct chrome.tabs.create()`
    );
  }
});

test("Tab Reuse with pendingUrl: Reuses tab when tab is in pendingUrl state", async () => {
  const loadingGraphTab = {
    id: 88,
    url: "",
    pendingUrl: "chrome-extension://feedrule-extension-id/src/graph/graph.html",
    active: false,
    windowId: 1,
  };
  const { mock, calls } = createMockChrome([loadingGraphTab]);
  globalThis.chrome = mock;

  const result = await openExtensionPage("graph");

  assert.equal(result.id, 88);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].tabId, 88);
});
