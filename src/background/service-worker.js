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
import { evaluateSaveRules } from "../rules/save-rule-engine.js";
import {
  savePost,
  savePostsBatch,
  unsavePost,
  getSavedPosts,
  isPostSaved,
} from "../storage/saved-posts-store.js";
import { logger } from "../utils/logger.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  switch (message.type) {
    case "CLASSIFY_POSTS": {
      const posts = Array.isArray(message.posts) ? message.posts : [];
      handleClassify(posts)
        .then((results) => {
          try {
            sendResponse({ ok: true, results });
          } catch (err) {
            logger.warn("SW", "sendResponse failed:", err);
          }
        })
        .catch((err) => {
          logger.error("SW", "classify failed:", err);
          try {
            sendResponse({
              ok: false,
              error: String(err),
              results: posts.map((p) => ({
                id: p.id,
                hide: false,
                reason: "error-fail-open",
                topics: [],
                saved: false,
                saveReason: "",
                autoSaved: false,
              })),
            });
          } catch (sendErr) {
            logger.warn("SW", "sendResponse catch failed:", sendErr);
          }
        });
      return true; // keep channel open
    }

    case "SAVE_POST": {
      if (!message.post || !message.post.id) {
        sendResponse({ ok: false, error: "Missing post payload or post.id" });
        return false;
      }
      savePost({
        ...message.post,
        autoSaved: message.post.autoSaved === true,
        saveReason: message.post.saveReason || "Manual save",
      })
        .then((savedPost) => sendResponse({ ok: true, post: savedPost }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    case "UNSAVE_POST": {
      if (!message.id) {
        sendResponse({ ok: false, error: "Missing post id" });
        return false;
      }
      unsavePost(message.id)
        .then((removed) => sendResponse({ ok: true, removed }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    case "GET_SAVED_POSTS": {
      getSavedPosts(message.filter || {})
        .then((posts) => sendResponse({ ok: true, posts }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    case "IS_POST_SAVED": {
      isPostSaved(message.id)
        .then((saved) => sendResponse({ ok: true, saved }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    default:
      return false;
  }
});

async function logResults(posts, results, provider, model, rulesText) {
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
      saved: r.saved === true,
      saveReason: r.saveReason || "",
      autoSaved: r.autoSaved === true,
      provider,
      model,
      rulesText,
    });
  }
  if (entries.length > 0) {
    await appendLogEntries(entries);
  }
}

async function handleClassify(posts) {
  const settings = await getSettings();

  const provider = settings.provider || "openai";
  const model = settings.model?.[provider] || "";
  const rulesText = settings.rulesText || "";
  const saveRulesText = settings.saveRulesText || "";
  const baseUrl = settings.baseUrl?.[provider] || "";
  const apiKey = settings.apiKeys?.[provider] || "";

  if (!settings.enabled || !rulesText.trim()) {
    const results = posts.map((p) => ({
      id: p.id,
      hide: false,
      reason: "disabled-or-no-rules",
      topics: [],
      saved: false,
      saveReason: "",
      autoSaved: false,
    }));
    await logResults(posts, results, provider, model, rulesText);
    return results;
  }

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
      const topics = Array.isArray(cached.topics) ? cached.topics : [];
      const saveEval = evaluateSaveRules(topics, saveRulesText);
      results[i] = {
        id: posts[i].id,
        hide: cached.hide === true,
        reason: cached.reason || "",
        topics,
        saved: saveEval.shouldSave,
        saveReason: saveEval.saveReason,
        autoSaved: saveEval.shouldSave,
      };
    } else {
      uncached.push({ index: i, post: posts[i], hash: hashes[i] });
    }
  }

  // If there are uncached posts, query the LLM provider
  if (uncached.length > 0) {
    const withinCap = await incrementAndCheckDailyCap(settings.dailyCallCap);
    if (!withinCap) {
      uncached.forEach(({ index, post }) => {
        results[index] = {
          id: post.id,
          hide: false,
          reason: "daily-cap-reached",
          topics: [],
          saved: false,
          saveReason: "",
          autoSaved: false,
        };
      });
    } else {
      // Deduplicate uncached posts by hash within the batch to avoid duplicate LLM calls
      const uniqueUncached = [];
      const hashToIndices = new Map();
      for (const item of uncached) {
        if (!hashToIndices.has(item.hash)) {
          hashToIndices.set(item.hash, [item.index]);
          uniqueUncached.push(item);
        } else {
          hashToIndices.get(item.hash).push(item.index);
        }
      }

      const classifyFn = getProviderFn(provider);
      const apiResults = await classifyFn({
        apiKey,
        model,
        baseUrl,
        rulesText,
        posts: uniqueUncached.map((u) => u.post),
      });

      const safeResults = Array.isArray(apiResults) ? apiResults : [];
      const byId = new Map(safeResults.map((r) => [String(r.id), r]));
      const toCache = {};

      for (const { post, hash } of uniqueUncached) {
        const r = byId.get(String(post.id)) || { hide: false, reason: "missing", topics: [] };
        const topics = Array.isArray(r.topics) ? r.topics : [];
        const saveEval = evaluateSaveRules(topics, saveRulesText);

        const targetIndices = hashToIndices.get(hash) || [];
        for (const idx of targetIndices) {
          results[idx] = {
            id: posts[idx].id,
            hide: r.hide === true,
            reason: typeof r.reason === "string" ? r.reason : "",
            topics,
            saved: saveEval.shouldSave,
            saveReason: saveEval.saveReason,
            autoSaved: saveEval.shouldSave,
          };
        }

        toCache[hash] = {
          hide: r.hide === true,
          reason: typeof r.reason === "string" ? r.reason : "",
          topics,
        };
      }

      await setCachedDecisions(toCache);
    }
  }

  // Evaluate and automatically persist any posts that match save rules
  const postsToAutoSave = [];
  const byPostId = new Map(posts.map((p) => [String(p.id), p]));

  for (const r of results) {
    if (r.saved) {
      const originalPost = byPostId.get(String(r.id));
      if (originalPost) {
        postsToAutoSave.push({
          id: r.id,
          text: originalPost.text,
          author: originalPost.author || "",
          authorUrl: originalPost.authorUrl || "",
          postUrl: originalPost.postUrl || "",
          topics: r.topics,
          saveReason: r.saveReason,
          autoSaved: true,
        });
      }
    }
  }

  if (postsToAutoSave.length > 0) {
    await savePostsBatch(postsToAutoSave);
  }

  await logResults(posts, results, provider, model, rulesText);
  return results;
}
