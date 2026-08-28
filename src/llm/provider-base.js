// src/llm/provider-base.js
// Every provider takes a batch of posts + the user's plain-English rules
// and must return an array of { id, hide, reason } in the same order.
//
// Contract:
//   classifyBatch({ apiKey, model, baseUrl, rulesText, posts }) -> Promise<Array<{id, hide, reason}>>
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
  if (!rawText) {
    return posts.map((p) => ({ id: p.id, hide: false, reason: "empty-response-fail-open" }));
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
    return posts.map((p) => ({ id: p.id, hide: false, reason: "parse-error-fail-open" }));
  }

  if (!Array.isArray(parsed)) {
    if (parsed && Array.isArray(parsed.posts)) {
      parsed = parsed.posts;
    } else if (parsed && Array.isArray(parsed.results)) {
      parsed = parsed.results;
    } else if (parsed && parsed.id != null) {
      parsed = [parsed];
    } else {
      return posts.map((p) => ({ id: p.id, hide: false, reason: "parse-error-fail-open" }));
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
      ? { id: p.id, hide: Boolean(r.hide), reason: r.reason || "" }
      : { id: p.id, hide: false, reason: "missing-fail-open" };
  });
}
