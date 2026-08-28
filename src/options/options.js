// src/options/options.js
import { getSettings, setSettings } from "../storage/rules-store.js";
import { validateAndNormalizeBaseUrl, getRequiredOriginPattern } from "../llm/url-helper.js";

const els = {
  provider: document.getElementById("provider"),
  openaiKey: document.getElementById("openaiKey"),
  openaiModel: document.getElementById("openaiModel"),
  openaiBaseUrl: document.getElementById("openaiBaseUrl"),
  geminiKey: document.getElementById("geminiKey"),
  geminiModel: document.getElementById("geminiModel"),
  geminiBaseUrl: document.getElementById("geminiBaseUrl"),
  claudeKey: document.getElementById("claudeKey"),
  claudeModel: document.getElementById("claudeModel"),
  claudeBaseUrl: document.getElementById("claudeBaseUrl"),
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
  els.openaiBaseUrl.value = s.baseUrl?.openai || "";
  els.geminiBaseUrl.value = s.baseUrl?.gemini || "";
  els.claudeBaseUrl.value = s.baseUrl?.claude || "";
  els.dailyCap.value = s.dailyCallCap;
}

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.style.color = isError ? "#c00" : "#2a8a3a";
  if (!isError) {
    setTimeout(() => {
      if (els.status.textContent === msg) els.status.textContent = "";
    }, 2500);
  }
}

document.getElementById("save").addEventListener("click", async () => {
  // 1. Validate Base URLs
  let openaiBase = "";
  let geminiBase = "";
  let claudeBase = "";

  try {
    openaiBase = validateAndNormalizeBaseUrl(els.openaiBaseUrl.value);
  } catch (err) {
    setStatus(`OpenAI Base URL: ${err.message}`, true);
    return;
  }

  try {
    geminiBase = validateAndNormalizeBaseUrl(els.geminiBaseUrl.value);
  } catch (err) {
    setStatus(`Gemini Base URL: ${err.message}`, true);
    return;
  }

  try {
    claudeBase = validateAndNormalizeBaseUrl(els.claudeBaseUrl.value);
  } catch (err) {
    setStatus(`Claude Base URL: ${err.message}`, true);
    return;
  }

  // 2. Request host permission for active custom endpoint if not already granted
  const selectedProvider = els.provider.value;
  const activeBaseUrl =
    selectedProvider === "openai"
      ? openaiBase
      : selectedProvider === "gemini"
      ? geminiBase
      : claudeBase;

  if (activeBaseUrl) {
    const requiredPattern = getRequiredOriginPattern(activeBaseUrl);
    if (requiredPattern && chrome?.permissions?.contains && chrome?.permissions?.request) {
      try {
        const hasPerm = await chrome.permissions.contains({ origins: [requiredPattern] });
        if (!hasPerm) {
          const granted = await chrome.permissions.request({ origins: [requiredPattern] });
          if (!granted) {
            setStatus(`Permission denied for ${requiredPattern}. Settings not saved.`, true);
            return;
          }
        }
      } catch (permErr) {
        console.warn("[FeedRule] Runtime permission error:", permErr);
      }
    }
  }

  // 3. Persist settings
  await setSettings({
    provider: els.provider.value,
    model: {
      openai: els.openaiModel.value.trim() || "gpt-4o-mini",
      gemini: els.geminiModel.value.trim() || "gemini-3.5-flash",
      claude: els.claudeModel.value.trim() || "claude-haiku-4-5-20251001",
    },
    baseUrl: {
      openai: openaiBase,
      gemini: geminiBase,
      claude: claudeBase,
    },
    dailyCallCap: parseInt(els.dailyCap.value, 10) || 500,
    apiKeys: {
      openai: els.openaiKey.value.trim(),
      gemini: els.geminiKey.value.trim(),
      claude: els.claudeKey.value.trim(),
    },
  });

  setStatus("Saved ✓", false);
});

load();
