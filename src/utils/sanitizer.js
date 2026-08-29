// src/utils/sanitizer.js
// Centralized secret scrubbing engine for error messages, headers, and logs.
// Guarantees that raw credentials, tokens, and secret headers never leak into logs or storage.

/**
 * Sanitizes any sensitive credential tokens, Bearer strings, or API key patterns from strings.
 *
 * @param {string} msg
 * @returns {string}
 */
export function sanitizeErrorMessage(msg) {
  if (typeof msg !== "string") return "";
  return msg
    .replace(/sk-ant-[a-zA-Z0-9_\-]{8,}/gi, "sk-ant-***")
    .replace(/sk-[a-zA-Z0-9_\-]{8,}/gi, "sk-***")
    .replace(/AIza[a-zA-Z0-9_\-]{8,}/gi, "AIza***")
    .replace(/Bearer\s+[a-zA-Z0-9._\-]+/gi, "Bearer ***")
    .replace(/x-api-key:\s*[^\s,]+/gi, "x-api-key: ***")
    .replace(/x-goog-api-key:\s*[^\s,]+/gi, "x-goog-api-key: ***");
}

/**
 * Sanitizes an object of HTTP headers, redacting any sensitive authentication headers.
 *
 * @param {Record<string, string>|null|undefined} headers
 * @returns {Record<string, string>}
 */
export function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sanitized = {};
  for (const [key, val] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey === "authorization" ||
      lowerKey === "x-api-key" ||
      lowerKey === "x-goog-api-key" ||
      lowerKey.includes("key") ||
      lowerKey.includes("token") ||
      lowerKey.includes("secret")
    ) {
      sanitized[key] = "***";
    } else {
      sanitized[key] = typeof val === "string" ? sanitizeErrorMessage(val) : String(val);
    }
  }
  return sanitized;
}
