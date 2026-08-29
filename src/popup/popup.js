// src/popup/popup.js
import { getSettings, setSettings } from "../storage/rules-store.js";
import { openExtensionPage } from "../navigation/navigation.js";

const rulesEl = document.getElementById("rules");
const saveRulesEl = document.getElementById("saveRules");
const enabledEl = document.getElementById("enabledToggle");
const statusEl = document.getElementById("status");

async function load() {
  const settings = await getSettings();
  rulesEl.value = settings.rulesText || "";
  saveRulesEl.value = settings.saveRulesText || "";
  enabledEl.checked = settings.enabled;
}

document.getElementById("save").addEventListener("click", async () => {
  await setSettings({
    rulesText: rulesEl.value.trim(),
    saveRulesText: saveRulesEl.value.trim(),
  });
  statusEl.textContent = "Rules saved successfully!";
  setTimeout(() => (statusEl.textContent = ""), 2500);
});

enabledEl.addEventListener("change", async () => {
  await setSettings({ enabled: enabledEl.checked });
});

console.log("[FeedRule][NAV] listeners registering in popup.js");

document.getElementById("openGraph").addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  console.log("[FeedRule][NAV] click intercepted on popup #openGraph");
  await openExtensionPage("graph");
  window.close();
});

document.getElementById("openSaved").addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  console.log("[FeedRule][NAV] click intercepted on popup #openSaved");
  await openExtensionPage("saved");
  window.close();
});

document.getElementById("openDashboard").addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  console.log("[FeedRule][NAV] click intercepted on popup #openDashboard");
  await openExtensionPage("dashboard");
  window.close();
});

document.getElementById("openOptions").addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  console.log("[FeedRule][NAV] click intercepted on popup #openOptions");
  await openExtensionPage("options");
  window.close();
});

load();
