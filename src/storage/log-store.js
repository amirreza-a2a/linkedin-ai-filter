// src/storage/log-store.js
// Rolling log of every filter decision, for the dashboard to display.
// Keyed by post id so re-seeing the same post updates it in place instead
// of duplicating entries. Capped so chrome.storage.local doesn't grow
// unbounded (LinkedIn's infinite-scroll feed can produce a lot of posts).

const LOG_KEY = "decisionLog";
const MAX_ENTRIES = 500;

export async function appendLogEntries(entries) {
  if (!entries || entries.length === 0) return;
  const { [LOG_KEY]: log = {} } = await chrome.storage.local.get([LOG_KEY]);
  for (const entry of entries) {
    log[entry.id] = {
      id: entry.id,
      textSnippet: entry.textSnippet,
      hide: entry.hide === true,
      reason: typeof entry.reason === "string" ? entry.reason : "",
      topics: Array.isArray(entry.topics) ? entry.topics : [],
      provider: entry.provider,
      rulesText: entry.rulesText,
      ts: entry.ts || Date.now(),
    };
  }

  const all = Object.values(log).sort((a, b) => b.ts - a.ts);
  const trimmed = all.slice(0, MAX_ENTRIES);
  const trimmedLog = {};
  for (const e of trimmed) trimmedLog[e.id] = e;

  await chrome.storage.local.set({ [LOG_KEY]: trimmedLog });
}

export async function appendLogEntry(entry) {
  return appendLogEntries([entry]);
}

export async function getLogEntries() {
  const { [LOG_KEY]: log = {} } = await chrome.storage.local.get([LOG_KEY]);
  return Object.values(log)
    .sort((a, b) => b.ts - a.ts)
    .map((e) => ({
      ...e,
      hide: e.hide === true,
      reason: e.reason || "",
      topics: Array.isArray(e.topics) ? e.topics : [],
    }));
}

export async function clearLog() {
  await chrome.storage.local.remove([LOG_KEY]);
}
