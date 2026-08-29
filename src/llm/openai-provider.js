// src/llm/openai-provider.js
import { buildClassificationPrompt, parseClassificationResponse } from "./provider-base.js";
import { resolveProviderEndpoint } from "./url-helper.js";

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Executes exactly ONE HTTP attempt against the OpenAI (or compatible) endpoint.
 *
 * @param {Object} params
 * @param {string} [params.apiKey]
 * @param {string} [params.model]
 * @param {string} [params.baseUrl]
 * @param {string} params.rulesText
 * @param {Array} params.posts
 * @param {number} [params.timeoutMs=15000]
 * @returns {Promise<{ ok: boolean, status: number, latencyMs: number, endpointHost: string, results?: Array, rawErrorText?: string, error?: Error }>}
 */
export async function executeHttpAttempt({
  apiKey = "",
  model = "gpt-4o-mini",
  baseUrl = "",
  rulesText = "",
  posts = [],
  timeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const startTs = Date.now();
  const prompt = buildClassificationPrompt(rulesText, posts);
  const endpoint = resolveProviderEndpoint("openai", baseUrl, model);

  let endpointHost = "api.openai.com";
  try {
    endpointHost = new URL(endpoint).host;
  } catch {}

  const headers = {
    "Content-Type": "application/json",
  };
  if (apiKey && apiKey.trim()) {
    headers["Authorization"] = `Bearer ${apiKey.trim()}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error("Request timeout after 15s")), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
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
    const text = data.choices?.[0]?.message?.content || "[]";
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
    throw new Error(`OpenAI API error ${attempt.status}: ${attempt.rawErrorText || ""}`);
  }
  return attempt.results;
}
