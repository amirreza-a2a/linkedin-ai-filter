// src/storage/api-log-store.js
// Persistent audit logging for logical API requests and correlated attempts.
// Bounded retention (max 100 logical records) in local storage with zero secret leakage.

import { sanitizeErrorMessage } from "../utils/sanitizer.js";
import { logger } from "../utils/logger.js";
import { browserApi } from "../utils/browser.js";

const API_LOGS_KEY = "apiLogs";
export const MAX_LOGICAL_LOGS = 100;

// Global serialized mutation queue for apiLogs writes
let mutationQueue = Promise.resolve();

function withSerializedLogMutation(operation) {
  const next = mutationQueue.then(() => operation());
  mutationQueue = next.catch(() => {});
  return next;
}

/**
 * Normalizes an individual attempt item.
 *
 * @param {Object} raw
 * @param {number} idx
 * @returns {Object}
 */
export function normalizeAttempt(raw = {}, idx = 0) {
  const keyIdx = typeof raw.keyIndex === "number" && !isNaN(raw.keyIndex) ? Math.max(0, raw.keyIndex) : 0;
  return {
    attemptIndex: typeof raw.attemptIndex === "number" ? raw.attemptIndex : idx,
    keyIndex: keyIdx,
    keyLabel: typeof raw.keyLabel === "string" && raw.keyLabel.trim() ? raw.keyLabel.trim() : `Key #${keyIdx + 1}`,
    status: typeof raw.status === "number" && !isNaN(raw.status) ? raw.status : 0,
    ok: raw.ok === true,
    startedAt: typeof raw.startedAt === "number" && !isNaN(raw.startedAt) ? raw.startedAt : Date.now(),
    latencyMs: typeof raw.latencyMs === "number" && !isNaN(raw.latencyMs) ? Math.max(0, Math.round(raw.latencyMs)) : 0,
    endpointHost: typeof raw.endpointHost === "string" ? raw.endpointHost.trim() : "",
    errorCode: typeof raw.errorCode === "string" ? raw.errorCode.trim() : "",
    errorMessage: sanitizeErrorMessage(typeof raw.errorMessage === "string" ? raw.errorMessage : ""),
  };
}

/**
 * Normalizes a raw logical request record.
 *
 * @param {Object} raw
 * @returns {Object} Canonical ApiRequestRecord
 */
export function normalizeApiLogRecord(raw = {}) {
  const ts = typeof raw.ts === "number" && !isNaN(raw.ts) ? raw.ts : Date.now();
  const completedAt =
    typeof raw.completedAt === "number" && !isNaN(raw.completedAt) ? raw.completedAt : ts;
  const logicalLatencyMs =
    typeof raw.logicalLatencyMs === "number" && !isNaN(raw.logicalLatencyMs)
      ? Math.max(0, Math.round(raw.logicalLatencyMs))
      : Math.max(0, completedAt - ts);

  const rawAttempts = Array.isArray(raw.attempts) ? raw.attempts : [];
  const attempts = rawAttempts.map((att, idx) => normalizeAttempt(att, idx));

  return {
    correlationId:
      typeof raw.correlationId === "string" && raw.correlationId.trim()
        ? raw.correlationId.trim()
        : `req_${ts}_${Math.random().toString(36).slice(2, 7)}`,
    ts,
    completedAt,
    logicalLatencyMs,
    provider: typeof raw.provider === "string" ? raw.provider.trim().toLowerCase() : "openai",
    model: typeof raw.model === "string" ? raw.model.trim() : "",
    operation: typeof raw.operation === "string" ? raw.operation.trim() : "classifyBatch",
    itemCount: typeof raw.itemCount === "number" && !isNaN(raw.itemCount) ? Math.max(0, raw.itemCount) : 0,
    ok: raw.ok === true,
    finalStatus: typeof raw.finalStatus === "number" && !isNaN(raw.finalStatus) ? raw.finalStatus : 0,
    finalErrorCode: typeof raw.finalErrorCode === "string" ? raw.finalErrorCode.trim() : "",
    finalErrorMessage: sanitizeErrorMessage(typeof raw.finalErrorMessage === "string" ? raw.finalErrorMessage : ""),
    totalAttempts: typeof raw.totalAttempts === "number" ? Math.max(1, raw.totalAttempts) : Math.max(1, attempts.length),
    attempts,
  };
}

/**
 * Appends a logical API request record to storage.
 * Bounded to MAX_LOGICAL_LOGS entries with quota recovery.
 * Strictly best-effort: never throws.
 *
 * @param {Object} rawRecord
 * @returns {Promise<boolean>} True if appended, false if storage unavailable/failed
 */
export async function appendApiLog(rawRecord) {
  if (!rawRecord || typeof rawRecord !== "object") return false;

  return withSerializedLogMutation(async () => {
    try {
      const localStore = browserApi?.storage?.local;
      if (!localStore) {
        return false;
      }

      const normRecord = normalizeApiLogRecord(rawRecord);

      const res = await localStore.get([API_LOGS_KEY]);
      let currentLogs = [];
      if (Array.isArray(res?.[API_LOGS_KEY])) {
        currentLogs = res[API_LOGS_KEY];
      } else if (res?.[API_LOGS_KEY] && typeof res[API_LOGS_KEY] === "object") {
        currentLogs = Object.values(res[API_LOGS_KEY]);
      }

      // Prepend newest record and sort descending by ts
      const combined = [normRecord, ...currentLogs]
        .map((r) => normalizeApiLogRecord(r))
        .sort((a, b) => b.ts - a.ts);

      let trimmed = combined.slice(0, MAX_LOGICAL_LOGS);

      try {
        await localStore.set({ [API_LOGS_KEY]: trimmed });
        return true;
      } catch (quotaErr) {
        // Quota recovery: trim to half capacity and retry once
        logger.warn("API_LOG", "Storage quota warning on write, trimming log capacity:", quotaErr);
        trimmed = trimmed.slice(0, Math.floor(MAX_LOGICAL_LOGS / 2));
        await localStore.set({ [API_LOGS_KEY]: trimmed });
        return true;
      }
    } catch (err) {
      logger.warn("API_LOG", "Failed to append API log record (non-blocking):", err);
      return false;
    }
  });
}

