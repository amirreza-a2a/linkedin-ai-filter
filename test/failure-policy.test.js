// test/failure-policy.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { classifyFailure } from "../src/llm/failure-policy.js";

test("classifyFailure: 401 Unauthorized permanently invalidates key and enables failover", () => {
  const res = classifyFailure(401, JSON.stringify({ error: { message: "Invalid key sk-1234567890abcdef" } }));
  assert.equal(res.errorCode, "INVALID_API_KEY");
  assert.equal(res.invalidateKey, true);
  assert.equal(res.shouldFailover, true);
  assert.equal(res.maxFailovers, Infinity);
  assert.equal(res.terminal, false);
  assert.equal(res.cooldownMs, 0);
  assert.ok(!res.message.includes("sk-1234567890abcdef"));
  assert.ok(res.message.includes("sk-***"));
});

test("classifyFailure: 403 Forbidden applies 300s cooldown without permanent invalidation", () => {
  const res = classifyFailure(403, "Access forbidden for project");
  assert.equal(res.errorCode, "PERMISSION_DENIED");
  assert.equal(res.invalidateKey, false);
  assert.equal(res.shouldFailover, true);
  assert.equal(res.cooldownMs, 300000); // 300s
  assert.equal(res.terminal, false);
});

test("classifyFailure: 429 distinguishes monthly quota from short-term rate limit", () => {
  // 1. Quota error -> 300s cooldown
  const quotaRes = classifyFailure(429, JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan" } }));
  assert.equal(quotaRes.errorCode, "QUOTA_EXCEEDED");
  assert.equal(quotaRes.cooldownMs, 300000); // 300s
  assert.equal(quotaRes.shouldFailover, true);
  assert.equal(quotaRes.invalidateKey, false);

  // 2. Rate limit error -> 30s cooldown
  const rateRes = classifyFailure(429, JSON.stringify({ error: { message: "Rate limit reached for requests per minute" } }));
  assert.equal(rateRes.errorCode, "RATE_LIMITED");
  assert.equal(rateRes.cooldownMs, 30000); // 30s
  assert.equal(rateRes.shouldFailover, true);
  assert.equal(rateRes.invalidateKey, false);
});

test("classifyFailure: 409 Conflict applies 10s cooldown and limits failover to 1 alternate key", () => {
  const res = classifyFailure(409, "Model instance locked");
  assert.equal(res.errorCode, "CONFLICT");
  assert.equal(res.cooldownMs, 10000);
  assert.equal(res.shouldFailover, true);
  assert.equal(res.maxFailovers, 1);
  assert.equal(res.terminal, false);
});

test("classifyFailure: 5xx Server Errors (500, 502, 503) apply 10s cooldown and cap failover to 1 alternate", () => {
  for (const status of [500, 502, 503]) {
    const res = classifyFailure(status, "Service Unavailable");
    assert.equal(res.errorCode, "SERVER_ERROR");
    assert.equal(res.cooldownMs, 10000);
    assert.equal(res.shouldFailover, true);
    assert.equal(res.maxFailovers, 1);
    assert.equal(res.terminal, false);
  }
});

test("classifyFailure: Timeout / AbortError applies 10s cooldown and caps failover to 1 alternate", () => {
  const abortErr = new Error("The operation was aborted");
  abortErr.name = "AbortError";

  const res = classifyFailure(0, abortErr);
  assert.equal(res.errorCode, "TIMEOUT");
  assert.equal(res.cooldownMs, 10000);
  assert.equal(res.shouldFailover, true);
  assert.equal(res.maxFailovers, 1);
  assert.equal(res.terminal, false);
});

test("classifyFailure: 400 Bad Request is terminal and does NOT rotate keys", () => {
  const res = classifyFailure(400, "Context length exceeded");
  assert.equal(res.errorCode, "INVALID_REQUEST");
  assert.equal(res.terminal, true);
  assert.equal(res.shouldFailover, false);
  assert.equal(res.maxFailovers, 0);
  assert.equal(res.cooldownMs, 0);
});

test("classifyFailure: 404 Not Found is terminal and does NOT rotate keys", () => {
  const res = classifyFailure(404, "Unknown model gpt-5");
  assert.equal(res.errorCode, "NOT_FOUND");
  assert.equal(res.terminal, true);
  assert.equal(res.shouldFailover, false);
  assert.equal(res.maxFailovers, 0);
});

test("classifyFailure: Network Error is terminal and does NOT rotate keys", () => {
  const netErr = new TypeError("Failed to fetch");
  const res = classifyFailure(0, netErr);
  assert.equal(res.errorCode, "NETWORK_ERROR");
  assert.equal(res.terminal, true);
  assert.equal(res.shouldFailover, false);
  assert.equal(res.maxFailovers, 0);
});
