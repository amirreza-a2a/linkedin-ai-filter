// src/llm/provider-base.js
// Every provider takes a batch of posts + the user's plain-English rules
// and must return an array of { id, hide, reason, topics } in the same order.
//
// Contract:
//   classifyBatch({ apiKey, model, baseUrl, rulesText, posts }) -> Promise<Array<{id, hide, reason, topics}>>
//
// posts: [{ id: string, text: string }]

const MAX_TOPIC_LENGTH = 50;
const MAX_TOPICS_COUNT = 5;

/**
 * Normalizes an array of raw topics syntactically:
 * - Rejects non-array inputs -> []
 * - Discards non-string elements (does NOT convert numbers/booleans/objects to string)
 * - Trims whitespace and drops empty strings
 * - Caps each topic at 50 characters
 * - Deduplicates case-insensitively while preserving original casing of first appearance
 * - Caps total topics at 5 per post
 *
 * @param {any} rawTopics
 * @returns {string[]} Normalized topic array
 */
export function normalizeTopics(rawTopics) {
  if (!Array.isArray(rawTopics)) {
    return [];
  }

  const result = [];
  const seenLower = new Set();

  for (const item of rawTopics) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    const capped = trimmed.slice(0, MAX_TOPIC_LENGTH);
    const lower = capped.toLowerCase();

    if (!seenLower.has(lower)) {
      seenLower.add(lower);
      result.push(capped);
      if (result.length >= MAX_TOPICS_COUNT) {
        break;
      }
    }
  }

  return result;
}

export function buildClassificationPrompt(rulesText, posts) {
  return `You are filtering a LinkedIn feed for one user, based on their own rules.

USER RULES (plain English, may describe what to hide and/or what to keep):
"""
${rulesText || "(no rules set — keep everything)"}
"""

For each post below:
1. Decide "hide": true if it matches something the user wants hidden, or "hide": false otherwise.
2. Keep "reason" under 8 words. If rules are empty, hide nothing.
3. Extract "topics": Return 0 to 5 relevant topic tags describing the subject matter of the post.
   - Topics must describe the subject matter of the post, not its sentiment, usefulness, moderation decision, or classification reason.
   - Examples of valid topics: ["AI", "5G", "Embedded Systems", "Semiconductors", "Recruiting"].
   - Examples of invalid topics: ["Interesting", "Useful", "Spam", "Negative", "Low Quality"].
   - If no meaningful topic can be identified, return [].

Return ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"id":"<post id>","hide":false,"reason":"short reason","topics":["topic1","topic2"]}, ...]

POSTS:
${posts.map((p) => `id: ${p.id}\ntext: ${p.text.slice(0, 1200)}`).join("\n---\n")}`;
}

export function parseClassificationResponse(rawText, posts) {
  if (!rawText) {
    return posts.map((p) => ({ id: p.id, hide: false, reason: "empty-response-fail-open", topics: [] }));
  }

  let cleaned = String(rawText).trim();

  // Strip <think>...</think> reasoning blocks from DeepSeek-R1 / reasoning models
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Extract JSON array or object if surrounded by markdown or conversational prose
  const jsonArrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    cleaned = jsonArrayMatch[0];
  } else {
    const jsonObjectMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      cleaned = jsonObjectMatch[0];
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fail open: if we can't parse, show everything rather than hide everything
    return posts.map((p) => ({ id: p.id, hide: false, reason: "parse-error-fail-open", topics: [] }));
  }

  if (!Array.isArray(parsed)) {
    if (parsed && Array.isArray(parsed.posts)) {
      parsed = parsed.posts;
    } else if (parsed && Array.isArray(parsed.results)) {
      parsed = parsed.results;
    } else if (parsed && parsed.id != null) {
      parsed = [parsed];
    } else {
      return posts.map((p) => ({ id: p.id, hide: false, reason: "parse-error-fail-open", topics: [] }));
    }
  }

  const byId = new Map(
    parsed
      .filter((r) => r && r.id != null)
      .map((r) => [String(r.id), r])
  );

  return posts.map((p) => {
    const r = byId.get(String(p.id));
    return r
      ? {
          id: p.id,
          hide: r.hide === true,
          reason: typeof r.reason === "string" ? r.reason : "",
          topics: normalizeTopics(r.topics),
        }
      : { id: p.id, hide: false, reason: "missing-fail-open", topics: [] };
  });
}
