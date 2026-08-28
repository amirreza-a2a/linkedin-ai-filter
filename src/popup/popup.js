import { getSettings, setSettings } from "../storage/rules-store.js";

const rulesEl = document.getElementById("rules");
const enabledEl = document.getElementById("enabledToggle");
const statusEl = document.getElementById("status");

async function load() {
  const settings = await getSettings();
  rulesEl.value = settings.rulesText;
  enabledEl.checked = settings.enabled;
}

document.getElementById("save").addEventListener("click", async () => {
  await setSettings({ rulesText: rulesEl.value.trim() });
  statusEl.textContent = "Saved. Refresh LinkedIn to apply.";
  setTimeout(() => (statusEl.textContent = ""), 2500);
});

enabledEl.addEventListener("change", async () => {
  await setSettings({ enabled: enabledEl.checked });
});

document.getElementById("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("openDashboard").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
});

load();
