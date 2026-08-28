// src/llm/url-helper.js

/**
 * Validates and normalizes a user-provided Base URL.
 * - Enforces absolute URL format with http: or https: scheme
 * - Rejects embedded credentials (user:pass@)
 * - Supports domain names, localhost, 127.0.0.1, and IPv6 ([::1])
 * - Normalizes and strips trailing slashes
 *
 * @param {string} inputUrl
 * @returns {string} Normalized base URL without trailing slashes, or "" if input is empty
 */
export function validateAndNormalizeBaseUrl(inputUrl) {
  if (!inputUrl || !inputUrl.trim()) {
    return "";
  }
  const trimmed = inputUrl.trim();

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid Base URL "${trimmed}": malformed URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid Base URL "${trimmed}": protocol must be http: or https:`);
  }

  if (parsed.username || parsed.password) {
    throw new Error("Invalid Base URL: embedded credentials (user:pass) are not allowed");
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${cleanPath}`;
}

/**
 * Extracts the Chrome extension match pattern for host permissions from a URL.
 * Chrome match pattern syntax: <scheme>://<host>/* (ports are omitted in match patterns).
 *
 * @param {string} urlStr
 * @returns {string} Match pattern, e.g. "https://api.groq.com/*" or "http://localhost/*"
 */
export function getRequiredOriginPattern(urlStr) {
  if (!urlStr || !urlStr.trim()) return "";
  const normalized = validateAndNormalizeBaseUrl(urlStr);
  if (!normalized) return "";
  const parsed = new URL(normalized);
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.includes(":")) {
    return `${parsed.protocol}//localhost/*`;
  }
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

/**
 * Deterministically constructs the full endpoint for each provider.
 *
 * @param {string} provider - "openai" | "gemini" | "claude"
 * @param {string} baseUrl - Custom base URL (optional)
 * @param {string} model - Model identifier
 * @returns {string} Full endpoint URL
 */
export function resolveProviderEndpoint(provider, baseUrl, model) {
  const normalized = validateAndNormalizeBaseUrl(baseUrl);

  switch (provider) {
    case "openai": {
      const base = normalized || "https://api.openai.com/v1";
      return `${base}/chat/completions`;
    }
    case "gemini": {
      const base = normalized || "https://generativelanguage.googleapis.com";
      const m = encodeURIComponent(model || "gemini-3.5-flash");
      return `${base}/v1beta/models/${m}:generateContent`;
    }
    case "claude": {
      const base = normalized || "https://api.anthropic.com";
      return `${base}/v1/messages`;
    }
    default:
      throw new Error(`Unknown provider for endpoint resolution: ${provider}`);
  }
}
