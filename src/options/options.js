// src/options/options.js
// FeedRule Settings & Observability Control Center.
// Manages multi-key configuration pools, runtime health indicators, connection testing, and persistent API logs.

import { getSettings, setSettings, getPrimaryApiKey, normalizeApiKeys } from "../storage/rules-store.js";
import { validateAndNormalizeBaseUrl, getRequiredOriginPattern } from "../llm/url-helper.js";
import { testProviderConnection } from "../llm/test-connection.js";
import { getKeyPoolStatus } from "../llm/key-scheduler.js";
import { getApiLogs, getApiLogStats, clearApiLogs } from "../storage/api-log-store.js";
import {
  clearSavedPostsData,
  clearDecisionLogData,
  clearClassificationCache,
  clearAllLocalData,
} from "../storage/data-management.js";
import { logger } from "../utils/logger.js";
import { browserApi } from "../utils/browser.js";

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
  get testOpenAiBtn() { return getEl("testOpenAiBtn"); },
  get openaiTestStatus() { return getEl("openaiTestStatus"); },
  get testGeminiBtn() { return getEl("testGeminiBtn"); },
  get geminiTestStatus() { return getEl("geminiTestStatus"); },
  get testClaudeBtn() { return getEl("testClaudeBtn"); },
  get claudeTestStatus() { return getEl("claudeTestStatus"); },

  // Multi-key lists & add buttons
  get openaiKeyList() { return getEl("openaiKeyList"); },
  get addOpenaiKeyBtn() { return getEl("addOpenaiKeyBtn"); },
  get geminiKeyList() { return getEl("geminiKeyList"); },
  get addGeminiKeyBtn() { return getEl("addGeminiKeyBtn"); },
  get claudeKeyList() { return getEl("claudeKeyList"); },
  get addClaudeKeyBtn() { return getEl("addClaudeKeyBtn"); },

  // API Activity & Observability elements
  get kpiTotalRequests() { return getEl("kpiTotalRequests"); },
  get kpiSuccessRate() { return getEl("kpiSuccessRate"); },
  get kpiAvgLatency() { return getEl("kpiAvgLatency"); },
  get kpiFailoverRate() { return getEl("kpiFailoverRate"); },
  get filterProvider() { return getEl("filterProvider"); },
  get filterStatus() { return getEl("filterStatus"); },
  get searchApiLogs() { return getEl("searchApiLogs"); },
  get refreshApiLogsBtn() { return getEl("refreshApiLogsBtn"); },
  get clearApiLogsBtn() { return getEl("clearApiLogsBtn"); },
  get apiLogActionStatus() { return getEl("apiLogActionStatus"); },
  get apiLogList() { return getEl("apiLogList"); },
};

// In-memory multi-key storage cache across provider sections
const providerKeyPools = {
  openai: [],
  gemini: [],
  claude: [],
};

// In-flight connection tests tracker
const inFlightTests = new Set();

/**
 * Escapes HTML characters for safe text insertion.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Formats a numeric timestamp to a localized HH:MM:SS string.
 *
 * @param {number} ts
 * @returns {string}
 */
function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toTimeString().split(" ")[0];
}

/**
 * Collects all current API keys for a provider from DOM input rows or legacy element.
 *
 * @param {"openai"|"gemini"|"claude"} provider
 * @returns {string[]}
 */
export function collectKeysFromDom(provider) {
  if (typeof document === "undefined") return providerKeyPools[provider] || [];
  const listEl = getEl(`${provider}KeyList`);
  if (listEl && listEl.querySelectorAll) {
    const inputs = listEl.querySelectorAll(".key-input");
    if (inputs.length > 0) {
      const keys = [];
      inputs.forEach((input) => keys.push(input.value));
      return keys;
    }
  }

  // Fallback to legacy single element if present
  const legacyEl = getEl(`${provider}Key`);
  if (legacyEl && legacyEl.value) {
    return [legacyEl.value];
  }

  return providerKeyPools[provider] || [];
}

/**
 * Renders the multi-key pool for a provider into its DOM container.
 *
 * @param {"openai"|"gemini"|"claude"} provider
 * @param {string[]} [keys] - Keys to render (if omitted, collects from DOM or in-memory state)
 */
