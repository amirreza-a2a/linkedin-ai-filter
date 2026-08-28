import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAndNormalizeBaseUrl,
  getRequiredOriginPattern,
  resolveProviderEndpoint,
} from "../src/llm/url-helper.js";

test("validateAndNormalizeBaseUrl - empty or whitespace input", () => {
  assert.equal(validateAndNormalizeBaseUrl(""), "");
  assert.equal(validateAndNormalizeBaseUrl("   "), "");
  assert.equal(validateAndNormalizeBaseUrl(null), "");
  assert.equal(validateAndNormalizeBaseUrl(undefined), "");
});

test("validateAndNormalizeBaseUrl - valid HTTPS domains & normalization", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("https://api.openai.com/v1"),
    "https://api.openai.com/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("https://api.openai.com/v1/"),
    "https://api.openai.com/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("https://api.openai.com///"),
    "https://api.openai.com"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("https://openrouter.ai/api/v1"),
    "https://openrouter.ai/api/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("https://api.groq.com/openai/v1/"),
    "https://api.groq.com/openai/v1"
  );
});

test("validateAndNormalizeBaseUrl - localhost, 127.0.0.1, and IPv6", () => {
  assert.equal(
    validateAndNormalizeBaseUrl("http://localhost:11434/v1"),
    "http://localhost:11434/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("http://localhost:11434/v1/"),
    "http://localhost:11434/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("http://127.0.0.1:1234/v1"),
    "http://127.0.0.1:1234/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("http://[::1]:11434/v1"),
    "http://[::1]:11434/v1"
  );
  assert.equal(
    validateAndNormalizeBaseUrl("http://[2001:db8::1]:8080/v1"),
    "http://[2001:db8::1]:8080/v1"
  );
});

test("validateAndNormalizeBaseUrl - rejects non-http/https protocols", () => {
  assert.throws(() => validateAndNormalizeBaseUrl("file:///etc/passwd"), {
    message: /protocol must be http: or https:/,
  });
  assert.throws(() => validateAndNormalizeBaseUrl("javascript:alert(1)"), {
    message: /protocol must be http: or https:/,
  });
  assert.throws(() => validateAndNormalizeBaseUrl("data:text/plain,hello"), {
    message: /protocol must be http: or https:/,
  });
  assert.throws(() => validateAndNormalizeBaseUrl("ftp://server/resource"), {
    message: /protocol must be http: or https:/,
  });
  assert.throws(() => validateAndNormalizeBaseUrl("ws://localhost:8080"), {
    message: /protocol must be http: or https:/,
  });
});

test("validateAndNormalizeBaseUrl - rejects embedded credentials", () => {
  assert.throws(
    () => validateAndNormalizeBaseUrl("https://user:password@api.openai.com/v1"),
    { message: /embedded credentials/ }
  );
  assert.throws(
    () => validateAndNormalizeBaseUrl("http://admin@localhost:11434/v1"),
    { message: /embedded credentials/ }
  );
});

test("validateAndNormalizeBaseUrl - rejects malformed strings", () => {
  assert.throws(() => validateAndNormalizeBaseUrl("not-a-valid-url"), {
    message: /malformed URL/,
  });
  assert.throws(() => validateAndNormalizeBaseUrl("http://"), {
    message: /malformed URL/,
  });
});

test("getRequiredOriginPattern - extracts exact match pattern for Chrome permissions", () => {
  assert.equal(getRequiredOriginPattern(""), "");
  assert.equal(
    getRequiredOriginPattern("https://openrouter.ai/api/v1"),
    "https://openrouter.ai/*"
  );
  assert.equal(
    getRequiredOriginPattern("https://api.groq.com/openai/v1/"),
    "https://api.groq.com/*"
  );
  assert.equal(
    getRequiredOriginPattern("http://localhost:11434/v1"),
    "http://localhost/*"
  );
  assert.equal(
    getRequiredOriginPattern("http://127.0.0.1:1234/v1"),
    "http://127.0.0.1/*"
  );
  assert.equal(
    getRequiredOriginPattern("http://[::1]:11434/v1"),
    "http://[::1]/*"
  );
  assert.equal(
    getRequiredOriginPattern("http://[2001:db8::1]:8080/v1"),
    "http://[2001:db8::1]/*"
  );
});

test("resolveProviderEndpoint - OpenAI default and custom", () => {
  assert.equal(
    resolveProviderEndpoint("openai", "", "gpt-4o-mini"),
    "https://api.openai.com/v1/chat/completions"
  );
  assert.equal(
    resolveProviderEndpoint("openai", "https://openrouter.ai/api/v1", "anthropic/claude-3.5-sonnet"),
    "https://openrouter.ai/api/v1/chat/completions"
  );
  assert.equal(
    resolveProviderEndpoint("openai", "http://localhost:11434/v1/", "llama3.2"),
    "http://localhost:11434/v1/chat/completions"
  );
});

test("resolveProviderEndpoint - Gemini default and custom", () => {
  assert.equal(
    resolveProviderEndpoint("gemini", "", "gemini-3.5-flash"),
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"
  );
  assert.equal(
    resolveProviderEndpoint("gemini", "https://my-proxy.example.com", "gemini-3.5-pro"),
    "https://my-proxy.example.com/v1beta/models/gemini-3.5-pro:generateContent"
  );
});

test("resolveProviderEndpoint - Claude default and custom", () => {
  assert.equal(
    resolveProviderEndpoint("claude", "", "claude-haiku-4-5-20251001"),
    "https://api.anthropic.com/v1/messages"
  );
  assert.equal(
    resolveProviderEndpoint("claude", "https://anthropic-proxy.corp.internal", "claude-3-5-sonnet-20241022"),
    "https://anthropic-proxy.corp.internal/v1/messages"
  );
});
