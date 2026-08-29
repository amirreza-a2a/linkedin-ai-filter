// test/key-scheduler.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  acquireKey,
  releaseKey,
  applyFailureOutcome,
  applySuccessOutcome,
  getKeyPoolStatus,
  resetScheduler,
} from "../src/llm/key-scheduler.js";

test("key-scheduler: round-robin selection when lease counts are equal", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2", "sk-key-3"];

  const k1 = acquireKey("openai", keys);
  assert.equal(k1.keyIndex, 0);
  assert.equal(k1.key, "sk-key-1");
  releaseKey("openai", k1.keyIndex);

  const k2 = acquireKey("openai", keys);
  assert.equal(k2.keyIndex, 1);
  assert.equal(k2.key, "sk-key-2");
  releaseKey("openai", k2.keyIndex);

  const k3 = acquireKey("openai", keys);
  assert.equal(k3.keyIndex, 2);
  assert.equal(k3.key, "sk-key-3");
  releaseKey("openai", k3.keyIndex);

  // Wraps around to 0
  const k4 = acquireKey("openai", keys);
  assert.equal(k4.keyIndex, 0);
  releaseKey("openai", k4.keyIndex);
});

test("key-scheduler: concurrent leasing prefers keys with fewer active leases", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2", "sk-key-3"];

  // Acquire key 0 and key 1 without releasing
  const l1 = acquireKey("openai", keys); // key 0 leased (leases: 1)
  const l2 = acquireKey("openai", keys); // key 1 leased (leases: 1)

  assert.equal(l1.keyIndex, 0);
  assert.equal(l2.keyIndex, 1);

  // Third acquisition should pick key 2 (leases: 0)
  const l3 = acquireKey("openai", keys);
  assert.equal(l3.keyIndex, 2);

  // Now all keys have 1 lease. Fourth acquisition picks key 0 via round robin
  const l4 = acquireKey("openai", keys);
  assert.equal(l4.keyIndex, 0);

  // Release all
  releaseKey("openai", l1.keyIndex);
  releaseKey("openai", l2.keyIndex);
  releaseKey("openai", l3.keyIndex);
  releaseKey("openai", l4.keyIndex);

  const status = getKeyPoolStatus("openai", keys);
  assert.equal(status[0].activeLeases, 0);
  assert.equal(status[1].activeLeases, 0);
  assert.equal(status[2].activeLeases, 0);
});

test("key-scheduler: invalid keys are permanently skipped", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2", "sk-key-3"];

  // Mark key 0 as invalid (e.g. 401)
  applyFailureOutcome("openai", 0, { invalidateKey: true });

  const status = getKeyPoolStatus("openai", keys);
  assert.equal(status[0].status, "invalid");

  // Subsequent acquisitions must only rotate between key 1 and key 2
  const kA = acquireKey("openai", keys);
  assert.equal(kA.keyIndex, 1);
  releaseKey("openai", kA.keyIndex);

  const kB = acquireKey("openai", keys);
  assert.equal(kB.keyIndex, 2);
  releaseKey("openai", kB.keyIndex);

  const kC = acquireKey("openai", keys);
  assert.equal(kC.keyIndex, 1);
  releaseKey("openai", kC.keyIndex);
});

test("key-scheduler: cooldown skips keys temporarily until expiry", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2"];

  // Place key 0 in 50ms cooldown
  applyFailureOutcome("openai", 0, { cooldownMs: 50 });

  // Key 1 must be chosen while key 0 is cooling down
  const k1 = acquireKey("openai", keys);
  assert.equal(k1.keyIndex, 1);
  assert.equal(k1.inCooldown, false);
  releaseKey("openai", k1.keyIndex);

  // Wait 60ms for cooldown to expire
  return new Promise((resolve) => {
    setTimeout(() => {
      // Key 0 should now be eligible again
      const k0 = acquireKey("openai", keys);
      assert.equal(k0.keyIndex, 0);
      assert.equal(k0.inCooldown, false);
      releaseKey("openai", k0.keyIndex);
      resolve();
    }, 60);
  });
});

test("key-scheduler: all keys in cooldown selects earliest-expiring fallback", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2"];

  // Place key 0 in 1000ms cooldown, key 1 in 5000ms cooldown
  applyFailureOutcome("openai", 0, { cooldownMs: 1000 });
  applyFailureOutcome("openai", 1, { cooldownMs: 5000 });

  // All keys are in cooldown -> should fallback to key 0 (earliest expiry)
  const fallback = acquireKey("openai", keys);
  assert.equal(fallback.keyIndex, 0);
  assert.equal(fallback.inCooldown, true);
  assert.ok(fallback.cooldownRemainingMs > 0);
  releaseKey("openai", fallback.keyIndex);
});

test("key-scheduler: all keys invalid returns null", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2"];

  applyFailureOutcome("openai", 0, { invalidateKey: true });
  applyFailureOutcome("openai", 1, { invalidateKey: true });

  const result = acquireKey("openai", keys);
  assert.equal(result, null);
});

test("key-scheduler: excludeIndices prevents re-selecting already attempted keys", () => {
  resetScheduler();
  const keys = ["sk-key-1", "sk-key-2", "sk-key-3"];

  // Exclude key 0 (already attempted in current request)
  const result = acquireKey("openai", keys, { excludeIndices: [0] });
  assert.equal(result.keyIndex, 1);
  releaseKey("openai", result.keyIndex);

  // Exclude key 0 and key 1
  const result2 = acquireKey("openai", keys, { excludeIndices: [0, 1] });
  assert.equal(result2.keyIndex, 2);
  releaseKey("openai", result2.keyIndex);

  // Exclude all keys
  const result3 = acquireKey("openai", keys, { excludeIndices: [0, 1, 2] });
  assert.equal(result3, null);
});

test("key-scheduler: applySuccessOutcome clears failure count and resets healthy status", () => {
  resetScheduler();
  const keys = ["sk-key-1"];

  applyFailureOutcome("openai", 0, { cooldownMs: 10000 });
  assert.equal(getKeyPoolStatus("openai", keys)[0].status, "cooldown");

  applySuccessOutcome("openai", 0);
  const status = getKeyPoolStatus("openai", keys)[0];
  assert.equal(status.status, "healthy");
  assert.equal(status.cooldownRemainingMs, 0);
  assert.equal(status.failureCount, 0);
});
