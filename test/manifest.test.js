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

  // Verify 'scripting' permission was removed
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.ok(!manifest.permissions.includes("scripting"));

  // Verify content_scripts matches both www and apex domain
  assert.ok(Array.isArray(manifest.content_scripts));
  assert.equal(manifest.content_scripts.length, 1);
  const matches = manifest.content_scripts[0].matches;
  assert.ok(matches.includes("https://www.linkedin.com/*"));
  assert.ok(matches.includes("https://linkedin.com/*"));

  // Verify background service worker configuration
  assert.equal(manifest.background.service_worker, "src/background/service-worker.js");
  assert.equal(manifest.background.type, "module");

  // Verify web_accessible_resources configuration for content modules
  assert.ok(Array.isArray(manifest.web_accessible_resources));
  assert.ok(manifest.web_accessible_resources.length >= 1);
});
