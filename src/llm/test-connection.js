// src/llm/test-connection.js
// Production-quality connection testing for OpenAI, Google Gemini, and Anthropic Claude.
// Performs minimal authenticated requests to verify endpoint reachability, model existence, and credential validity.

import { validateAndNormalizeBaseUrl, resolveProviderEndpoint, getRequiredOriginPattern } from "./url-helper.js";
import { logger } from "../utils/logger.js";
import { sanitizeErrorMessage } from "../utils/sanitizer.js";
import { appendApiLog } from "../storage/api-log-store.js";

export { sanitizeErrorMessage };

const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  gemini: "gemini-3.5-flash",
  claude: "claude-haiku-4-5-20251001",
};

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Normalizes HTTP status codes and response bodies into human-friendly error codes and messages.
 *
 * @param {number} status
 * @param {string} [errText]
 * @returns {{ errorCode: string, message: string }}
 */
export function normalizeTestError(status, errText = "") {
  let message = "";
  let errorCode = "UNKNOWN_ERROR";

  let parsedMsg = "";
  if (errText) {
    try {
      const data = JSON.parse(errText);
      parsedMsg = data.error?.message || data.message || (typeof data.error === "string" ? data.error : "");
      if (typeof parsedMsg === "object") parsedMsg = JSON.stringify(parsedMsg);
    } catch {
      parsedMsg = errText.slice(0, 150).trim();
    }
  }

  parsedMsg = sanitizeErrorMessage(parsedMsg);

  if (status === 400) {
    errorCode = "INVALID_REQUEST";
    message = parsedMsg ? `Invalid request: ${parsedMsg}` : "Invalid request or unsupported model/parameter";
  } else if (status === 401) {
    errorCode = "INVALID_API_KEY";
    message = "Invalid API key";
  } else if (status === 403) {
    errorCode = "PERMISSION_DENIED";
    message = parsedMsg ? `Permission denied: ${parsedMsg}` : "Access forbidden / invalid credentials";
  } else if (status === 404) {
    errorCode = "NOT_FOUND";
    message = "Model or endpoint not found (check model name or Base URL)";
  } else if (status === 409) {
    errorCode = "CONFLICT";
    message = parsedMsg ? `Conflict: ${parsedMsg}` : "Resource conflict with provider";
  } else if (status === 429) {
    errorCode = "RATE_LIMITED";
    message = parsedMsg && parsedMsg.toLowerCase().includes("quota")
      ? `Quota exceeded: ${parsedMsg}`
      : "Rate limit or quota exceeded";
  } else if (status >= 500 && status < 600) {
    errorCode = "SERVER_ERROR";
    message = `Provider temporarily unavailable (HTTP ${status})`;
  } else if (status) {
    errorCode = `HTTP_${status}`;
    message = parsedMsg ? `HTTP ${status}: ${parsedMsg}` : `HTTP error ${status}`;
  } else {
    errorCode = "NETWORK_ERROR";
    message = "Unable to reach provider endpoint";
  }

  return { errorCode, message: sanitizeErrorMessage(message) };
}

/**
 * Tests an unsaved or saved AI provider configuration by sending a minimal test request.
 *
 * @param {Object} params
 * @param {"openai"|"gemini"|"claude"} params.provider
 * @param {string} [params.apiKey]
 * @param {string} [params.model]
 * @param {string} [params.baseUrl]
 * @param {number} [params.timeoutMs]
 * @returns {Promise<Object>} Normalized result object
 */
