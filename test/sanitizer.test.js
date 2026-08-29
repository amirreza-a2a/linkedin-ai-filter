// test/sanitizer.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeErrorMessage, sanitizeHeaders } from "../src/utils/sanitizer.js";

test("sanitizeErrorMessage - redacts standard API key formats and bearer tokens", () => {
  const rawMsg = "Error sk-1234567890abcdef with sk-ant-api03-abcdef123456789 and AIzaSyD9876543210zyx and Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const sanitized = sanitizeErrorMessage(rawMsg);

  assert.ok(!sanitized.includes("sk-1234567890abcdef"));
  assert.ok(!sanitized.includes("sk-ant-api03-abcdef123456789"));
  assert.ok(!sanitized.includes("AIzaSyD9876543210zyx"));
  assert.ok(!sanitized.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));

  assert.ok(sanitized.includes("sk-***"));
  assert.ok(sanitized.includes("sk-ant-***"));
  assert.ok(sanitized.includes("AIza***"));
  assert.ok(sanitized.includes("Bearer ***"));
});

test("sanitizeErrorMessage - redacts header-style key values in error text", () => {
  const rawMsg = "Failed request with header x-api-key: secret_anthropic_key_12345 and x-goog-api-key: secret_gemini_key_99999";
  const sanitized = sanitizeErrorMessage(rawMsg);

  assert.ok(!sanitized.includes("secret_anthropic_key_12345"));
  assert.ok(!sanitized.includes("secret_gemini_key_99999"));
  assert.ok(sanitized.includes("x-api-key: ***"));
  assert.ok(sanitized.includes("x-goog-api-key: ***"));
});

test("sanitizeErrorMessage - handles null, undefined, numbers, and empty strings safely", () => {
  assert.equal(sanitizeErrorMessage(""), "");
  assert.equal(sanitizeErrorMessage(null), "");
  assert.equal(sanitizeErrorMessage(undefined), "");
  assert.equal(sanitizeErrorMessage(123), "");
});

test("sanitizeHeaders - redacts sensitive auth headers while preserving neutral headers", () => {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-test-openai",
    "x-api-key": "sk-ant-test-claude",
    "x-goog-api-key": "AIzaSyTest",
    "Custom-Key": "my-secret-key",
    "Accept": "application/json",
  };

  const sanitized = sanitizeHeaders(headers);

  assert.equal(sanitized["Content-Type"], "application/json");
  assert.equal(sanitized["Accept"], "application/json");
  assert.equal(sanitized["Authorization"], "***");
  assert.equal(sanitized["x-api-key"], "***");
  assert.equal(sanitized["x-goog-api-key"], "***");
  assert.equal(sanitized["Custom-Key"], "***");
});

test("sanitizeHeaders - handles null, undefined, or empty inputs gracefully", () => {
  assert.deepEqual(sanitizeHeaders(null), {});
  assert.deepEqual(sanitizeHeaders(undefined), {});
  assert.deepEqual(sanitizeHeaders("not an object"), {});
});
