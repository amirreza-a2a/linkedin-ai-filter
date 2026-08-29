// src/llm/request-gateway.js
// Centralized API request orchestrator for batch classification and observability.
// Implements multi-key round-robin leasing, failure classification, and bounded failover.

import { acquireKey, releaseKey, applyFailureOutcome, applySuccessOutcome } from "./key-scheduler.js";
import { classifyFailure } from "./failure-policy.js";
import { appendApiLog } from "../storage/api-log-store.js";
import { executeHttpAttempt as openaiAttempt } from "./openai-provider.js";
import { executeHttpAttempt as geminiAttempt } from "./gemini-provider.js";
import { executeHttpAttempt as claudeAttempt } from "./claude-provider.js";
import { logger } from "../utils/logger.js";

const PROVIDER_ADAPTERS = {
  openai: openaiAttempt,
  gemini: geminiAttempt,
  claude: claudeAttempt,
};

/**
 * Executes a batch classification request across configured provider keys with automatic failover.
 *
 * @param {Object} params
 * @param {"openai"|"gemini"|"claude"} params.provider
 * @param {string[]} [params.keys=[]] - Configured keys array from storage
 * @param {string} [params.model]
 * @param {string} [params.baseUrl]
 * @param {string} [params.rulesText]
 * @param {Array} [params.posts=[]]
 * @param {number} [params.timeoutMs=15000]
 * @returns {Promise<{
 *   ok: boolean,
 *   results: Array,
 *   finalStatus: number,
 *   finalErrorCode: string,
 *   finalErrorMessage: string,
 *   totalAttempts: number,
 *   correlationId: string,
 *   logicalLatencyMs: number
 * }>}
 */
