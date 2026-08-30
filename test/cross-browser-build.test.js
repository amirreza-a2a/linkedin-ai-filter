// test/cross-browser-build.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildAll } from "../scripts/build.js";

const DIST_CHROME = path.resolve("dist/chrome");
const DIST_FIREFOX = path.resolve("dist/firefox");

test("Build Pipeline: buildAll generates both dist/chrome and dist/firefox", () => {
  buildAll("all");

  assert.ok(fs.existsSync(DIST_CHROME), "dist/chrome directory must exist");
  assert.ok(fs.existsSync(DIST_FIREFOX), "dist/firefox directory must exist");

  const chromeManifestPath = path.join(DIST_CHROME, "manifest.json");
  const firefoxManifestPath = path.join(DIST_FIREFOX, "manifest.json");

  assert.ok(fs.existsSync(chromeManifestPath), "dist/chrome/manifest.json must exist");
  assert.ok(fs.existsSync(firefoxManifestPath), "dist/firefox/manifest.json must exist");

  const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestPath, "utf-8"));
  const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, "utf-8"));

  // Check Chrome-specific build artifacts
  assert.equal(chromeManifest.background.service_worker, "src/background/service-worker.js");
  assert.equal(chromeManifest.browser_specific_settings, undefined);

  // Check Firefox-specific build artifacts
  assert.deepEqual(firefoxManifest.background.scripts, ["src/background/service-worker.js"]);
  assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "feedrule@amirreza.dev");
});

test("Build Integrity: All required runtime files exist in both dist packages", () => {
  const targets = ["chrome", "firefox"];
  const requiredFiles = [
    "manifest.json",
    "icons/icon16.png",
    "icons/icon48.png",
    "icons/icon128.png",
    "src/background/service-worker.js",
    "src/content/content-bundle.js",
    "src/content/content.css",
    "src/popup/popup.html",
    "src/popup/popup.js",
    "src/options/options.html",
    "src/options/options.js",
    "src/dashboard/dashboard.html",
    "src/dashboard/dashboard.js",
    "src/saved/saved.html",
    "src/saved/saved.js",
    "src/graph/graph.html",
    "src/graph/graph.js",
    "src/utils/browser.js",
  ];

  for (const target of targets) {
    const baseDir = path.resolve("dist", target);
    for (const rel of requiredFiles) {
      const fullPath = path.join(baseDir, rel);
      assert.ok(
        fs.existsSync(fullPath),
        `dist/${target} package must contain ${rel} at ${fullPath}`
      );
    }
  }
});
