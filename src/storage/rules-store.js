// src/storage/rules-store.js
// Thin wrapper around chrome.storage. API keys stay in `local` only
// (never synced to Google's cloud). Rules can sync across devices.

const DEFAULTS = {
  enabled: true,
  rulesText: "", // e.g. "Hide: recruiter spam, humble-brag posts, crypto ads"
  saveRulesText: "", // e.g. "AI, 5G, Embedded Systems, Semiconductors"
  provider: "openai", // "openai" | "gemini" | "claude"
  model: {
    openai: "gpt-4o-mini",
    gemini: "gemini-3.5-flash",
    claude: "claude-haiku-4-5-20251001",
  },
  baseUrl: {
    openai: "",
    gemini: "",
    claude: "",
  },
  dailyCallCap: 500, // safety guardrail, requests not tokens
};

export const CACHE_VERSION = 3;

export async function buildCacheKey({
  version = CACHE_VERSION,
  provider = "",
  model = "",
  rulesText = "",
  text = "",
}) {
  const payload = JSON.stringify([
    version,
    String(provider).trim(),
    String(model).trim(),
    String(rulesText).trim(),
    String(text),
  ]);
  return simpleHash(payload);
}

export async function getSettings() {
  const synced = (await chrome.storage.sync.get([
    "enabled",
    "rulesText",
    "saveRulesText",
    "provider",
    "model",
    "baseUrl",
    "dailyCallCap",
  ])) || {};
  const local = (await chrome.storage.local.get(["apiKeys"])) || {};

  const syncedModel =
    typeof synced.model === "object" && synced.model !== null && !Array.isArray(synced.model)
      ? synced.model
      : {};
  const syncedBaseUrl =
    typeof synced.baseUrl === "object" && synced.baseUrl !== null && !Array.isArray(synced.baseUrl)
      ? synced.baseUrl
      : {};
  const localApiKeys =
    typeof local.apiKeys === "object" && local.apiKeys !== null && !Array.isArray(local.apiKeys)
      ? local.apiKeys
      : {};

  return {
    enabled: synced.enabled ?? DEFAULTS.enabled,
    rulesText: typeof synced.rulesText === "string" ? synced.rulesText : DEFAULTS.rulesText,
    saveRulesText: typeof synced.saveRulesText === "string" ? synced.saveRulesText : DEFAULTS.saveRulesText,
    provider: typeof synced.provider === "string" ? synced.provider : DEFAULTS.provider,
    model: { ...DEFAULTS.model, ...syncedModel },
    baseUrl: { ...DEFAULTS.baseUrl, ...syncedBaseUrl },
    dailyCallCap: typeof synced.dailyCallCap === "number" ? synced.dailyCallCap : DEFAULTS.dailyCallCap,
    apiKeys: localApiKeys,
  };
}

export async function setSettings(partial) {
  const { apiKeys, ...rest } = partial;
  if (Object.keys(rest).length) {
    await chrome.storage.sync.set(rest);
  }
  if (apiKeys) {
    const current = (await chrome.storage.local.get(["apiKeys"])).apiKeys || {};
    await chrome.storage.local.set({ apiKeys: { ...current, ...apiKeys } });
  }
}

// --- Decision cache: hash(version + provider + model + rulesText + postText) -> {hide, reason, topics, ts} ---
// Avoids re-billing the API when the same post scrolls back into view under identical configuration.

export async function getCachedDecision(hash) {
  const key = `cache:${hash}`;
  const result = await chrome.storage.local.get([key]);
  return result[key] || null;
}

export async function getCachedDecisions(hashes) {
  if (!hashes || hashes.length === 0) return {};
  const keys = hashes.map((h) => `cache:${h}`);
  const result = await chrome.storage.local.get(keys);
  const out = {};
  for (const h of hashes) {
    out[h] = result[`cache:${h}`] || null;
  }
  return out;
}

export async function setCachedDecision(hash, decision) {
  const key = `cache:${hash}`;
  await chrome.storage.local.set({ [key]: { ...decision, ts: Date.now() } });
}

export async function setCachedDecisions(map) {
  const toStore = {};
  const now = Date.now();
  for (const [hash, decision] of Object.entries(map)) {
    toStore[`cache:${hash}`] = { ...decision, ts: now };
  }
  if (Object.keys(toStore).length > 0) {
    await chrome.storage.local.set(toStore);
  }
}

// --- Daily call counter, resets at local midnight ---

export async function incrementAndCheckDailyCap(cap) {
  const today = new Date().toISOString().slice(0, 10);
  const { dailyUsage } = await chrome.storage.local.get(["dailyUsage"]);
  const usage = dailyUsage && dailyUsage.date === today ? dailyUsage.count : 0;
  const next = usage + 1;
  await chrome.storage.local.set({ dailyUsage: { date: today, count: next } });
  return next <= cap;
}

export async function simpleHash(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
