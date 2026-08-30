// test/firefox-manifest.test.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const CHROME_MANIFEST_PATH = path.resolve("manifest.chrome.json");
const FIREFOX_MANIFEST_PATH = path.resolve("manifest.firefox.json");

test("Manifest Audit: Both manifest.chrome.json and manifest.firefox.json exist and are valid JSON", () => {
  assert.ok(fs.existsSync(CHROME_MANIFEST_PATH), "manifest.chrome.json must exist");
  assert.ok(fs.existsSync(FIREFOX_MANIFEST_PATH), "manifest.firefox.json must exist");

  const chromeManifest = JSON.parse(fs.readFileSync(CHROME_MANIFEST_PATH, "utf-8"));
  const firefoxManifest = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST_PATH, "utf-8"));

  assert.equal(chromeManifest.manifest_version, 3);
  assert.equal(firefoxManifest.manifest_version, 3);
  assert.equal(chromeManifest.version, firefoxManifest.version);
  assert.equal(chromeManifest.name, firefoxManifest.name);
});

test("Firefox Manifest: Contains required browser_specific_settings.gecko.id", () => {
  const firefoxManifest = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST_PATH, "utf-8"));

  assert.ok(
    firefoxManifest.browser_specific_settings,
    "Firefox manifest must define browser_specific_settings"
  );
  assert.ok(
    firefoxManifest.browser_specific_settings.gecko,
    "Firefox manifest must define browser_specific_settings.gecko"
  );
  assert.equal(
    firefoxManifest.browser_specific_settings.gecko.id,
    "feedrule@amirreza.dev",
    "Gecko extension ID must be feedrule@amirreza.dev"
  );
  assert.equal(
    firefoxManifest.browser_specific_settings.gecko.strict_min_version,
    "115.0",
    "Gecko strict_min_version must be at least 115.0"
  );
});

test("Background Architecture Invariant: Chrome uses service_worker, Firefox uses background.scripts", () => {
  const chromeManifest = JSON.parse(fs.readFileSync(CHROME_MANIFEST_PATH, "utf-8"));
  const firefoxManifest = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST_PATH, "utf-8"));

  // Chrome MV3 background service worker
  assert.equal(chromeManifest.background.service_worker, "src/background/service-worker.js");
  assert.equal(chromeManifest.background.type, "module");

  // Firefox MV3 background script
  assert.deepEqual(firefoxManifest.background.scripts, ["src/background/service-worker.js"]);
  assert.equal(firefoxManifest.background.type, "module");
});

test("Options UI Invariant: Both manifests configure options_ui open_in_tab = true", () => {
  const chromeManifest = JSON.parse(fs.readFileSync(CHROME_MANIFEST_PATH, "utf-8"));
  const firefoxManifest = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST_PATH, "utf-8"));

  assert.equal(chromeManifest.options_ui.page, "src/options/options.html");
  assert.equal(chromeManifest.options_ui.open_in_tab, true);

  assert.equal(firefoxManifest.options_ui.page, "src/options/options.html");
  assert.equal(firefoxManifest.options_ui.open_in_tab, true);
});

test("Permissions & Host Permissions Parity: Both manifests declare identical security grants", () => {
  const chromeManifest = JSON.parse(fs.readFileSync(CHROME_MANIFEST_PATH, "utf-8"));
  const firefoxManifest = JSON.parse(fs.readFileSync(FIREFOX_MANIFEST_PATH, "utf-8"));

  assert.deepEqual(chromeManifest.permissions, firefoxManifest.permissions);
  assert.deepEqual(chromeManifest.host_permissions, firefoxManifest.host_permissions);
  assert.deepEqual(chromeManifest.optional_host_permissions, firefoxManifest.optional_host_permissions);
  assert.deepEqual(chromeManifest.content_scripts, firefoxManifest.content_scripts);
});
