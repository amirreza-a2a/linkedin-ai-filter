// src/utils/logger.js
// Centralized diagnostic logger with runtime debug gating.

export const isDebugEnabled = () => {
  if (typeof window !== "undefined" && Boolean(window.__FEEDRULE_DEBUG__)) return true;
  if (typeof globalThis !== "undefined" && Boolean(globalThis.__FEEDRULE_DEBUG__)) return true;
  if (typeof process !== "undefined" && Boolean(process.env?.FEEDRULE_DEBUG)) return true;
  return false;
};

export const logger = {
  debug: (tag, ...args) => {
    if (isDebugEnabled()) {
      console.log(`[FeedRule][${tag}]`, ...args);
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