export function renderKeyPool(provider, keys) {
  if (typeof document === "undefined") return;
  const listEl = getEl(`${provider}KeyList`);

  const currentKeys = keys !== undefined ? keys : collectKeysFromDom(provider);
  providerKeyPools[provider] = currentKeys;

  // Sync hidden legacy input for single-key backward compatibility / tests
  const legacyEl = getEl(`${provider}Key`);
  if (legacyEl) {
    legacyEl.value = currentKeys[0] || "";
  }

  if (!listEl) return;

  // Get ephemeral runtime health from key-scheduler
  const healthStatus = getKeyPoolStatus(provider, currentKeys);

  listEl.innerHTML = "";

  if (currentKeys.length === 0) {
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty-keys-msg";
    emptyMsg.textContent = "No API keys configured";
    listEl.appendChild(emptyMsg);
    return;
  }

  currentKeys.forEach((key, idx) => {
    const health = healthStatus[idx] || { status: "healthy", cooldownRemainingMs: 0 };

    const row = document.createElement("div");
    row.className = "key-row";
    row.setAttribute("data-key-index", String(idx));

    let healthClass = "health-healthy";
    let healthLabel = "● Healthy";

    if (health.status === "invalid") {
      healthClass = "health-invalid";
      healthLabel = "✕ Invalid";
    } else if (health.status === "cooldown") {
      healthClass = "health-cooldown";
      const secs = Math.ceil((health.cooldownRemainingMs || 0) / 1000);
      healthLabel = `◷ Cooldown · ${secs}s`;
    }

    const providerLabel = provider === "openai" ? "OpenAI" : provider === "gemini" ? "Gemini" : "Claude";

    row.innerHTML = `
      <div class="key-row-meta">
        <span class="key-index-label">Key #${idx + 1}</span>
        <span class="key-health-badge ${healthClass}">${escapeHtml(healthLabel)}</span>
      </div>
      <div class="key-input-row">
        <input
          type="password"
          class="key-input"
          placeholder="Enter ${escapeHtml(providerLabel)} API key"
          aria-label="${escapeHtml(providerLabel)} Key #${idx + 1}"
          value="${escapeHtml(key)}"
        />
        <button
          type="button"
          class="btn-remove-key"
          aria-label="Remove ${escapeHtml(providerLabel)} Key #${idx + 1}"
          title="Remove Key #${idx + 1}"
        >×</button>
      </div>
    `;

    // Remove key listener
    const removeBtn = row.querySelector(".btn-remove-key");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        const latestKeys = collectKeysFromDom(provider);
        latestKeys.splice(idx, 1);
        renderKeyPool(provider, latestKeys);
      });
    }

    // Input change listener to keep in-memory pool synced
    const inputEl = row.querySelector(".key-input");
    if (inputEl) {
      inputEl.addEventListener("input", () => {
        providerKeyPools[provider][idx] = inputEl.value;
        if (idx === 0 && legacyEl) {
          legacyEl.value = inputEl.value;
        }
      });
    }

    listEl.appendChild(row);
  });
}

/**
 * Adds a new empty API key row to the specified provider pool.
 *
 * @param {"openai"|"gemini"|"claude"} provider
 */
export function addKeyRow(provider) {
  const currentKeys = collectKeysFromDom(provider);
  currentKeys.push("");
  renderKeyPool(provider, currentKeys);

  // Focus the newly created input
  const listEl = getEl(`${provider}KeyList`);
  if (listEl && listEl.querySelectorAll) {
    const inputs = listEl.querySelectorAll(".key-input");
    if (inputs.length > 0) {
      inputs[inputs.length - 1].focus();
    }
  }
}

/**
 * Handles executing a connection test for a specific provider using current DOM values.
 *
 * @param {"openai"|"gemini"|"claude"} provider
 * @param {HTMLButtonElement|null} btn
 * @param {HTMLElement|null} statusEl
 * @returns {Promise<Object>}
 */
