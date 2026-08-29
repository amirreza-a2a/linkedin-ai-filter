import test from "node:test";
import assert from "node:assert/strict";
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
// 1. CANONICALIZATION & PATH NORMALIZATION
// =========================================================================

test("Canonicalization: Page keys map to correct relative extension paths", () => {
  assert.equal(getCanonicalRelativePath("dashboard"), "src/dashboard/dashboard.html");
  assert.equal(getCanonicalRelativePath("saved"), "src/saved/saved.html");
  assert.equal(getCanonicalRelativePath("brain"), "src/saved/saved.html");
  assert.equal(getCanonicalRelativePath("graph"), "src/graph/graph.html");
  assert.equal(getCanonicalRelativePath("options"), "src/options/options.html");
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

test("External Isolation: isInternalExtensionUrl validates internal vs external URLs", () => {
  assert.equal(isInternalExtensionUrl("dashboard"), true);
  assert.equal(isInternalExtensionUrl("src/graph/graph.html"), true);
  assert.equal(isInternalExtensionUrl("chrome-extension://abc/src/saved/saved.html"), true);

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

test("Tab Creation: Creates exactly 1 tab when page is not open", async () => {
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
