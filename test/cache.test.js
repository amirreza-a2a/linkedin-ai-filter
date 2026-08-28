import test from "node:test";
import assert from "node:assert/strict";
import { buildCacheKey, CACHE_VERSION } from "../src/storage/rules-store.js";

test("Cache Key Isolation - 1. Same post + same provider/model/rules -> cache hit", async () => {
  const key1 = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  const key2 = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  assert.equal(key1, key2);
});

test("Cache Key Isolation - 2. Same post + different provider -> cache miss", async () => {
  const openAiKey = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "llama3.2",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  const geminiKey = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "gemini",
    model: "llama3.2",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  assert.notEqual(openAiKey, geminiKey);
});

test("Cache Key Isolation - 3. Same post + different model -> cache miss", async () => {
  const gptKey = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  const llamaKey = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "llama3.2",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  assert.notEqual(gptKey, llamaKey);
});

test("Cache Key Isolation - 4. Same post + different rules -> cache miss", async () => {
  const rule1Key = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  const rule2Key = await buildCacheKey({
    version: CACHE_VERSION,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide crypto only",
    text: "Exciting new job opportunity in AI!",
  });

  assert.notEqual(rule1Key, rule2Key);
});

test("Cache Key Isolation - 5. Classification schema/version change -> cache miss", async () => {
  const v2Key = await buildCacheKey({
    version: 2,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  const v3Key = await buildCacheKey({
    version: 3,
    provider: "openai",
    model: "gpt-4o-mini",
    rulesText: "Hide recruiter spam",
    text: "Exciting new job opportunity in AI!",
  });

  assert.notEqual(v2Key, v3Key);
});
