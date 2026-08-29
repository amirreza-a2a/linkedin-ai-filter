// src/options/options.js
import { getSettings, setSettings } from "../storage/rules-store.js";
import { validateAndNormalizeBaseUrl, getRequiredOriginPattern } from "../llm/url-helper.js";
import {
  clearSavedPostsData,
  clearDecisionLogData,
  clearClassificationCache,
  clearAllLocalData,
} from "../storage/data-management.js";
import { logger } from "../utils/logger.js";

const getEl = (id) => (typeof document !== "undefined" ? document.getElementById(id) : null);

export const els = {
  get provider() { return getEl("provider"); },
  get openaiKey() { return getEl("openaiKey"); },
  get openaiModel() { return getEl("openaiModel"); },
  get openaiBaseUrl() { return getEl("openaiBaseUrl"); },
  get geminiKey() { return getEl("geminiKey"); },
  get geminiModel() { return getEl("geminiModel"); },
  get geminiBaseUrl() { return getEl("geminiBaseUrl"); },
  get claudeKey() { return getEl("claudeKey"); },
  get claudeModel() { return getEl("claudeModel"); },
  get claudeBaseUrl() { return getEl("claudeBaseUrl"); },
  get dailyCap() { return getEl("dailyCap"); },
  get status() { return getEl("status"); },
  get dataStatus() { return getEl("dataStatus"); },
  get clearSavedBtn() { return getEl("clearSavedBtn"); },
  get clearLogBtn() { return getEl("clearLogBtn"); },
  get clearCacheBtn() { return getEl("clearCacheBtn"); },
  get clearAllBtn() { return getEl("clearAllBtn"); },
  get saveBtn() { return getEl("save"); },
};

/**
 * Updates DOM visibility to display only the active provider's configuration section.
 * Uses the HTML `hidden` attribute so inactive sections are both visually hidden and non-focusable.
 *
 * @param {string} activeProvider - "openai" | "gemini" | "claude"
 */
export function updateProviderVisibility(activeProvider) {
  if (typeof document === "undefined") return;
  const configs = document.querySelectorAll(".provider-config");
  configs.forEach((el) => {
    const targetProvider = el.getAttribute("data-provider");
    if (targetProvider === activeProvider) {
      el.removeAttribute("hidden");
    } else {
      el.setAttribute("hidden", "");
    }
  });
}

export async function load() {
  const s = await getSettings();
  if (els.provider) els.provider.value = s.provider;
  if (els.openaiKey) els.openaiKey.value = s.apiKeys?.openai || "";
  if (els.geminiKey) els.geminiKey.value = s.apiKeys?.gemini || "";
  if (els.claudeKey) els.claudeKey.value = s.apiKeys?.claude || "";
  if (els.openaiModel) els.openaiModel.value = s.model?.openai || "gpt-4o-mini";
  if (els.geminiModel) els.geminiModel.value = s.model?.gemini || "gemini-3.5-flash";
  if (els.claudeModel) els.claudeModel.value = s.model?.claude || "claude-haiku-4-5-20251001";
  if (els.openaiBaseUrl) els.openaiBaseUrl.value = s.baseUrl?.openai || "";
  if (els.geminiBaseUrl) els.geminiBaseUrl.value = s.baseUrl?.gemini || "";
  if (els.claudeBaseUrl) els.claudeBaseUrl.value = s.baseUrl?.claude || "";
  if (els.dailyCap) els.dailyCap.value = s.dailyCallCap || 500;

  updateProviderVisibility(s.provider);
}

function setStatus(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg;
  els.status.style.color = isError ? "#c00" : "#2a8a3a";
  if (!isError) {
    setTimeout(() => {
      if (els.status && els.status.textContent === msg) els.status.textContent = "";
    }, 2500);
  }
}

function setDataStatus(msg, isError = false) {
  if (!els.dataStatus) return;
  els.dataStatus.textContent = msg;
  els.dataStatus.style.color = isError ? "#b91c1c" : "#15803d";
  setTimeout(() => {
    if (els.dataStatus && els.dataStatus.textContent === msg) els.dataStatus.textContent = "";
  }, 3500);
}

