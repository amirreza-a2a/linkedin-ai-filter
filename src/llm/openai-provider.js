// src/llm/openai-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";

export async function classifyBatch({ apiKey, model, rulesText, posts }) {
  const prompt = buildClassificationPrompt(rulesText, posts);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "[]";
  return parseClassificationResponse(text, posts);
}
