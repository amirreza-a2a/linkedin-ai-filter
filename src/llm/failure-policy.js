// src/llm/failure-policy.js
// Semantic failure classification policy engine for LLM provider requests.
// Pure module: maps HTTP status codes, error texts, and exceptions into structured policy decisions.

import { sanitizeErrorMessage } from "../utils/sanitizer.js";

/**
 * @typedef {Object} FailurePolicyDecision
 * @property {string} errorCode - Normalized diagnostic error code
 * @property {boolean} shouldFailover - Whether the request should attempt failover to another key
 * @property {number} maxFailovers - Maximum number of alternate keys to attempt (0 for none, 1 for cautious, Infinity for key-specific)
 * @property {number} cooldownMs - Temporary cooldown duration for this key in milliseconds (0 for none)
 * @property {boolean} invalidateKey - Whether the key should be marked permanently invalid/disabled
 * @property {boolean} terminal - Whether the request must terminate immediately without further attempts
 * @property {string} message - Sanitized, human-friendly error message
 */

/**
 * Classifies an HTTP status code, raw error response body, or fetch error into a FailurePolicyDecision.
 *
 * @param {number} status - HTTP status code (or 0 for network/timeout)
 * @param {string|Error} [errorOrText] - Raw error text, JSON string, or Error object
 * @returns {FailurePolicyDecision}
 */
export function classifyFailure(status, errorOrText = "") {
  let errText = "";
  let isTimeout = false;
  let isNetwork = false;

  if (errorOrText instanceof Error) {
    errText = errorOrText.message || "";
    if (errorOrText.name === "AbortError" || errText.toLowerCase().includes("timeout")) {
      isTimeout = true;
    } else if (errorOrText instanceof TypeError || errText.toLowerCase().includes("fetch")) {
      isNetwork = true;
    }
  } else if (typeof errorOrText === "string") {
    errText = errorOrText;
    if (errText.toLowerCase().includes("timeout") || errText.toLowerCase().includes("aborterror")) {
      isTimeout = true;
    }
  }

  let parsedMsg = "";
  if (errText) {
    try {
      const data = JSON.parse(errText);
      parsedMsg = data.error?.message || data.message || (typeof data.error === "string" ? data.error : "");
      if (typeof parsedMsg === "object") parsedMsg = JSON.stringify(parsedMsg);
    } catch {
      parsedMsg = errText.slice(0, 200).trim();
    }
  }

  parsedMsg = sanitizeErrorMessage(parsedMsg);

  // 1. Timeout / AbortError
  if (isTimeout || status === 408 || status === 504) {
    return {
      errorCode: "TIMEOUT",
      shouldFailover: true,
      maxFailovers: 1, // Cautious: try at most 1 alternate key
      cooldownMs: 10000, // 10s cooldown
      invalidateKey: false,
      terminal: false,
      message: parsedMsg ? `Connection timed out: ${parsedMsg}` : "Connection timed out after 15s",
    };
  }

  // 2. Network / Client transport error (status = 0 or fetch failure)
  if (isNetwork || status === 0) {
    return {
      errorCode: "NETWORK_ERROR",
      shouldFailover: false, // Network offline/DNS: rotating keys is futile
      maxFailovers: 0,
      cooldownMs: 0,
      invalidateKey: false,
      terminal: true,
      message: parsedMsg || "Unable to reach provider endpoint (network offline or blocked origin)",
    };
  }

  // 3. HTTP 401 Unauthorized (Invalid API Key)
  if (status === 401) {
    return {
      errorCode: "INVALID_API_KEY",
      shouldFailover: true,
      maxFailovers: Infinity, // Key-specific: try all other configured keys
      cooldownMs: 0,
      invalidateKey: true, // Mark key invalid
      terminal: false,
      message: parsedMsg ? `Invalid API key: ${parsedMsg}` : "Invalid API key",
    };
  }

  // 4. HTTP 403 Forbidden (Permission Denied / Tier restriction)
  if (status === 403) {
    return {
      errorCode: "PERMISSION_DENIED",
      shouldFailover: true,
      maxFailovers: Infinity, // Try alternate keys
      cooldownMs: 300000, // 300s (5 min) cooldown
      invalidateKey: false, // Do NOT permanently invalidate
      terminal: false,
      message: parsedMsg ? `Permission denied: ${parsedMsg}` : "Access forbidden / account permission restriction",
    };
  }

  // 5. HTTP 429 Too Many Requests (Rate Limit or Monthly Quota)
  if (status === 429) {
    const isQuota = parsedMsg.toLowerCase().includes("quota") || parsedMsg.toLowerCase().includes("insufficient");
    const cooldownMs = isQuota ? 300000 : 30000; // 300s for quota exhaustion, 30s for short-term rate limit

    return {
      errorCode: isQuota ? "QUOTA_EXCEEDED" : "RATE_LIMITED",
      shouldFailover: true,
      maxFailovers: Infinity, // Try alternate keys
      cooldownMs,
      invalidateKey: false,
      terminal: false,
      message: parsedMsg ? `Rate limit / quota exceeded: ${parsedMsg}` : "Rate limit or quota exceeded",
    };
  }

  // 6. HTTP 409 Conflict (Provider resource state / version conflict)
  if (status === 409) {
    return {
      errorCode: "CONFLICT",
      shouldFailover: true,
      maxFailovers: 1, // Cautious failover
      cooldownMs: 10000, // 10s cooldown
      invalidateKey: false,
      terminal: false,
      message: parsedMsg ? `Resource conflict: ${parsedMsg}` : "Resource state conflict with provider",
    };
  }

  // 7. HTTP 500-599 Server Errors (Provider outage or spike)
  if (status >= 500 && status < 600) {
    return {
      errorCode: "SERVER_ERROR",
      shouldFailover: true,
      maxFailovers: 1, // Cautious: do NOT burn full key pool during global 5xx outage
      cooldownMs: 10000, // 10s cooldown
      invalidateKey: false,
      terminal: false,
      message: parsedMsg ? `Provider error ${status}: ${parsedMsg}` : `Provider temporarily unavailable (HTTP ${status})`,
    };
  }

  // 8. HTTP 400 Bad Request (Configuration / Prompt error)
  if (status === 400) {
    return {
      errorCode: "INVALID_REQUEST",
      shouldFailover: false, // Prompt/param error: rotating keys is futile
      maxFailovers: 0,
      cooldownMs: 0,
      invalidateKey: false,
      terminal: true,
      message: parsedMsg ? `Invalid request: ${parsedMsg}` : "Invalid request or unsupported parameter",
    };
  }

  // 9. HTTP 404 Not Found (Model name or endpoint invalid)
  if (status === 404) {
    return {
      errorCode: "NOT_FOUND",
      shouldFailover: false, // Model/path typo: rotating keys is futile
      maxFailovers: 0,
      cooldownMs: 0,
      invalidateKey: false,
      terminal: true,
      message: parsedMsg ? `Not found: ${parsedMsg}` : "Model or endpoint not found",
    };
  }

  // 10. Fallback for unhandled HTTP status
  return {
    errorCode: `HTTP_${status}`,
    shouldFailover: false,
    maxFailovers: 0,
    cooldownMs: 0,
    invalidateKey: false,
    terminal: true,
    message: parsedMsg ? `HTTP error ${status}: ${parsedMsg}` : `HTTP error ${status}`,
  };
}