if (typeof document !== "undefined") {
  if (els.provider) {
    els.provider.addEventListener("change", () => {
      updateProviderVisibility(els.provider.value);
    });
  }

  if (els.saveBtn) {
    els.saveBtn.addEventListener("click", async () => {
      // 1. Validate Base URLs
      let openaiBase = "";
      let geminiBase = "";
      let claudeBase = "";

      try {
        openaiBase = validateAndNormalizeBaseUrl(els.openaiBaseUrl ? els.openaiBaseUrl.value : "");
      } catch (err) {
        setStatus(`OpenAI Base URL: ${err.message}`, true);
        return;
      }

      try {
        geminiBase = validateAndNormalizeBaseUrl(els.geminiBaseUrl ? els.geminiBaseUrl.value : "");
      } catch (err) {
        setStatus(`Gemini Base URL: ${err.message}`, true);
        return;
      }

      try {
        claudeBase = validateAndNormalizeBaseUrl(els.claudeBaseUrl ? els.claudeBaseUrl.value : "");
      } catch (err) {
        setStatus(`Claude Base URL: ${err.message}`, true);
        return;
      }

      // 2. Request host permission for active custom endpoint if not already granted
      const selectedProvider = els.provider ? els.provider.value : "openai";
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
            logger.warn("OPTIONS", "Runtime permission error:", permErr);
          }
        }
      }

      // 3. Persist settings (preserving all provider configurations)
      await setSettings({
        provider: selectedProvider,
        model: {
          openai: (els.openaiModel ? els.openaiModel.value.trim() : "") || "gpt-4o-mini",
          gemini: (els.geminiModel ? els.geminiModel.value.trim() : "") || "gemini-3.5-flash",
          claude: (els.claudeModel ? els.claudeModel.value.trim() : "") || "claude-haiku-4-5-20251001",
        },
        baseUrl: {
          openai: openaiBase,
          gemini: geminiBase,
          claude: claudeBase,
        },
        dailyCallCap: parseInt(els.dailyCap ? els.dailyCap.value : "500", 10) || 500,
        apiKeys: {
          openai: els.openaiKey ? els.openaiKey.value.trim() : "",
          gemini: els.geminiKey ? els.geminiKey.value.trim() : "",
          claude: els.claudeKey ? els.claudeKey.value.trim() : "",
        },
      });

      setStatus("Saved ✓", false);
    });
  }

  // Data Management Actions
  if (els.clearSavedBtn) {
    els.clearSavedBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Are you sure you want to delete all saved posts from your Second Brain? This cannot be undone."
      );
      if (!confirmed) return;
      try {
        await clearSavedPostsData();
        setDataStatus("Second Brain cleared ✓");
      } catch (err) {
        logger.error("OPTIONS", "Failed to clear saved posts:", err);
        setDataStatus("Failed to clear Second Brain.", true);
      }
    });
  }

  if (els.clearLogBtn) {
    els.clearLogBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Are you sure you want to clear the classification decision log?"
      );
      if (!confirmed) return;
      try {
        await clearDecisionLogData();
        setDataStatus("Decision log cleared ✓");
      } catch (err) {
        logger.error("OPTIONS", "Failed to clear decision log:", err);
        setDataStatus("Failed to clear decision log.", true);
      }
    });
  }

  if (els.clearCacheBtn) {
    els.clearCacheBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Are you sure you want to clear the classification cache? Posts will be re-classified on your next feed scan."
      );
      if (!confirmed) return;
      try {
        const count = await clearClassificationCache();
        setDataStatus(`Classification cache cleared (${count} entries removed) ✓`);
      } catch (err) {
        logger.error("OPTIONS", "Failed to clear cache:", err);
        setDataStatus("Failed to clear classification cache.", true);
      }
    });
  }

  if (els.clearAllBtn) {
    els.clearAllBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "⚠️ WARNING: This will permanently delete ALL local data stored by FeedRule in this browser, including your API keys, daily usage counters, classification cache, decision log, and Second Brain saved posts.\n\nAre you sure you want to perform a full reset?"
      );
      if (!confirmed) return;
      try {
        await clearAllLocalData();
        await load();
        setDataStatus("All local FeedRule data cleared ✓");
      } catch (err) {
        logger.error("OPTIONS", "Failed to clear all local data:", err);
        setDataStatus("Failed to clear all local data.", true);
      }
    });
  }

  load();
}
