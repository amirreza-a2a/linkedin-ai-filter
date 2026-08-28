// src/rules/save-rule-engine.js
import { normalizeTopics } from "../llm/provider-base.js";

/**
 * Parses user-defined save rules into a list of normalized target topics.
 * Accepts newlines, commas, semicolons, and bullet markers (- * •).
 *
 * @param {string|string[]} rulesInput
 * @returns {string[]} Normalized list of target topics
 */
export function parseSaveRules(rulesInput) {
  if (!rulesInput) return [];
  const lines = Array.isArray(rulesInput)
    ? rulesInput
    : String(rulesInput).split(/[\n,;]+/);

  const rawList = lines
    .map((line) => String(line).replace(/^[\s*•\-–—]+/, "").trim())
    .filter(Boolean);

  return normalizeTopics(rawList, Infinity);
}

/**
 * Evaluates whether a post's normalized topics match any configured save rules.
 * Uses exact, case-insensitive topic matching (no substring or fuzzy matching).
 *
 * @param {string[]} postTopics - Normalized topics assigned to the post
 * @param {string|string[]} saveRulesInput - User's configured save rules
 * @returns {{ shouldSave: boolean, saveReason: string, matchedTopics: string[] }}
 */
export function evaluateSaveRules(postTopics, saveRulesInput) {
  if (!Array.isArray(postTopics) || postTopics.length === 0) {
    return { shouldSave: false, saveReason: "", matchedTopics: [] };
  }

  const targetTopics = parseSaveRules(saveRulesInput);
  if (targetTopics.length === 0) {
    return { shouldSave: false, saveReason: "", matchedTopics: [] };
  }

  const postTopicMap = new Map();
  for (const topic of postTopics) {
    if (typeof topic === "string" && topic.trim()) {
      postTopicMap.set(topic.trim().toLowerCase(), topic.trim());
    }
  }

  const matched = [];
  for (const target of targetTopics) {
    const targetLower = target.toLowerCase();
    const originalPostTopic = postTopicMap.get(targetLower);
    if (originalPostTopic && !matched.includes(originalPostTopic)) {
      matched.push(originalPostTopic);
    }
  }

  if (matched.length > 0) {
    return {
      shouldSave: true,
      saveReason: `Matched topic: ${matched.join(", ")}`,
      matchedTopics: matched,
    };
  }

  return { shouldSave: false, saveReason: "", matchedTopics: [] };
}
