// src/llm/claude-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";
import { resolveProviderEndpoint } from "./url-helper.js";

export async function classifyBatch({ apiKey, model, baseUrl, rulesText, posts }) {
  const prompt = buildClassificationPrompt(rulesText, posts);
  const endpoint = resolveProviderEndpoint("claude", baseUrl, model);

  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    // Required for calling api.anthropic.com directly from a browser/extension context
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (apiKey && apiKey.trim()) {
    headers["x-api-key"] = apiKey.trim();
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
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
