const elements = {
  toggle: document.getElementById("toggle"),
  stateLabel: document.getElementById("stateLabel"),
  adCount: document.getElementById("adCount"),
  netCount: document.getElementById("netCount"),
  dot: document.getElementById("dot"),
  footText: document.getElementById("footText"),
  repo: document.getElementById("repo"),
};

function render(enabled) {
  elements.toggle.checked = enabled;
  elements.stateLabel.textContent = enabled ? "Protection on" : "Protection off";
  elements.stateLabel.classList.toggle("off", !enabled);
  elements.dot.classList.toggle("live", enabled);
  elements.footText.textContent = enabled ? "Active on this tab" : "Paused";
}

function loadSettings() {
  chrome.storage.local.get(
    { [KAB.STORAGE.ENABLED]: true, [KAB.STORAGE.ADS_HANDLED]: 0 },
    (stored) => {
      render(stored[KAB.STORAGE.ENABLED] !== false);
      elements.adCount.textContent = stored[KAB.STORAGE.ADS_HANDLED] || 0;
    }
  );
}

function loadBlockedCount() {
  chrome.runtime.sendMessage(
    { type: KAB.MESSAGE.GET_BLOCKED_COUNT },
    (response) => {
      if (chrome.runtime.lastError) return;
      if (typeof response?.count === "number") {
        elements.netCount.textContent = response.count;
      }
    }
  );
}

function watchCounter() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[KAB.STORAGE.ADS_HANDLED]) return;
    elements.adCount.textContent =
      changes[KAB.STORAGE.ADS_HANDLED].newValue || 0;
  });
}

elements.repo.href = KAB.REPO_URL;

elements.toggle.addEventListener("change", () => {
  const enabled = elements.toggle.checked;
  render(enabled);
  chrome.storage.local.set({ [KAB.STORAGE.ENABLED]: enabled });
});

loadSettings();
loadBlockedCount();
watchCounter();
