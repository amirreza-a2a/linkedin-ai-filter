// src/background/service-worker.js
import { getProviderFn } from "../llm/factory.js";
import {
  getSettings,
  getCachedDecisions,
  setCachedDecisions,
  incrementAndCheckDailyCap,
  buildCacheKey,
  CACHE_VERSION,
} from "../storage/rules-store.js";
import { appendLogEntries } from "../storage/log-store.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CLASSIFY_POSTS") return false;

  const posts = Array.isArray(message.posts) ? message.posts : [];

  handleClassify(posts)
    .then((results) => {
      try {
        sendResponse({ ok: true, results });
      } catch (err) {
        console.warn("[FeedRule] sendResponse failed:", err);
      }
    })
    .catch((err) => {
      console.error("[FeedRule] classify failed:", err);
      try {
        sendResponse({
          ok: false,
          error: String(err),
          results: posts.map((p) => ({ id: p.id, hide: false, reason: "error-fail-open", topics: [] })),
        });
      } catch (sendErr) {
        console.warn("[FeedRule] sendResponse catch failed:", sendErr);
      }
    });

  return true; // keep the message channel open for async sendResponse
});

async function logResults(posts, results, provider, rulesText) {
  const byId = new Map(posts.map((p) => [String(p.id), p]));
  const entries = [];
  for (const r of results) {
    const post = byId.get(String(r.id));
    if (!post) continue;
    entries.push({
      id: r.id,
      textSnippet: post.text.slice(0, 200),
      hide: r.hide === true,
      reason: r.reason || "",
      topics: Array.isArray(r.topics) ? r.topics : [],
      provider,
      rulesText,
    });
  }
  if (entries.length > 0) {
    await appendLogEntries(entries);
  }
}

async function handleClassify(posts) {
  const settings = await getSettings();

  if (!settings.enabled || !settings.rulesText?.trim()) {
    const results = posts.map((p) => ({ id: p.id, hide: false, reason: "disabled-or-no-rules", topics: [] }));
    await logResults(posts, results, settings.provider, settings.rulesText);
    return results;
  }

  const provider = settings.provider || "openai";
  const model = settings.model?.[provider] || "";
  const rulesText = settings.rulesText || "";
  const baseUrl = settings.baseUrl?.[provider] || "";
  const apiKey = settings.apiKeys?.[provider] || "";

  // Check cache first in a single batch read using isolated cache keys
  const results = new Array(posts.length);
  const uncached = [];
  const hashes = await Promise.all(
    posts.map((p) =>
      buildCacheKey({
        version: CACHE_VERSION,
        provider,
        model,
        rulesText,
        text: p.text,
      })
    )
  );

  const cachedMap = await getCachedDecisions(hashes);
  for (let i = 0; i < posts.length; i++) {
    const cached = cachedMap[hashes[i]];
    if (cached) {
      results[i] = {
        id: posts[i].id,
        hide: cached.hide === true,
        reason: cached.reason || "",
        topics: Array.isArray(cached.topics) ? cached.topics : [],
      };
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
      results[index] = { id: post.id, hide: false, reason: "daily-cap-reached", topics: [] };
    });
    await logResults(posts, results, settings.provider, settings.rulesText);
    return results;
  }

  const classifyFn = getProviderFn(provider);

  const apiResults = await classifyFn({
    apiKey,
    model,
    baseUrl,
    rulesText,
    posts: uncached.map((u) => u.post),
  });

  const safeResults = Array.isArray(apiResults) ? apiResults : [];
  const byId = new Map(safeResults.map((r) => [String(r.id), r]));
  const toCache = {};

  for (const { index, post, hash } of uncached) {
    const r = byId.get(String(post.id)) || { hide: false, reason: "missing", topics: [] };
    const decision = {
      id: post.id,
      hide: r.hide === true,
      reason: typeof r.reason === "string" ? r.reason : "",
      topics: Array.isArray(r.topics) ? r.topics : [],
    };
    results[index] = decision;
    toCache[hash] = {
      hide: decision.hide,
      reason: decision.reason,
      topics: decision.topics,
    };
  }

  await setCachedDecisions(toCache);
  await logResults(posts, results, settings.provider, settings.rulesText);
  return results;
}
