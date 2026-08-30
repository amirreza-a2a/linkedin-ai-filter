// scripts/build.js
// Multi-target distribution build pipeline for FeedRule (Chrome MV3 and Firefox MV3).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function buildTarget(target) {
  const distTargetDir = path.join(ROOT_DIR, "dist", target);

  // Clean target directory
  if (fs.existsSync(distTargetDir)) {
    fs.rmSync(distTargetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distTargetDir, { recursive: true });

  // 1. Copy target manifest
  const manifestSrc = path.join(ROOT_DIR, `manifest.${target}.json`);
  if (!fs.existsSync(manifestSrc)) {
    throw new Error(`Target manifest missing: ${manifestSrc}`);
  }
  fs.copyFileSync(manifestSrc, path.join(distTargetDir, "manifest.json"));

  // 2. Copy icons directory
  const iconsSrc = path.join(ROOT_DIR, "icons");
  if (fs.existsSync(iconsSrc)) {
    copyRecursiveSync(iconsSrc, path.join(distTargetDir, "icons"));
  }

  // 3. Copy src directory
  const srcDir = path.join(ROOT_DIR, "src");
  if (fs.existsSync(srcDir)) {
    copyRecursiveSync(srcDir, path.join(distTargetDir, "src"));
  }

  // Validate critical files
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

  for (const rel of requiredFiles) {
    const full = path.join(distTargetDir, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`Build verification failed for target "${target}": missing file ${rel}`);
    }
  }

  console.log(`[FeedRule] Successfully built ${target.toUpperCase()} extension package -> ${distTargetDir}`);
}

export function buildAll(targetArg = "all") {
  // Step 1: Always build content script bundle first
  const bundleScript = path.join(ROOT_DIR, "scripts", "bundle-content.js");
  execFileSync(process.execPath, [bundleScript], { stdio: "inherit" });

  const target = (targetArg || "all").toLowerCase().trim();

  if (target === "chrome") {
    buildTarget("chrome");
  } else if (target === "firefox") {
    buildTarget("firefox");
  } else if (target === "all") {
    buildTarget("chrome");
    buildTarget("firefox");
  } else {
    throw new Error(`Unknown build target: "${target}". Expected "chrome", "firefox", or "all".`);
  }
}

// Direct invocation CLI
if (process.argv[1] === __filename) {
  const target = process.argv[2] || "all";
  try {
    buildAll(target);
  } catch (err) {
    console.error("[FeedRule] Build error:", err.message);
    process.exit(1);
  }
}
