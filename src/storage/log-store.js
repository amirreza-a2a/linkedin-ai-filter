// src/storage/log-store.js
// Rolling log of every filter decision, for the dashboard to display.
// Keyed by post id so re-seeing the same post updates it in place instead
// of duplicating entries. Capped so local storage doesn't grow
// unbounded (LinkedIn's infinite-scroll feed can produce a lot of posts).

import { browserApi } from "../utils/browser.js";

const LOG_KEY = "decisionLog";
const MAX_ENTRIES = 500;

export async function appendLogEntries(entries) {
  if (!entries || entries.length === 0) return;
  const localStore = browserApi?.storage?.local;
  if (!localStore) return;

  const { [LOG_KEY]: log = {} } = await localStore.get([LOG_KEY]);
  for (const entry of entries) {
    log[entry.id] = {
      id: String(entry.id || "").trim(),
      textSnippet: String(entry.textSnippet || "").trim().slice(0, 200),
      hide: entry.hide === true,
      reason: typeof entry.reason === "string" ? entry.reason : "",
      topics: Array.isArray(entry.topics) ? entry.topics.filter((t) => typeof t === "string") : [],
      saved: entry.saved === true,
      saveReason: typeof entry.saveReason === "string" ? entry.saveReason : "",
      autoSaved: entry.autoSaved === true,
      provider: typeof entry.provider === "string" ? entry.provider : "",
      model: typeof entry.model === "string" ? entry.model : "",
      rulesText: typeof entry.rulesText === "string" ? entry.rulesText : "",
      ts: typeof entry.ts === "number" && !isNaN(entry.ts) ? entry.ts : Date.now(),
    };
  }

  const all = Object.values(log).sort((a, b) => b.ts - a.ts);
  const trimmed = all.slice(0, MAX_ENTRIES);
  const trimmedLog = {};
  for (const e of trimmed) trimmedLog[e.id] = e;

  await localStore.set({ [LOG_KEY]: trimmedLog });
}

export async function appendLogEntry(entry) {
  return appendLogEntries([entry]);
}

export async function getLogEntries() {
  const localStore = browserApi?.storage?.local;
  if (!localStore) return [];

  const { [LOG_KEY]: log = {} } = await localStore.get([LOG_KEY]);
  return Object.values(log)
    .sort((a, b) => b.ts - a.ts)
    .map((e) => ({
      ...e,
      id: String(e.id || ""),
      textSnippet: String(e.textSnippet || ""),
      hide: e.hide === true,
      reason: e.reason || "",
      topics: Array.isArray(e.topics) ? e.topics : [],
      saved: e.saved === true,
      saveReason: e.saveReason || "",
      autoSaved: e.autoSaved === true,
      provider: e.provider || "openai",
      model: e.model || "",
      rulesText: e.rulesText || "",
      ts: typeof e.ts === "number" && !isNaN(e.ts) ? e.ts : Date.now(),
    }));
}

export async function clearLog() {
  const localStore = browserApi?.storage?.local;
  if (localStore) {
    await localStore.remove([LOG_KEY]);
  }
}
