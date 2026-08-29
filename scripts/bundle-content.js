// scripts/bundle-content.js
// Compiles modular content script sources into a self-contained Chrome MV3 content script bundle.
// Avoids runtime dynamic imports which fail under strict CSP and extension origin isolation.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function bundle() {
  const loggerSrc = fs.readFileSync(path.join(rootDir, "src/utils/logger.js"), "utf-8");
  const qualifierSrc = fs.readFileSync(path.join(rootDir, "src/content/post-qualifier.js"), "utf-8");
  const extractorSrc = fs.readFileSync(path.join(rootDir, "src/content/author-extractor.js"), "utf-8");
  const storeSrc = fs.readFileSync(path.join(rootDir, "src/storage/saved-posts-store.js"), "utf-8");
  const debugOverlaySrc = fs.readFileSync(path.join(rootDir, "src/content/debug-overlay.js"), "utf-8");
  const indexSrc = fs.readFileSync(path.join(rootDir, "src/content/content-index.js"), "utf-8");

  // Extract sanitizeUrl from saved-posts-store.js
  const sanitizeUrlMatch = storeSrc.match(/export function sanitizeUrl\([\s\S]*?\n\}/);
  if (!sanitizeUrlMatch) {
    throw new Error("Failed to extract sanitizeUrl from saved-posts-store.js");
  }
  const sanitizeUrlCode = sanitizeUrlMatch[0].replace(/^export\s+/, "");

  // Strip imports and exports from post-qualifier.js
  const qualifierCode = qualifierSrc
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+(const|let|var|function)/gm, "$1");

  // Strip imports and exports from author-extractor.js
  const extractorCode = extractorSrc
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+(const|let|var|function)/gm, "$1");

  // Strip imports and exports from debug-overlay.js
  const debugOverlayCode = debugOverlaySrc
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+(const|let|var|function)/gm, "$1");

  // Strip imports and exports from logger.js
  const loggerCode = loggerSrc
    .replace(/^export\s+(const|let|var|function)/gm, "$1");

  // Strip imports and exports from content-index.js
  const indexCode = indexSrc
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+(const|let|var|function)/gm, "$1");

  const bundleContent = `// src/content/content-bundle.js
// AUTO-GENERATED BUNDLE FOR CHROME MV3 CONTENT SCRIPT EXECUTION
// Do not edit directly; modify source files in src/content/ and run \`node scripts/bundle-content.js\`.

(() => {
  "use strict";

  // --- 1. Logger Subsystem ---
  ${loggerCode.trim().split("\n").join("\n  ")}

  // --- 2. URL Sanitization Helper ---
  ${sanitizeUrlCode.trim().split("\n").join("\n  ")}

  // --- 3. Diagnostic Overlay Subsystem ---
  ${debugOverlayCode.trim().split("\n").join("\n  ")}

  // --- 4. Post Container Qualifier ---
  ${qualifierCode.trim().split("\n").join("\n  ")}

  // --- 5. Author Extractor ---
  ${extractorCode.trim().split("\n").join("\n  ")}

  // --- 6. Content Script Core Pipeline ---
  ${indexCode.trim().split("\n").join("\n  ")}
})();
`;

  const outputPath = path.join(rootDir, "src/content/content-bundle.js");
  fs.writeFileSync(outputPath, bundleContent, "utf-8");
  console.log(`[FeedRule] Successfully bundled content script to ${outputPath}`);
}

bundle();
