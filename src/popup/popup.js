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

document.getElementById("openGraph").addEventListener("click", (e) => {
  e.preventDefault();
  openExtensionPage("graph");
});

document.getElementById("openSaved").addEventListener("click", (e) => {
  e.preventDefault();
  openExtensionPage("saved");
});

document.getElementById("openDashboard").addEventListener("click", (e) => {
  e.preventDefault();
  openExtensionPage("dashboard");
});

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  openExtensionPage("options");
});

load();
