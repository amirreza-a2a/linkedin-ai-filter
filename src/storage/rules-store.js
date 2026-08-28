// src/storage/rules-store.js
// Thin wrapper around chrome.storage. API keys stay in `local` only
// (never synced to Google's cloud). Rules can sync across devices.

const DEFAULTS = {
  enabled: true,
  rulesText: "", // e.g. "Hide: recruiter spam, humble-brag posts, crypto ads"
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

export async function getSettings() {
  const synced = await chrome.storage.sync.get([
    "enabled",
    "rulesText",
    "provider",
    "model",
    "baseUrl",
    "dailyCallCap",
  ]);
  const local = await chrome.storage.local.get(["apiKeys"]);
  return {
    enabled: synced.enabled ?? DEFAULTS.enabled,
    rulesText: synced.rulesText ?? DEFAULTS.rulesText,
    provider: synced.provider ?? DEFAULTS.provider,
    model: { ...DEFAULTS.model, ...(synced.model || {}) },
    baseUrl: { ...DEFAULTS.baseUrl, ...(synced.baseUrl || {}) },
    dailyCallCap: synced.dailyCallCap ?? DEFAULTS.dailyCallCap,
    apiKeys: local.apiKeys || {}, // { openai: "...", gemini: "...", claude: "..." }
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

// --- Decision cache: hash(postText + rulesText) -> {hide, reason, ts} ---
// Avoids re-billing the API when the same post scrolls back into view.

export async function getCachedDecision(hash) {
  const key = `cache:${hash}`;
  const result = await chrome.storage.local.get([key]);
  return result[key] || null;
}

export async function setCachedDecision(hash, decision) {
  const key = `cache:${hash}`;
  await chrome.storage.local.set({ [key]: { ...decision, ts: Date.now() } });
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