export async function handleTestConnection(provider, btn, statusEl) {
  if (inFlightTests.has(provider)) return;
  inFlightTests.add(provider);

  const originalText = btn ? btn.textContent : "Test Connection";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Testing...";
  }

  if (statusEl) {
    statusEl.textContent = "Testing connection...";
    statusEl.className = "test-conn-status status-loading";
  }

  try {
    let apiKey = "";
    const domKeys = collectKeysFromDom(provider);
    if (domKeys.length > 0 && domKeys[0]) {
      apiKey = domKeys[0].trim();
    } else if (els[`${provider}Key`]?.value) {
      apiKey = els[`${provider}Key`].value.trim();
    }

    let model = "";
    let baseUrl = "";

    if (provider === "openai") {
      model = els.openaiModel ? els.openaiModel.value : "";
      baseUrl = els.openaiBaseUrl ? els.openaiBaseUrl.value : "";
    } else if (provider === "gemini") {
      model = els.geminiModel ? els.geminiModel.value : "";
      baseUrl = els.geminiBaseUrl ? els.geminiBaseUrl.value : "";
    } else if (provider === "claude") {
      model = els.claudeModel ? els.claudeModel.value : "";
      baseUrl = els.claudeBaseUrl ? els.claudeBaseUrl.value : "";
    }

    const result = await testProviderConnection({
      provider,
      apiKey,
      model,
      baseUrl,
    });

    if (statusEl) {
      if (result.ok) {
        statusEl.textContent = `✓ Connection successful · ${result.latencyMs}ms`;
        statusEl.className = "test-conn-status status-success";
      } else {
        statusEl.textContent = `✕ ${result.message}`;
        statusEl.className = "test-conn-status status-error";
      }
    }

    // Refresh observability logs & key health indicators
    renderApiLogs();
    renderApiLogStats();
    renderKeyPool(provider);

    return result;
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = `✕ ${err.message || "Test failed"}`;
      statusEl.className = "test-conn-status status-error";
    }
    return {
      ok: false,
      provider,
      errorCode: "UNEXPECTED_ERROR",
      message: err.message || "Test failed",
      latencyMs: 0,
    };
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
    inFlightTests.delete(provider);
  }
}

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

/**
 * Renders KPI cards from persistent API log metrics.
 */
export async function renderApiLogStats() {
  if (typeof document === "undefined") return;
  try {
    const stats = await getApiLogStats();
    if (els.kpiTotalRequests) {
      els.kpiTotalRequests.textContent = String(stats.totalRequests24h || 0);
    }
    if (els.kpiSuccessRate) {
      els.kpiSuccessRate.textContent = `${stats.successRate ?? 100}%`;
    }
    if (els.kpiAvgLatency) {
      els.kpiAvgLatency.textContent = `${stats.avgLogicalLatencyMs || 0} ms`;
    }
    if (els.kpiFailoverRate) {
      els.kpiFailoverRate.textContent = `${stats.failoverRate || 0}%`;
    }
  } catch (err) {
    logger.warn("OPTIONS", "Failed to render API log stats:", err);
  }
}

/**
 * Renders filtered logical request records in chronological (newest first) accordion list.
 */
