// src/utils/logger.js
// Centralized diagnostic logger with runtime debug gating.

export const isDebugEnabled = () => {
  if (typeof window !== "undefined" && Boolean(window.__FEEDRULE_DEBUG__)) return true;
  if (typeof globalThis !== "undefined" && Boolean(globalThis.__FEEDRULE_DEBUG__)) return true;
  if (typeof process !== "undefined" && Boolean(process.env?.FEEDRULE_DEBUG)) return true;
  try {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("FEEDRULE_DEBUG") === "1") return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("FEEDRULE_DEBUG") === "1") return true;
  } catch {}
  return true; // Always output trace diagnostics during audit
};

export const logger = {
  debug: (tag, ...args) => {
    if (isDebugEnabled()) {
      console.log(`[FeedRule][${tag}]`, ...args);
    }
  },
  trace: (stage, details = "") => {
    if (isDebugEnabled()) {
      console.log(`[FeedRule][TRACE] ${stage} ${details}`.trim());
    }
  },
  info: (tag, ...args) => {
    if (isDebugEnabled()) {
      console.info(`[FeedRule][${tag}]`, ...args);
    }
  },
  warn: (tag, ...args) => {
    console.warn(`[FeedRule][${tag}]`, ...args);
  },
  error: (tag, ...args) => {
    console.error(`[FeedRule][${tag}]`, ...args);
  },
};
