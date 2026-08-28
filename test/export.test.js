import test from "node:test";
import assert from "node:assert/strict";
import { exportToMarkdown, exportToJson, sanitizeTag } from "../src/export/export-helper.js";

test("sanitizeTag - sanitizes topics into valid Obsidian hashtags", () => {
  assert.equal(sanitizeTag("AI"), "AI");
  assert.equal(sanitizeTag("Embedded Systems"), "Embedded_Systems");
  assert.equal(sanitizeTag("C++"), "Cpp");
  assert.equal(sanitizeTag("AI / ML"), "AI_ML");
  assert.equal(sanitizeTag("#Hash#Tag"), "HashTag");
  assert.equal(sanitizeTag("Special: [Quotes] & 'Symbols'"), "Special_Quotes_Symbols");
  assert.equal(sanitizeTag(""), "");
  assert.equal(sanitizeTag(null), "");
});

test("exportToMarkdown - formats Obsidian-compatible document with multiline content", () => {
  const posts = [
    {
      id: "p1",
      text: "First line of post\nSecond line with special characters: #tag, [link], \"quotes\"\n---\nEmbedded delimiter",
      author: "Grace Hopper",
      authorUrl: "https://linkedin.com/in/grace",
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:100",
      topics: ["Computer Science", "Compilers", "C++"],
      savedAt: 1700000000000,
      saveReason: "Matched topic: Compilers",
      autoSaved: true,
    },
  ];

  const md = exportToMarkdown(posts);
  assert.ok(md.includes("# LinkedIn Second Brain — Saved Posts"));
  assert.ok(md.includes("Total Posts: 1"));
  assert.ok(md.includes("[Grace Hopper](https://linkedin.com/in/grace)"));
  assert.ok(md.includes("#Computer_Science #Compilers #Cpp"));
  assert.ok(md.includes("First line of post"));
  assert.ok(md.includes("Second line with special characters"));
});

test("exportToJson - returns valid JSON string", () => {
  const posts = [
    {
      id: "p1",
      text: "Hello JSON",
      topics: ["AI"],
      savedAt: 1000,
      updatedAt: 1000,
      autoSaved: false,
      saveReason: "Manual save",
    },
  ];

  const jsonStr = exportToJson(posts);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "p1");
  assert.equal(parsed[0].text, "Hello JSON");
});

test("export - handles empty array safely", () => {
  const md = exportToMarkdown([]);
  assert.ok(md.includes("No posts saved yet."));

  const jsonStr = exportToJson([]);
  assert.equal(jsonStr, "[]");
});