export async function renderApiLogs() {
  if (typeof document === "undefined" || !els.apiLogList) return;

  const providerFilter = els.filterProvider ? els.filterProvider.value : "all";
  const statusFilter = els.filterStatus ? els.filterStatus.value : "all";
  const searchFilter = els.searchApiLogs ? els.searchApiLogs.value : "";

  try {
    const logs = await getApiLogs({
      provider: providerFilter,
      status: statusFilter,
      search: searchFilter,
      limit: 100,
    });

    els.apiLogList.innerHTML = "";

    if (logs.length === 0) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "empty-logs-msg";
      emptyDiv.textContent = "No API activity records found.";
      els.apiLogList.appendChild(emptyDiv);
      return;
    }

    logs.forEach((record) => {
      const card = document.createElement("div");
      card.className = "log-card";
      card.setAttribute("data-correlation-id", record.correlationId);

      const statusBadgeClass = record.ok ? "status-ok" : "status-err";
      const statusBadgeText = record.ok ? "✓ Success" : "✕ Error";
      const attemptsCountText = `${record.totalAttempts || 1} ${
        (record.totalAttempts || 1) === 1 ? "attempt" : "attempts"
      }`;
      const isTestOp = record.operation === "testConnection";

      const attemptsHtml = (record.attempts || [])
        .map((att) => {
          const itemClass = att.ok ? "attempt-ok" : "attempt-err";
          const keyLabel = att.keyLabel || `Key #${(att.keyIndex || 0) + 1}`;
          const codeHtml = att.errorCode ? `<div class="attempt-code"><code>${escapeHtml(att.errorCode)}</code></div>` : "";
          const msgHtml = att.errorMessage ? `<div class="attempt-msg">${escapeHtml(att.errorMessage)}</div>` : "";

          return `
            <div class="attempt-item ${itemClass}">
              <div class="attempt-header">
                <span class="attempt-index">Attempt ${(att.attemptIndex || 0) + 1}</span>
                <span class="attempt-key">${escapeHtml(keyLabel)}</span>
                <span class="attempt-status">HTTP ${att.status || 0}</span>
                <span class="attempt-latency">${att.latencyMs || 0} ms</span>
              </div>
              ${codeHtml}
              ${msgHtml}
            </div>
          `;
        })
        .join("");

      const errorBannerHtml =
        !record.ok && record.finalErrorMessage
          ? `<div class="log-error-banner">${escapeHtml(record.finalErrorMessage)}</div>`
          : "";

      card.innerHTML = `
        <button
          type="button"
          class="log-card-header"
          aria-expanded="false"
          aria-controls="details-${escapeHtml(record.correlationId)}"
        >
          <div class="log-card-summary">
            <div class="log-card-meta">
              <span class="log-ts">${escapeHtml(formatTimestamp(record.ts))}</span>
              <span class="log-provider-tag">${escapeHtml(record.provider)} · ${escapeHtml(record.model || "default")}</span>
              ${isTestOp ? '<span class="log-op-tag">Test</span>' : ""}
            </div>
            <div class="log-card-result">
              <span class="log-status-badge ${statusBadgeClass}">${statusBadgeText}</span>
              <span class="log-attempts-tag">${escapeHtml(attemptsCountText)}</span>
              <span class="log-latency-tag">${record.logicalLatencyMs || 0} ms</span>
              <span class="accordion-icon" aria-hidden="true">▾</span>
            </div>
          </div>
        </button>
        <div class="log-card-body" id="details-${escapeHtml(record.correlationId)}" hidden>
          ${errorBannerHtml}
          <div class="attempt-timeline">
            ${attemptsHtml}
          </div>
        </div>
      `;

      const headerBtn = card.querySelector(".log-card-header");
      const bodyDiv = card.querySelector(".log-card-body");

      if (headerBtn && bodyDiv) {
        headerBtn.addEventListener("click", () => {
          const isExpanded = headerBtn.getAttribute("aria-expanded") === "true";
          headerBtn.setAttribute("aria-expanded", String(!isExpanded));
          if (isExpanded) {
            bodyDiv.setAttribute("hidden", "");
          } else {
            bodyDiv.removeAttribute("hidden");
          }
        });
      }

      els.apiLogList.appendChild(card);
    });
  } catch (err) {
    logger.warn("OPTIONS", "Failed to render API logs:", err);
  }
}

