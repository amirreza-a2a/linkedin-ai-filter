// src/llm/claude-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";
import { resolveProviderEndpoint } from "./url-helper.js";

const REQUEST_TIMEOUT_MS = 15000;

export async function executeHttpAttempt({
  apiKey = "",
  model = "claude-haiku-4-5-20251001",
  baseUrl = "",
  rulesText = "",
  posts = [],
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const startTs = Date.now();
  const prompt = buildClassificationPrompt(rulesText, posts);
  const endpoint = resolveProviderEndpoint("claude", baseUrl, model);

  let endpointHost = "api.anthropic.com";
  try {
    endpointHost = new URL(endpoint).host;
  } catch {}

  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    // Required for calling api.anthropic.com directly from a browser/extension context
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (apiKey && apiKey.trim()) {
    headers["x-api-key"] = apiKey.trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout after 15s")), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model || "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
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
    const text = data.content?.find((b) => b.type === "text")?.text || "[]";
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
    throw new Error(`Claude API error ${attempt.status}: ${attempt.rawErrorText || ""}`);
  }
  return attempt.results;
}