export async function executeClassifyRequest({
  provider = "openai",
  keys = [],
  model = "",
  baseUrl = "",
  rulesText = "",
  posts = [],
  timeoutMs = 15000,
}) {
  const startedAt = Date.now();
  const correlationId = `req_${startedAt}_${Math.random().toString(36).slice(2, 7)}`;
  const attempts = [];
  const excludedIndices = new Set();

  let consecutiveCautiousFailovers = 0;
  let logicalOk = false;
  let finalResults = null;
  let finalStatus = 0;
  let finalErrorCode = "";
  let finalErrorMessage = "";

  const normProvider = (provider || "openai").trim().toLowerCase();
  const adapter = PROVIDER_ADAPTERS[normProvider] || PROVIDER_ADAPTERS.openai;

  logger.trace("GATEWAY_STARTED", `provider=${normProvider} keys=${keys.length} model=${model}`);

  // Handle local unauthenticated models (e.g. Ollama on OpenAI-compatible endpoint)
  const isCustomOpenAi = normProvider === "openai" && Boolean(baseUrl);
  const effectiveKeys = Array.isArray(keys) && keys.length > 0 ? keys : isCustomOpenAi ? [""] : [];

  if (effectiveKeys.length === 0) {
    finalErrorCode = "MISSING_API_KEY";
    finalErrorMessage = "API key is required";
    logger.trace("GATEWAY_FAILED", "errorCode=MISSING_API_KEY");
  } else {
    // Attempt execution loop
    while (true) {
      const lease = acquireKey(normProvider, effectiveKeys, {
        excludeIndices: Array.from(excludedIndices),
      });

      if (!lease) {
        finalErrorCode = attempts.length > 0 ? (finalErrorCode || "ALL_KEYS_EXHAUSTED") : "ALL_KEYS_INVALID";
        finalErrorMessage =
          attempts.length > 0
            ? (finalErrorMessage || "All available keys exhausted after failover")
            : "All configured API keys are invalid";
        logger.trace("GATEWAY_FAILED", `errorCode=${finalErrorCode}`);
        break;
      }

      // Invariant 5: Do NOT immediately dispatch requests with inCooldown === true
      if (lease.inCooldown) {
        releaseKey(normProvider, lease.keyIndex);
        finalErrorCode = "ALL_KEYS_COOLDOWN";
        finalErrorMessage = `All configured API keys are currently in cooldown (retry in ${Math.ceil(
          (lease.cooldownRemainingMs || 0) / 1000
        )}s)`;
        logger.trace("GATEWAY_FAILED", `errorCode=ALL_KEYS_COOLDOWN`);
        break;
      }

      const attemptStartedAt = Date.now();
      const attemptIndex = attempts.length;
      const keyIndex = lease.keyIndex;
      excludedIndices.add(keyIndex); // Invariant 15: never reuse same key within logical request

      logger.trace("KEY_SELECTED", `provider=${normProvider} keyIndex=${keyIndex}`);

      try {
        const res = await adapter({
          apiKey: lease.key,
          model,
          baseUrl,
          rulesText,
          posts,
          timeoutMs,
        });

        logger.trace("HTTP_ATTEMPT", `provider=${normProvider} attemptIndex=${attemptIndex} status=${res.status} ok=${res.ok}`);

        if (res.ok) {
          applySuccessOutcome(normProvider, keyIndex);
          attempts.push({
            attemptIndex,
            keyIndex,
            keyLabel: lease.keyLabel,
            status: res.status,
            ok: true,
            startedAt: attemptStartedAt,
            latencyMs: res.latencyMs,
            endpointHost: res.endpointHost || "",
          });

          logicalOk = true;
          finalStatus = res.status;
          finalResults = res.results;
          break; // Success terminates attempt loop
        } else {
          const policy = classifyFailure(res.status, res.rawErrorText || res.error);
          attempts.push({
            attemptIndex,
            keyIndex,
            keyLabel: lease.keyLabel,
            status: res.status,
            ok: false,
            startedAt: attemptStartedAt,
            latencyMs: res.latencyMs,
            endpointHost: res.endpointHost || "",
            errorCode: policy.errorCode,
            errorMessage: policy.message,
          });

          // Invariant 16: update scheduler health/cooldown BEFORE next key selection
          applyFailureOutcome(normProvider, keyIndex, policy);

          finalStatus = res.status;
          finalErrorCode = policy.errorCode;
          finalErrorMessage = policy.message;

          // Check if policy allows failover
          if (policy.terminal || !policy.shouldFailover) {
            logicalOk = false;
            break;
          }

          if (policy.maxFailovers !== Infinity) {
            consecutiveCautiousFailovers++;
            if (consecutiveCautiousFailovers > policy.maxFailovers) {
              logicalOk = false;
              break;
            }
          } else {
            consecutiveCautiousFailovers = 0;
          }
        }
      } catch (unhandledErr) {
        const latencyMs = Math.max(1, Date.now() - attemptStartedAt);
        const policy = classifyFailure(0, unhandledErr);
        attempts.push({
          attemptIndex,
          keyIndex,
          keyLabel: lease.keyLabel,
          status: 0,
          ok: false,
          startedAt: attemptStartedAt,
          latencyMs,
          endpointHost: "",
          errorCode: policy.errorCode,
          errorMessage: policy.message,
        });

        applyFailureOutcome(normProvider, keyIndex, policy);
        finalStatus = 0;
        finalErrorCode = policy.errorCode;
        finalErrorMessage = policy.message;

        if (policy.terminal || !policy.shouldFailover) {
          logicalOk = false;
          break;
        }

        if (policy.maxFailovers !== Infinity) {
          consecutiveCautiousFailovers++;
          if (consecutiveCautiousFailovers > policy.maxFailovers) {
            logicalOk = false;
            break;
          }
        } else {
          consecutiveCautiousFailovers = 0;
        }
      } finally {
        // Invariant 6: Guaranteed lease release on success and every failure path
        releaseKey(normProvider, keyIndex);
      }
    }
  }

  const completedAt = Date.now();
  const logicalLatencyMs = Math.max(1, completedAt - startedAt);

  logger.trace("HTTP_RESULT", `status=${finalStatus} ok=${logicalOk}`);

  // Invariant 8 & 9: Construct ONE single logical API log record with embedded attempts
  const logRecord = {
    correlationId,
    ts: startedAt,
    completedAt,
    logicalLatencyMs,
    provider: normProvider,
    model,
    operation: "classifyBatch",
    itemCount: Array.isArray(posts) ? posts.length : 0,
    ok: logicalOk,
    finalStatus: finalStatus || (attempts.length ? attempts[attempts.length - 1].status : 0),
    finalErrorCode: finalErrorCode || "",
    finalErrorMessage: finalErrorMessage || "",
    totalAttempts: attempts.length,
    attempts,
  };

  // Invariant 7: Asynchronous best-effort log persistence (never blocks or throws)
  try {
    await appendApiLog(logRecord);
  } catch (err) {
    logger.warn("GATEWAY", "Failed to persist API log:", err);
  }

  return {
    ok: logicalOk,
    results: finalResults || [],
    finalStatus,
    finalErrorCode,
    finalErrorMessage,
    totalAttempts: attempts.length,
    correlationId,
    logicalLatencyMs,
  };
}
