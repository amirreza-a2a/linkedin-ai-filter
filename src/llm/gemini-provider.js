// src/llm/gemini-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";

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

export async function classifyBatch({ apiKey, model, rulesText, posts }) {
  const prompt = buildClassificationPrompt(rulesText, posts);
  const m = model || "gemini-3.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  return parseClassificationResponse(text, posts);
}