/**
 * Retrieves normalized API logs from storage with optional filtering.
 *
 * @param {Object} [filter]
 * @param {string} [filter.provider] - "all" | "openai" | "gemini" | "claude"
 * @param {string} [filter.status] - "all" | "success" | "error" | "failover"
 * @param {string} [filter.search] - substring filter on model, correlationId, error
 * @param {number} [filter.limit] - max records to return
 * @returns {Promise<Array<Object>>}
 */
export async function getApiLogs(filter = {}) {
  try {
    const localStore = browserApi?.storage?.local;
    if (!localStore) {
      return [];
    }

    const res = await localStore.get([API_LOGS_KEY]);
    let rawList = [];
    if (Array.isArray(res?.[API_LOGS_KEY])) {
      rawList = res[API_LOGS_KEY];
    } else if (res?.[API_LOGS_KEY] && typeof res[API_LOGS_KEY] === "object") {
      rawList = Object.values(res[API_LOGS_KEY]);
    }

    let records = rawList
      .map((r) => normalizeApiLogRecord(r))
      .sort((a, b) => b.ts - a.ts);

    // Apply provider filter
    const reqProvider = (filter.provider || "all").trim().toLowerCase();
    if (reqProvider && reqProvider !== "all") {
      records = records.filter((r) => r.provider === reqProvider);
    }

    // Apply status filter
    const reqStatus = (filter.status || "all").trim().toLowerCase();
    if (reqStatus === "success") {
      records = records.filter((r) => r.ok);
    } else if (reqStatus === "error") {
      records = records.filter((r) => !r.ok);
    } else if (reqStatus === "failover") {
      records = records.filter((r) => r.totalAttempts > 1);
    }

    // Apply search filter
    const search = (filter.search || "").trim().toLowerCase();
    if (search) {
      records = records.filter(
        (r) =>
          r.correlationId.toLowerCase().includes(search) ||
          r.model.toLowerCase().includes(search) ||
          r.finalErrorCode.toLowerCase().includes(search) ||
          r.finalErrorMessage.toLowerCase().includes(search) ||
          r.operation.toLowerCase().includes(search)
      );
    }

    if (typeof filter.limit === "number" && filter.limit > 0) {
      records = records.slice(0, filter.limit);
    }

    return records;
  } catch (err) {
    logger.warn("API_LOG", "Failed to retrieve API logs:", err);
    return [];
  }
}

/**
 * Clears all API logs from local storage.
 *
 * @returns {Promise<void>}
 */
export async function clearApiLogs() {
  return withSerializedLogMutation(async () => {
    try {
      const localStore = browserApi?.storage?.local;
      if (localStore) {
        await localStore.remove([API_LOGS_KEY]);
      }
    } catch (err) {
      logger.warn("API_LOG", "Failed to clear API logs:", err);
    }
  });
}

/**
 * Computes summary KPI statistics for API logs.
 *
 * @returns {Promise<Object>}
 */
export async function getApiLogStats() {
  const records = await getApiLogs();
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  const totalRequests = records.length;
  let totalRequests24h = 0;
  let successCount = 0;
  let failureCount = 0;
  let failoverCount = 0;
  let totalLatencyMs = 0;

  const byProvider = {
    openai: { count: 0, success: 0, error: 0, totalLatencyMs: 0 },
    gemini: { count: 0, success: 0, error: 0, totalLatencyMs: 0 },
    claude: { count: 0, success: 0, error: 0, totalLatencyMs: 0 },
  };

  for (const r of records) {
    if (r.ts >= oneDayAgo) {
      totalRequests24h++;
    }

    if (r.ok) {
      successCount++;
    } else {
      failureCount++;
    }

    if (r.totalAttempts > 1) {
      failoverCount++;
    }

    totalLatencyMs += r.logicalLatencyMs;

    const p = r.provider || "openai";
    if (!byProvider[p]) {
      byProvider[p] = { count: 0, success: 0, error: 0, totalLatencyMs: 0 };
    }
    byProvider[p].count++;
    if (r.ok) byProvider[p].success++;
    else byProvider[p].error++;
    byProvider[p].totalLatencyMs += r.logicalLatencyMs;
  }

  const successRate = totalRequests > 0 ? Math.round((successCount / totalRequests) * 1000) / 10 : 100;
  const failoverRate = totalRequests > 0 ? Math.round((failoverCount / totalRequests) * 1000) / 10 : 0;
  const avgLogicalLatencyMs = totalRequests > 0 ? Math.round(totalLatencyMs / totalRequests) : 0;

  for (const p of Object.keys(byProvider)) {
    const item = byProvider[p];
    item.avgLatencyMs = item.count > 0 ? Math.round(item.totalLatencyMs / item.count) : 0;
    item.successRate = item.count > 0 ? Math.round((item.success / item.count) * 1000) / 10 : 100;
  }

  return {
    totalRequests,
    totalRequests24h,
    successCount,
    failureCount,
    successRate,
    failoverCount,
    failoverRate,
    avgLogicalLatencyMs,
    byProvider,
  };
}
