const { STORAGE_KEY, REPOSITORY_URL } = KickAdBlocker;

const AD_NETWORK_RULES_PATH = "rules/ad-networks.json";

const ui = {
  protectionToggle: document.getElementById("protectionToggle"),
  protectionLabel: document.getElementById("protectionLabel"),
  adsSkippedValue: document.getElementById("adsSkippedValue"),
  blockedNetworksValue: document.getElementById("blockedNetworksValue"),
  activityIndicator: document.getElementById("activityIndicator"),
  activityLabel: document.getElementById("activityLabel"),
  repositoryLink: document.getElementById("repositoryLink"),
};

function renderProtectionState(enabled) {
  ui.protectionToggle.checked = enabled;
  ui.protectionLabel.textContent = enabled ? "Protection on" : "Protection off";
  ui.protectionLabel.classList.toggle("is-off", !enabled);
  ui.activityIndicator.classList.toggle("is-live", enabled);
  ui.activityLabel.textContent = enabled ? "Watching for ads" : "Paused";
}

async function loadStoredState() {
  const stored = await chrome.storage.local.get({
    [STORAGE_KEY.PROTECTION_ENABLED]: true,
    [STORAGE_KEY.ADS_SKIPPED]: 0,
  });
  renderProtectionState(stored[STORAGE_KEY.PROTECTION_ENABLED] !== false);
  ui.adsSkippedValue.textContent = stored[STORAGE_KEY.ADS_SKIPPED] || 0;
}

async function loadBlockedNetworkCount() {
  const response = await fetch(chrome.runtime.getURL(AD_NETWORK_RULES_PATH));
  const rules = await response.json();
  const blockedHosts = new Set(rules.map((rule) => rule.condition.urlFilter));
  ui.blockedNetworksValue.textContent = blockedHosts.size;
}

function watchAdsSkipped() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    const change = changes[STORAGE_KEY.ADS_SKIPPED];
    if (areaName !== "local" || !change) return;
    ui.adsSkippedValue.textContent = change.newValue || 0;
  });
}

ui.repositoryLink.href = REPOSITORY_URL;

ui.protectionToggle.addEventListener("change", () => {
  const enabled = ui.protectionToggle.checked;
  renderProtectionState(enabled);
  chrome.storage.local.set({ [STORAGE_KEY.PROTECTION_ENABLED]: enabled });
});

watchAdsSkipped();
loadStoredState();
loadBlockedNetworkCount();
