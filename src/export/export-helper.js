// src/export/export-helper.js
// Exports saved posts to Obsidian-compatible Markdown or structured JSON.

/**
 * Sanitizes a topic into a valid, safe Obsidian markdown hashtag.
 * e.g. "Embedded Systems" -> "Embedded_Systems", "C++" -> "Cpp", "AI/ML" -> "AIML"
 *
 * @param {string} topic
 * @returns {string} Safe hashtag token without '#' prefix
 */
export function sanitizeTag(topic) {
  if (!topic || typeof topic !== "string") return "";
  let clean = topic
    .replace(/\+/g, "p")
    .replace(/#/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return clean;
}

/**
 * Exports an array of SavedPost objects to Obsidian-compatible Markdown.
 *
 * @param {Object[]} posts
 * @returns {string} Markdown document
 */
export function exportToMarkdown(posts) {
  if (!Array.isArray(posts) || posts.length === 0) {
    return "# LinkedIn Second Brain — Saved Posts\n\nNo posts saved yet.\n";
  }

  const header = `# LinkedIn Second Brain — Saved Posts\nExported: ${new Date().toISOString()}\nTotal Posts: ${posts.length}\n\n---\n`;

  const body = posts
    .map((p, index) => {
      const dateStr = p.savedAt ? new Date(p.savedAt).toLocaleString() : "Unknown";
      const tags = (p.topics || [])
        .map(sanitizeTag)
        .filter(Boolean)
        .map((t) => `#${t}`)
        .join(" ");

      const authorDisplay = p.authorUrl
        ? `[${p.author || "LinkedIn Author"}](${p.authorUrl})`
        : p.author || "Unknown Author";

      const linkDisplay = p.postUrl
        ? `[View Original on LinkedIn](${p.postUrl})`
        : "N/A";

      return `## Post ${index + 1} — ${authorDisplay}

- **Saved Date**: ${dateStr}
- **Save Reason**: ${p.saveReason || "Manual save"}
- **Auto-saved**: ${p.autoSaved ? "Yes" : "No"}
- **Original Link**: ${linkDisplay}
- **Topics**: ${tags || "(none)"}

### Content

${p.text || "(empty post text)"}

---`;
    })
    .join("\n\n");

  return `${header}\n${body}\n`;
}

/**
 * Exports an array of SavedPost objects to formatted JSON.
 *
 * @param {Object[]} posts
 * @returns {string} JSON string
 */
export function exportToJson(posts) {
  const safeList = Array.isArray(posts) ? posts : [];
  return JSON.stringify(safeList, null, 2);
}