export async function load() {
  const s = await getSettings();
  const normalizedKeys = normalizeApiKeys(s.apiKeys);

  providerKeyPools.openai = normalizedKeys.openai;
  providerKeyPools.gemini = normalizedKeys.gemini;
  providerKeyPools.claude = normalizedKeys.claude;

  if (els.provider) els.provider.value = s.provider;
  if (els.openaiKey) els.openaiKey.value = normalizedKeys.openai[0] || "";
  if (els.geminiKey) els.geminiKey.value = normalizedKeys.gemini[0] || "";
  if (els.claudeKey) els.claudeKey.value = normalizedKeys.claude[0] || "";
  if (els.openaiModel) els.openaiModel.value = s.model?.openai || "gpt-4o-mini";
  if (els.geminiModel) els.geminiModel.value = s.model?.gemini || "gemini-3.5-flash";
  if (els.claudeModel) els.claudeModel.value = s.model?.claude || "claude-haiku-4-5-20251001";
  if (els.openaiBaseUrl) els.openaiBaseUrl.value = s.baseUrl?.openai || "";
  if (els.geminiBaseUrl) els.geminiBaseUrl.value = s.baseUrl?.gemini || "";
  if (els.claudeBaseUrl) els.claudeBaseUrl.value = s.baseUrl?.claude || "";
  if (els.dailyCap) els.dailyCap.value = s.dailyCallCap || 500;

  // Render multi-key pools
  renderKeyPool("openai", normalizedKeys.openai);
  renderKeyPool("gemini", normalizedKeys.gemini);
  renderKeyPool("claude", normalizedKeys.claude);

  updateProviderVisibility(s.provider);

  // Render API activity & statistics
  await renderApiLogStats();
  await renderApiLogs();
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

function setApiLogActionStatus(msg, isError = false) {
  if (!els.apiLogActionStatus) return;
  els.apiLogActionStatus.textContent = msg;
  els.apiLogActionStatus.style.color = isError ? "#b91c1c" : "#15803d";
  setTimeout(() => {
    if (els.apiLogActionStatus && els.apiLogActionStatus.textContent === msg) {
      els.apiLogActionStatus.textContent = "";
    }
  }, 3500);
}

if (typeof document !== "undefined") {
  if (els.provider) {
    els.provider.addEventListener("change", () => {
      updateProviderVisibility(els.provider.value);
    });
  }

  // Add Key Button Listeners
  if (els.addOpenaiKeyBtn) {
    els.addOpenaiKeyBtn.addEventListener("click", () => addKeyRow("openai"));
  }
  if (els.addGeminiKeyBtn) {
    els.addGeminiKeyBtn.addEventListener("click", () => addKeyRow("gemini"));
  }
  if (els.addClaudeKeyBtn) {
    els.addClaudeKeyBtn.addEventListener("click", () => addKeyRow("claude"));
  }

  // Test Connection Buttons
  if (els.testOpenAiBtn) {
    els.testOpenAiBtn.addEventListener("click", () => {
      handleTestConnection("openai", els.testOpenAiBtn, els.openaiTestStatus);
    });
  }
  if (els.testGeminiBtn) {
    els.testGeminiBtn.addEventListener("click", () => {
      handleTestConnection("gemini", els.testGeminiBtn, els.geminiTestStatus);
    });
  }
  if (els.testClaudeBtn) {
    els.testClaudeBtn.addEventListener("click", () => {
      handleTestConnection("claude", els.testClaudeBtn, els.claudeTestStatus);
    });
  }

  // API Log Filter & Action Listeners
  if (els.filterProvider) {
    els.filterProvider.addEventListener("change", () => renderApiLogs());
  }
  if (els.filterStatus) {
    els.filterStatus.addEventListener("change", () => renderApiLogs());
  }
  if (els.searchApiLogs) {
    els.searchApiLogs.addEventListener("input", () => renderApiLogs());
  }
  if (els.refreshApiLogsBtn) {
    els.refreshApiLogsBtn.addEventListener("click", async () => {
      await renderApiLogStats();
      await renderApiLogs();
      renderKeyPool("openai");
      renderKeyPool("gemini");
      renderKeyPool("claude");
      setApiLogActionStatus("API logs refreshed ✓");
    });
  }
  if (els.clearApiLogsBtn) {
    els.clearApiLogsBtn.addEventListener("click", async () => {
      const confirmed = window.confirm(
        "Are you sure you want to clear API activity logs? This cannot be undone."
      );
      if (!confirmed) return;
      try {
        await clearApiLogs();
        await renderApiLogStats();
        await renderApiLogs();
        setApiLogActionStatus("API activity logs cleared ✓");
      } catch (err) {
        logger.error("OPTIONS", "Failed to clear API logs:", err);
        setApiLogActionStatus("Failed to clear API logs.", true);
      }
    });
  }

  // Save Settings
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
        if (requiredPattern && browserApi?.permissions?.contains && browserApi?.permissions?.request) {
          try {
            const hasPerm = await browserApi.permissions.contains({ origins: [requiredPattern] });
            if (!hasPerm) {
              const granted = await browserApi.permissions.request({ origins: [requiredPattern] });
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

      // 3. Collect and normalize keys from all provider pools
      const rawOpenaiKeys = collectKeysFromDom("openai");
      const rawGeminiKeys = collectKeysFromDom("gemini");
      const rawClaudeKeys = collectKeysFromDom("claude");

      // 4. Persist settings (preserving all provider configurations)
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
          openai: rawOpenaiKeys,
          gemini: rawGeminiKeys,
          claude: rawClaudeKeys,
        },
      });

      // Re-render pools with normalized saved keys
      const updated = await getSettings();
      providerKeyPools.openai = updated.apiKeys.openai;
      providerKeyPools.gemini = updated.apiKeys.gemini;
      providerKeyPools.claude = updated.apiKeys.claude;

      renderKeyPool("openai", updated.apiKeys.openai);
      renderKeyPool("gemini", updated.apiKeys.gemini);
      renderKeyPool("claude", updated.apiKeys.claude);

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
        "⚠️ WARNING: This will permanently delete ALL local data stored by FeedRule in this browser, including your API keys, daily usage counters, classification cache, decision log, Second Brain saved posts, and API activity logs.\n\nAre you sure you want to perform a full reset?"
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
