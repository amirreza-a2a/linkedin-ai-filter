import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTopics } from "../src/llm/provider-base.js";

test("normalizeTopics - rejects non-array inputs", () => {
  assert.deepEqual(normalizeTopics(null), []);
  assert.deepEqual(normalizeTopics(undefined), []);
  assert.deepEqual(normalizeTopics(123), []);
  assert.deepEqual(normalizeTopics(true), []);
  assert.deepEqual(normalizeTopics({}), []);
  assert.deepEqual(normalizeTopics("AI"), []);
});

test("normalizeTopics - discards non-string elements without conversion", () => {
  const input = ["AI", 123, true, false, null, undefined, {}, ["nested"], "5G"];
  assert.deepEqual(normalizeTopics(input), ["AI", "5G"]);
});

test("normalizeTopics - trims whitespace and removes empty strings", () => {
  const input = ["  Artificial Intelligence  ", "", "   ", "\tMachine Learning\n", ""];
  assert.deepEqual(normalizeTopics(input), ["Artificial Intelligence", "Machine Learning"]);
});

test("normalizeTopics - deduplicates case-insensitively preserving first casing", () => {
  const input = ["AI", "ai", "Ai", "5G", "5g", "Deep Learning", "deep learning"];
  assert.deepEqual(normalizeTopics(input), ["AI", "5G", "Deep Learning"]);
});

test("normalizeTopics - caps individual topic length at 50 characters", () => {
  const longTopic = "A".repeat(80);
  const result = normalizeTopics([longTopic]);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, 50);
  assert.equal(result[0], "A".repeat(50));
});

test("normalizeTopics - caps total topics at 5 per post", () => {
  const input = ["Topic 1", "Topic 2", "Topic 3", "Topic 4", "Topic 5", "Topic 6", "Topic 7"];
  assert.deepEqual(normalizeTopics(input), [
    "Topic 1",
    "Topic 2",
    "Topic 3",
    "Topic 4",
    "Topic 5",
  ]);
});
