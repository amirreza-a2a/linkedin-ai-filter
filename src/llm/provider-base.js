// src/llm/provider-base.js
// Every provider takes a batch of posts + the user's plain-English rules
// and must return an array of { id, hide, reason } in the same order.
//
// Contract:
//   classifyBatch({ apiKey, model, rulesText, posts }) -> Promise<Array<{id, hide, reason}>>
//
// posts: [{ id: string, text: string }]

export function buildClassificationPrompt(rulesText, posts) {
  return `You are filtering a LinkedIn feed for one user, based on their own rules.

USER RULES (plain English, may describe what to hide and/or what to keep):
"""
${rulesText || "(no rules set — keep everything)"}
"""

For each post below, decide "hide": true if it matches something the user wants hidden,
or "hide": false otherwise. Keep "reason" under 8 words. If rules are empty, hide nothing.

Return ONLY a JSON array, no prose, no markdown fences, in this exact shape:
[{"id":"<post id>","hide":true,"reason":"short reason"}, ...]

POSTS:
${posts.map((p) => `id: ${p.id}\ntext: ${p.text.slice(0, 1200)}`).join("\n---\n")}`;
}

export function parseClassificationResponse(rawText, posts) {
  let cleaned = rawText.trim();
  // Strip accidental markdown fences
  cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Fail open: if we can't parse, show everything rather than hide everything
    return posts.map((p) => ({ id: p.id, hide: false, reason: "parse-error-fail-open" }));
  }
  const byId = new Map(parsed.map((r) => [String(r.id), r]));
  return posts.map((p) => {
    const r = byId.get(String(p.id));
    return r
      ? { id: p.id, hide: !!r.hide, reason: r.reason || "" }
      : { id: p.id, hide: false, reason: "missing-fail-open" };
  });
}
