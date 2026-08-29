// src/llm/gemini-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";
import { resolveProviderEndpoint } from "./url-helper.js";

const REQUEST_TIMEOUT_MS = 15000;

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      id: { type: "STRING" },
      hide: { type: "BOOLEAN" },
      reason: { type: "STRING" },
      topics: {
        type: "ARRAY",
        items: { type: "STRING" },
      },
    },
    required: ["id", "hide"],
  },
};

export async function executeHttpAttempt({
  apiKey = "",
  model = "gemini-3.5-flash",
  baseUrl = "",
  rulesText = "",
  posts = [],
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const startTs = Date.now();
  const prompt = buildClassificationPrompt(rulesText, posts);
  const m = model || "gemini-3.5-flash";
  const endpoint = resolveProviderEndpoint("gemini", baseUrl, m);

  let endpointHost = "generativelanguage.googleapis.com";
  try {
    endpointHost = new URL(endpoint).host;
  } catch {}

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey && apiKey.trim()) {
    headers["x-goog-api-key"] = apiKey.trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout after 15s")), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    const latencyMs = Math.max(1, Date.now() - startTs);

    if (!res.ok) {
      const rawErrorText = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        latencyMs,
        endpointHost,
        rawErrorText,
      };
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const results = parseClassificationResponse(text, posts);

    return {
      ok: true,
      status: res.status,
      latencyMs,
      endpointHost,
      results,
    };
  } catch (err) {
    const latencyMs = Math.max(1, Date.now() - startTs);
    return {
      ok: false,
      status: 0,
      latencyMs,
      endpointHost,
      error: err,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function classifyBatch(params) {
  const attempt = await executeHttpAttempt(params);
  if (!attempt.ok) {
    if (attempt.error) throw attempt.error;
    throw new Error(`Gemini API error ${attempt.status}: ${attempt.rawErrorText || ""}`);
  }
  return attempt.results;
}
