// src/llm/claude-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";

export async function classifyBatch({ apiKey, model, rulesText, posts }) {
  const prompt = buildClassificationPrompt(rulesText, posts);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for calling api.anthropic.com directly from a browser/extension context
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.content?.find((b) => b.type === "text")?.text || "[]";
  return parseClassificationResponse(text, posts);
}
