import test from "node:test";
import assert from "node:assert/strict";
import { parseClassificationResponse } from "../src/llm/provider-base.js";

test("parseClassificationResponse - parses standard JSON array with topics", () => {
  const raw = JSON.stringify([
    { id: "post1", hide: true, reason: "spam", topics: ["Recruiting", "Hiring"] },
    { id: "post2", hide: false, reason: "tech post", topics: ["AI", "Semiconductors"] },
  ]);
  const posts = [{ id: "post1", text: "t1" }, { id: "post2", text: "t2" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 2);
  assert.equal(res[0].hide, true);
  assert.equal(res[0].reason, "spam");
  assert.deepEqual(res[0].topics, ["Recruiting", "Hiring"]);

  assert.equal(res[1].hide, false);
  assert.equal(res[1].reason, "tech post");
  assert.deepEqual(res[1].topics, ["AI", "Semiconductors"]);
});

test("parseClassificationResponse - strict boolean parsing & topic defaults", () => {
  const raw = JSON.stringify([
    { id: "p1", hide: true, reason: "boolean true", topics: ["AI", "ai", "5G"] },
    { id: "p2", hide: false, reason: "boolean false" }, // missing topics
    { id: "p3", hide: "true", reason: "string true", topics: null },
    { id: "p4", hide: "false", reason: "string false", topics: "not-an-array" },
    { id: "p5", hide: null, reason: "null hide", topics: [123, true] },
    { id: "p6", hide: 0, reason: "numeric 0", topics: [] },
    { id: "p7", hide: 1, reason: "numeric 1", topics: [" Cloud ", ""] },
  ]);
  const posts = [
    { id: "p1", text: "t1" },
    { id: "p2", text: "t2" },
    { id: "p3", text: "t3" },
    { id: "p4", text: "t4" },
    { id: "p5", text: "t5" },
    { id: "p6", text: "t6" },
    { id: "p7", text: "t7" },
  ];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.find((r) => r.id === "p1").hide, true);
  assert.deepEqual(res.find((r) => r.id === "p1").topics, ["AI", "5G"]);

  assert.equal(res.find((r) => r.id === "p2").hide, false);
  assert.deepEqual(res.find((r) => r.id === "p2").topics, []);

  assert.equal(res.find((r) => r.id === "p3").hide, false);
  assert.deepEqual(res.find((r) => r.id === "p3").topics, []);

  assert.equal(res.find((r) => r.id === "p4").hide, false);
  assert.deepEqual(res.find((r) => r.id === "p4").topics, []);

  assert.equal(res.find((r) => r.id === "p5").hide, false);
  assert.deepEqual(res.find((r) => r.id === "p5").topics, []);

  assert.equal(res.find((r) => r.id === "p6").hide, false);
  assert.deepEqual(res.find((r) => r.id === "p6").topics, []);

  assert.equal(res.find((r) => r.id === "p7").hide, false);
  assert.deepEqual(res.find((r) => r.id === "p7").topics, ["Cloud"]);
});

test("parseClassificationResponse - strips DeepSeek R1 <think> blocks and markdown fences", () => {
  const raw = `<think>
I need to classify these posts and extract subject matter topics.
Post 1 is recruiter spam.
Post 2 is interesting AI news.
</think>
\`\`\`json
[
  {"id": "p1", "hide": true, "reason": "recruiter spam", "topics": ["Recruiting"]},
  {"id": "p2", "hide": false, "reason": "ai news", "topics": ["AI", "Deep Learning"]}
]
\`\`\``;
  const posts = [{ id: "p1", text: "t1" }, { id: "p2", text: "t2" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 2);
  assert.equal(res[0].hide, true);
  assert.equal(res[0].reason, "recruiter spam");
  assert.deepEqual(res[0].topics, ["Recruiting"]);

  assert.equal(res[1].hide, false);
  assert.deepEqual(res[1].topics, ["AI", "Deep Learning"]);
});

test("parseClassificationResponse - handles wrapped object { posts: [...] }", () => {
  const raw = JSON.stringify({
    posts: [{ id: "p1", hide: true, reason: "crypto", topics: ["Cryptocurrency", "Finance"] }],
  });
  const posts = [{ id: "p1", text: "crypto" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 1);
  assert.equal(res[0].hide, true);
  assert.equal(res[0].reason, "crypto");
  assert.deepEqual(res[0].topics, ["Cryptocurrency", "Finance"]);
});

test("parseClassificationResponse - fails open on malformed output", () => {
  const raw = "I am an LLM and I refuse to classify.";
  const posts = [{ id: "p1", text: "t1" }, { id: "p2", text: "t2" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 2);
  assert.equal(res[0].hide, false);
  assert.equal(res[0].reason, "parse-error-fail-open");
  assert.deepEqual(res[0].topics, []);
  assert.equal(res[1].hide, false);
  assert.equal(res[1].reason, "parse-error-fail-open");
  assert.deepEqual(res[1].topics, []);
});
