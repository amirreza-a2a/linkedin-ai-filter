import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PAGE_PATHS, getCanonicalRelativePath, getCanonicalExtensionUrl } from "../src/navigation/navigation.js";

test("Contract Audit: Every HTML page references physically existing ES module scripts", () => {
  const pages = [
    { html: "src/dashboard/dashboard.html", js: "src/dashboard/dashboard.js" },
    { html: "src/saved/saved.html", js: "src/saved/saved.js" },
    { html: "src/graph/graph.html", js: "src/graph/graph.js" },
    { html: "src/options/options.html", js: "src/options/options.js" },
    { html: "src/popup/popup.html", js: "src/popup/popup.js" },
  ];

  for (const page of pages) {
    const htmlPath = path.resolve(page.html);
    const jsPath = path.resolve(page.js);

    assert.ok(fs.existsSync(htmlPath), `HTML file ${page.html} must exist`);
    assert.ok(fs.existsSync(jsPath), `JS file ${page.js} must exist`);

    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    const jsBasename = path.basename(page.js);
    assert.ok(
      htmlContent.includes(`src="${jsBasename}"`) || htmlContent.includes(`src="./${jsBasename}"`),
      `${page.html} must reference ${jsBasename}`
    );
  }
});

test("Contract Audit: Dashboard JS required DOM element IDs exist in dashboard.html", () => {
  const html = fs.readFileSync(path.resolve("src/dashboard/dashboard.html"), "utf-8");
  const requiredIds = [
    "statsGrid",
    "trendChartContainer",
    "topicChartContainer",
    "topicRows",
    "topicEmptyState",
    "decisionRows",
    "decisionEmptyState",
    "dateRangeSelect",
    "statusSelect",
    "topicSelect",
    "providerSelect",
    "searchInput",
    "clearBtn",
    "openBrainBtn",
    "openGraphBtn",
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `dashboard.html must contain id="${id}"`);
  }
});

test("Contract Audit: Second Brain JS required DOM element IDs exist in saved.html", () => {
  const html = fs.readFileSync(path.resolve("src/saved/saved.html"), "utf-8");
  const requiredIds = [
    "searchInput",
    "topicSelect",
    "statsBar",
    "postsList",
    "exportMdBtn",
    "exportJsonBtn",
    "openGraphBtn",
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `saved.html must contain id="${id}"`);
  }
});

test("Contract Audit: Options JS required DOM element IDs exist in options.html", () => {
  const html = fs.readFileSync(path.resolve("src/options/options.html"), "utf-8");
  const requiredIds = [
    "provider",
    "openaiKey",
    "openaiModel",
    "openaiBaseUrl",
    "geminiKey",
    "geminiModel",
    "geminiBaseUrl",
    "claudeKey",
    "claudeModel",
    "claudeBaseUrl",
    "dailyCap",
    "status",
    "dataStatus",
    "clearSavedBtn",
    "clearLogBtn",
    "clearCacheBtn",
    "clearAllBtn",
    "save",
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `options.html must contain id="${id}"`);
  }
});

test("Contract Audit: Popup JS required DOM element IDs exist in popup.html", () => {
  const html = fs.readFileSync(path.resolve("src/popup/popup.html"), "utf-8");
  const requiredIds = [
    "rules",
    "saveRules",
    "enabledToggle",
    "status",
    "save",
    "openGraph",
    "openSaved",
    "openDashboard",
    "openOptions",
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `popup.html must contain id="${id}"`);
  }
});

test("Contract Audit: Singleton navigation targets exist on disk and map to valid URLs", () => {
  for (const key of Object.keys(PAGE_PATHS)) {
    const relPath = getCanonicalRelativePath(key);
    assert.ok(relPath, `Key ${key} must have canonical relative path`);
    assert.ok(fs.existsSync(path.resolve(relPath)), `File for ${key} at ${relPath} must exist on disk`);

    const extUrl = getCanonicalExtensionUrl(key);
    assert.ok(extUrl.startsWith("chrome-extension://"), `Key ${key} must produce valid extension URL`);
  }
});
