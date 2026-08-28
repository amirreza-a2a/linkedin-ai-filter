// src/popup/popup.js
import { getSettings, setSettings } from "../storage/rules-store.js";

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
  chrome.tabs.create({ url: chrome.runtime.getURL("src/graph/graph.html") });
});

document.getElementById("openSaved").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("src/saved/saved.html") });
});

document.getElementById("openDashboard").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
});

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
