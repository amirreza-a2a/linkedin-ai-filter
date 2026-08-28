import test from "node:test";
import assert from "node:assert/strict";
import { parseSaveRules, evaluateSaveRules } from "../src/rules/save-rule-engine.js";

test("parseSaveRules - parses comma, newline, and bullet-separated topics", () => {
  const input = `
    - AI
    * 5G
    • Embedded Systems
    Semiconductors, LDPC; Quantum
  `;
  const parsed = parseSaveRules(input);
  assert.deepEqual(parsed, ["AI", "5G", "Embedded Systems", "Semiconductors", "LDPC", "Quantum"]);
});

test("evaluateSaveRules - exact topic match (case-insensitive)", () => {
  const postTopics = ["AI", "Wireless"];
  const rules = "ai, 5G";
  const result = evaluateSaveRules(postTopics, rules);

  assert.equal(result.shouldSave, true);
  assert.equal(result.saveReason, "Matched topic: AI");
  assert.deepEqual(result.matchedTopics, ["AI"]);
});

test("evaluateSaveRules - multiple topic matches", () => {
  const postTopics = ["5G", "Wireless", "Embedded Systems"];
  const rules = "5g, Embedded Systems, AI";
  const result = evaluateSaveRules(postTopics, rules);

  assert.equal(result.shouldSave, true);
  assert.equal(result.saveReason, "Matched topic: 5G, Embedded Systems");
  assert.deepEqual(result.matchedTopics, ["5G", "Embedded Systems"]);
});

test("evaluateSaveRules - non-match on substring differences (strictly exact match)", () => {
  const postTopics = ["Machine Learning Models"];
  const rules = "Machine Learning";
  const result = evaluateSaveRules(postTopics, rules);

  assert.equal(result.shouldSave, false);
  assert.equal(result.saveReason, "");
  assert.deepEqual(result.matchedTopics, []);
});

test("evaluateSaveRules - handles empty, null, or non-matching inputs", () => {
  assert.equal(evaluateSaveRules([], "AI").shouldSave, false);
  assert.equal(evaluateSaveRules(null, "AI").shouldSave, false);
  assert.equal(evaluateSaveRules(["AI"], "").shouldSave, false);
  assert.equal(evaluateSaveRules(["AI"], null).shouldSave, false);
  assert.equal(evaluateSaveRules(["Crypto"], "AI, 5G").shouldSave, false);
});
