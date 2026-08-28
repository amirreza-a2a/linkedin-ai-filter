// src/llm/gemini-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";
import { resolveProviderEndpoint } from "./url-helper.js";

// Uses the stable generateContent endpoint (single-shot classification doesn't
// need the newer stateful Interactions API). See:
// https://ai.google.dev/gemini-api/docs/generate-content/get-started

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      hide: { type: "BOOLEAN" },
      reason: { type: "STRING" },
    },
    required: ["id", "hide"],
  },
};

export async function classifyBatch({ apiKey, model, baseUrl, rulesText, posts }) {
  const prompt = buildClassificationPrompt(rulesText, posts);
  const m = model || "gemini-3.5-flash";
  const endpoint = resolveProviderEndpoint("gemini", baseUrl, m);

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey && apiKey.trim()) {
    headers["x-goog-api-key"] = apiKey.trim();
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  return parseClassificationResponse(text, posts);
}