export async function testProviderConnection({
  provider,
  apiKey = "",
  model = "",
  baseUrl = "",
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const startTs = typeof performance !== "undefined" ? performance.now() : Date.now();

  if (!provider || !["openai", "gemini", "claude"].includes(provider)) {
    return {
      ok: false,
      provider: provider || "unknown",
      errorCode: "INVALID_PROVIDER",
      message: `Unsupported provider: ${provider}`,
      latencyMs: 0,
    };
  }

  const cleanApiKey = (apiKey || "").trim();
  const cleanModel = (model || "").trim() || DEFAULT_MODELS[provider];
  let cleanBaseUrl = "";

  // 1. Validate Base URL
  try {
    cleanBaseUrl = validateAndNormalizeBaseUrl(baseUrl);
  } catch (urlErr) {
    return {
      ok: false,
      provider,
      errorCode: "INVALID_BASE_URL",
      message: urlErr.message || "Invalid Base URL",
      latencyMs: 0,
    };
  }

  // 2. Validate API Key requirement
  const isCustomOpenAi = provider === "openai" && Boolean(cleanBaseUrl);
  if (!cleanApiKey && !isCustomOpenAi) {
    return {
      ok: false,
      provider,
      errorCode: "MISSING_API_KEY",
      message: "API key is required",
      latencyMs: 0,
    };
  }

  // 3. Request runtime host permission if custom Base URL requires it
  if (cleanBaseUrl && typeof chrome !== "undefined" && chrome?.permissions?.contains && chrome?.permissions?.request) {
    const pattern = getRequiredOriginPattern(cleanBaseUrl);
    if (pattern) {
      try {
        const hasPerm = await chrome.permissions.contains({ origins: [pattern] });
        if (!hasPerm) {
          const granted = await chrome.permissions.request({ origins: [pattern] });
          if (!granted) {
            return {
              ok: false,
              provider,
              errorCode: "PERMISSION_DENIED",
              message: `Host permission denied for ${pattern}`,
              latencyMs: 0,
            };
          }
        }
      } catch (permErr) {
        logger.warn("TEST_CONN", "Host permission check error:", permErr);
      }
    }
  }

  // 4. Resolve Endpoint and construct minimal payload
  let endpoint = "";
  const headers = {
    "Content-Type": "application/json",
  };
  let body = "";

  try {
    endpoint = resolveProviderEndpoint(provider, cleanBaseUrl, cleanModel);
  } catch (epErr) {
    return {
      ok: false,
      provider,
      errorCode: "INVALID_ENDPOINT",
      message: epErr.message,
      latencyMs: 0,
    };
  }

  if (provider === "openai") {
    if (cleanApiKey) {
      headers["Authorization"] = `Bearer ${cleanApiKey}`;
    }
    body = JSON.stringify({
      model: cleanModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    });
  } else if (provider === "gemini") {
    if (cleanApiKey) {
      headers["x-goog-api-key"] = cleanApiKey;
    }
    body = JSON.stringify({
      contents: [{ parts: [{ text: "ping" }] }],
      generationConfig: {
        maxOutputTokens: 1,
      },
    });
  } else if (provider === "claude") {
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    if (cleanApiKey) {
      headers["x-api-key"] = cleanApiKey;
    }
    body = JSON.stringify({
      model: cleanModel,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
  }

  // 5. Send minimal test request with timeout
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => {
    controller.abort(new Error("Request timeout"));
  }, timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    const endTs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const latencyMs = Math.max(1, Math.round(endTs - startTs));

    let endpointHost = "";
    try {
      endpointHost = new URL(endpoint).host;
    } catch {}

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const { errorCode, message } = normalizeTestError(res.status, errText);

      logger.debug("TEST_CONN", "Test connection failed:", {
        provider,
        model: cleanModel,
        status: res.status,
        errorCode,
        latencyMs,
      });

      await appendApiLog({
        correlationId: `test_${startTs}_${Math.random().toString(36).slice(2, 7)}`,
        ts: startTs,
        completedAt: endTs,
        logicalLatencyMs: latencyMs,
        provider,
        model: cleanModel,
        operation: "testConnection",
        itemCount: 1,
        ok: false,
        finalStatus: res.status,
        finalErrorCode: errorCode,
        finalErrorMessage: message,
        totalAttempts: 1,
        attempts: [
          {
            attemptIndex: 0,
            keyIndex: 0,
            keyLabel: "Test Key",
            status: res.status,
            ok: false,
            startedAt: startTs,
            latencyMs,
            endpointHost,
            errorCode,
            errorMessage: message,
          },
        ],
      }).catch(() => {});

      return {
        ok: false,
        provider,
        errorCode,
        message,
        status: res.status,
        latencyMs,
      };
    }

    logger.debug("TEST_CONN", "Test connection successful:", {
      provider,
      model: cleanModel,
      latencyMs,
    });

    await appendApiLog({
      correlationId: `test_${startTs}_${Math.random().toString(36).slice(2, 7)}`,
      ts: startTs,
      completedAt: endTs,
      logicalLatencyMs: latencyMs,
      provider,
      model: cleanModel,
      operation: "testConnection",
      itemCount: 1,
      ok: true,
      finalStatus: res.status,
      totalAttempts: 1,
      attempts: [
        {
          attemptIndex: 0,
          keyIndex: 0,
          keyLabel: "Test Key",
          status: res.status,
          ok: true,
          startedAt: startTs,
          latencyMs,
          endpointHost,
        },
      ],
    }).catch(() => {});

    return {
      ok: true,
      provider,
      model: cleanModel,
      latencyMs,
    };
  } catch (fetchErr) {
    const endTs = typeof performance !== "undefined" ? performance.now() : Date.now();
    const latencyMs = Math.max(1, Math.round(endTs - startTs));

    let endpointHost = "";
    try {
      endpointHost = new URL(endpoint).host;
    } catch {}

    if (fetchErr.name === "AbortError" || fetchErr.message?.includes("timeout")) {
      const errMsg = `Connection timed out after ${Math.round(timeoutMs / 1000)}s`;
      await appendApiLog({
        correlationId: `test_${startTs}_${Math.random().toString(36).slice(2, 7)}`,
        ts: startTs,
        completedAt: endTs,
        logicalLatencyMs: latencyMs,
        provider,
        model: cleanModel,
        operation: "testConnection",
        itemCount: 1,
        ok: false,
        finalStatus: 0,
        finalErrorCode: "TIMEOUT",
        finalErrorMessage: errMsg,
        totalAttempts: 1,
        attempts: [
          {
            attemptIndex: 0,
            keyIndex: 0,
            keyLabel: "Test Key",
            status: 0,
            ok: false,
            startedAt: startTs,
            latencyMs,
            endpointHost,
            errorCode: "TIMEOUT",
            errorMessage: errMsg,
          },
        ],
      }).catch(() => {});

      return {
        ok: false,
        provider,
        errorCode: "TIMEOUT",
        message: errMsg,
        latencyMs,
      };
    }

    const isNetwork = fetchErr instanceof TypeError || fetchErr.message?.includes("fetch");
    const errMsg = isNetwork
      ? "Unable to reach provider endpoint (network error or blocked origin)"
      : fetchErr.message || "Request failed";

    logger.debug("TEST_CONN", "Test connection network error:", {
      provider,
      model: cleanModel,
      latencyMs,
      errorName: fetchErr.name,
    });

    await appendApiLog({
      correlationId: `test_${startTs}_${Math.random().toString(36).slice(2, 7)}`,
      ts: startTs,
      completedAt: endTs,
      logicalLatencyMs: latencyMs,
      provider,
      model: cleanModel,
      operation: "testConnection",
      itemCount: 1,
      ok: false,
      finalStatus: 0,
      finalErrorCode: isNetwork ? "NETWORK_ERROR" : "REQUEST_FAILED",
      finalErrorMessage: errMsg,
      totalAttempts: 1,
      attempts: [
        {
          attemptIndex: 0,
          keyIndex: 0,
          keyLabel: "Test Key",
          status: 0,
          ok: false,
          startedAt: startTs,
          latencyMs,
          endpointHost,
          errorCode: isNetwork ? "NETWORK_ERROR" : "REQUEST_FAILED",
          errorMessage: errMsg,
        },
      ],
    }).catch(() => {});

    return {
      ok: false,
      provider,
      errorCode: isNetwork ? "NETWORK_ERROR" : "REQUEST_FAILED",
      message: errMsg,
      latencyMs,
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
