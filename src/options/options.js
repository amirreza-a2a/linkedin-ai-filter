import { getSettings, setSettings } from "../storage/rules-store.js";

const els = {
  provider: document.getElementById("provider"),
  openaiKey: document.getElementById("openaiKey"),
  openaiModel: document.getElementById("openaiModel"),
  geminiKey: document.getElementById("geminiKey"),
  geminiModel: document.getElementById("geminiModel"),
  claudeKey: document.getElementById("claudeKey"),
  claudeModel: document.getElementById("claudeModel"),
  dailyCap: document.getElementById("dailyCap"),
  status: document.getElementById("status"),
};

async function load() {
  const s = await getSettings();
  els.provider.value = s.provider;
  els.openaiKey.value = s.apiKeys.openai || "";
  els.geminiKey.value = s.apiKeys.gemini || "";
  els.claudeKey.value = s.apiKeys.claude || "";
  els.openaiModel.value = s.model.openai;
  els.geminiModel.value = s.model.gemini;
  els.claudeModel.value = s.model.claude;
  els.dailyCap.value = s.dailyCallCap;
}

document.getElementById("save").addEventListener("click", async () => {
  await setSettings({
    provider: els.provider.value,
    model: {
      openai: els.openaiModel.value.trim() || "gpt-4o-mini",
      gemini: els.geminiModel.value.trim() || "gemini-3.5-flash",
      claude: els.claudeModel.value.trim() || "claude-haiku-4-5-20251001",
    },
    dailyCallCap: parseInt(els.dailyCap.value, 10) || 500,
    apiKeys: {
      openai: els.openaiKey.value.trim(),
      gemini: els.geminiKey.value.trim(),
      claude: els.claudeKey.value.trim(),
    },
  });
  els.status.textContent = "Saved ✓";
  setTimeout(() => (els.status.textContent = ""), 2000);
});

load();
