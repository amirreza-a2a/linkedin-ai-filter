import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("manifest.json - Valid Manifest V3 with minimal required permissions", () => {
  const manifestPath = path.resolve("manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf-8");
  const manifest = JSON.parse(raw);

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "FeedRule — Custom AI Filter for LinkedIn");

  // Verify minimal required permissions: storage and tabs
  assert.deepEqual(manifest.permissions, ["storage", "tabs"]);
  assert.ok(!manifest.permissions.includes("scripting"));

  // Verify content_scripts configuration
  assert.ok(Array.isArray(manifest.content_scripts));
  assert.equal(manifest.content_scripts.length, 1);
  const contentScript = manifest.content_scripts[0];
  const matches = contentScript.matches;
  assert.ok(matches.includes("https://www.linkedin.com/*"));
  assert.ok(matches.includes("https://linkedin.com/*"));
  assert.deepEqual(contentScript.js, ["src/content/content-bundle.js"]);

  // Verify production content script bundle exists on disk
  const bundlePath = path.resolve(contentScript.js[0]);
  assert.ok(fs.existsSync(bundlePath), `Content script bundle at ${bundlePath} must exist on disk`);

  const bundleContent = fs.readFileSync(bundlePath, "utf-8");
  // Invariant: No fragile dynamic import or top-level import/export
  assert.ok(!bundleContent.includes("content-loader.js"));
  assert.ok(!bundleContent.includes("Failed to fetch dynamically imported module"));
  assert.ok(!/^import\s+/m.test(bundleContent), "Content script bundle must not contain top-level imports");
  assert.ok(!/^export\s+/m.test(bundleContent), "Content script bundle must not contain top-level exports");

  // Invariant: Contains core pipeline symbols
  assert.ok(bundleContent.includes("isLikelyPostContainer"));
  assert.ok(bundleContent.includes("extractAuthor"));
  assert.ok(bundleContent.includes("sanitizeUrl"));
  assert.ok(bundleContent.includes("extractPost"));
  assert.ok(bundleContent.includes("findContainers"));
  assert.ok(bundleContent.includes("MutationObserver"));

  // Verify background service worker configuration
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
  assert.equal(manifest.background.type, "module");
});
