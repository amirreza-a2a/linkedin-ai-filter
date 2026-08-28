import test from "node:test";
import assert from "node:assert/strict";
import { parseClassificationResponse } from "../src/llm/provider-base.js";

test("parseClassificationResponse - parses standard JSON array", () => {
  const raw = JSON.stringify([
    { id: "post1", hide: true, reason: "spam" },
    { id: "post2", hide: false, reason: "tech post" },
  ]);
  const posts = [{ id: "post1", text: "t1" }, { id: "post2", text: "t2" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 2);
  assert.equal(res[0].hide, true);
  assert.equal(res[0].reason, "spam");
  assert.equal(res[1].hide, false);
});

test("parseClassificationResponse - strips DeepSeek R1 <think> blocks and markdown fences", () => {
  const raw = `<think>
I need to classify these posts based on user rules.
Post 1 looks like recruiter spam.
Post 2 is interesting AI news.
</think>
\`\`\`json
[
  {"id": "p1", "hide": true, "reason": "recruiter spam"},
  {"id": "p2", "hide": false, "reason": "ai news"}
]
\`\`\``;
  const posts = [{ id: "p1", text: "t1" }, { id: "p2", text: "t2" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 2);
  assert.equal(res[0].hide, true);
  assert.equal(res[0].reason, "recruiter spam");
  assert.equal(res[1].hide, false);
});

test("parseClassificationResponse - handles wrapped object { posts: [...] }", () => {
  const raw = JSON.stringify({
    posts: [{ id: "p1", hide: true, reason: "crypto" }],
  });
  const posts = [{ id: "p1", text: "crypto" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 1);
  assert.equal(res[0].hide, true);
  assert.equal(res[0].reason, "crypto");
});

test("parseClassificationResponse - fails open on malformed output", () => {
  const raw = "I am an LLM and I refuse to classify.";
  const posts = [{ id: "p1", text: "t1" }, { id: "p2", text: "t2" }];
  const res = parseClassificationResponse(raw, posts);

  assert.equal(res.length, 2);
  assert.equal(res[0].hide, false);
  assert.equal(res[0].reason, "parse-error-fail-open");
  assert.equal(res[1].hide, false);
  assert.equal(res[1].reason, "parse-error-fail-open");
});
