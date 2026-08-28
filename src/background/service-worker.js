// src/background/service-worker.js
import { getProviderFn } from "../llm/factory.js";
import {
  getSettings,
  getCachedDecision,
  setCachedDecision,
  incrementAndCheckDailyCap,
  simpleHash,
} from "../storage/rules-store.js";
import { appendLogEntry } from "../storage/log-store.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CLASSIFY_POSTS") return false;
  handleClassify(message.posts)
    .then((results) => sendResponse({ ok: true, results }))
    .catch((err) => {
      console.error("[FeedRule] classify failed:", err);
      // Fail open: never hide posts because of an error
      sendResponse({
        ok: false,
        error: String(err),
        results: message.posts.map((p) => ({ id: p.id, hide: false, reason: "error-fail-open" })),
      });
    });
  return true; // keep the message channel open for async sendResponse
});

async function logResults(posts, results, provider, rulesText) {
  const byId = new Map(posts.map((p) => [String(p.id), p]));
  for (const r of results) {
    const post = byId.get(String(r.id));
    if (!post) continue;
    await appendLogEntry({
      id: r.id,
      textSnippet: post.text.slice(0, 200),
      hide: r.hide,
      reason: r.reason,
      provider,
      rulesText,
    });
  }
}

async function handleClassify(posts) {
  const settings = await getSettings();

  if (!settings.enabled || !settings.rulesText?.trim()) {
    const results = posts.map((p) => ({ id: p.id, hide: false, reason: "disabled-or-no-rules" }));
    await logResults(posts, results, settings.provider, settings.rulesText);
    return results;
  }

  // Check cache first, only send uncached posts to the API
  const results = new Array(posts.length);
  const uncached = [];
  const hashes = await Promise.all(
    posts.map((p) => simpleHash(`${settings.rulesText}::${p.text}`))
  );

  for (let i = 0; i < posts.length; i++) {
    const cached = await getCachedDecision(hashes[i]);
    if (cached) {
      results[i] = { id: posts[i].id, hide: cached.hide, reason: cached.reason };
    } else {
      uncached.push({ index: i, post: posts[i], hash: hashes[i] });
    }
  }

  if (uncached.length === 0) {
    await logResults(posts, results, settings.provider, settings.rulesText);
    return results;
  }

  const withinCap = await incrementAndCheckDailyCap(settings.dailyCallCap);
  if (!withinCap) {
    uncached.forEach(({ index, post }) => {
      results[index] = { id: post.id, hide: false, reason: "daily-cap-reached" };
    });
    await logResults(posts, results, settings.provider, settings.rulesText);
    return results;
  }

  const classifyFn = getProviderFn(settings.provider);
  const model = settings.model?.[settings.provider];
  const baseUrl = settings.baseUrl?.[settings.provider] || "";
  const apiKey = settings.apiKeys?.[settings.provider] || "";

  const apiResults = await classifyFn({
    apiKey,
    model,
    baseUrl,
    rulesText: settings.rulesText,
    posts: uncached.map((u) => u.post),
  });

  const byId = new Map(apiResults.map((r) => [String(r.id), r]));
  for (const { index, post, hash } of uncached) {
    const r = byId.get(String(post.id)) || { hide: false, reason: "missing" };
    results[index] = { id: post.id, hide: r.hide, reason: r.reason };
    await setCachedDecision(hash, { hide: r.hide, reason: r.reason });
  }

  await logResults(posts, results, settings.provider, settings.rulesText);
  return results;
}
